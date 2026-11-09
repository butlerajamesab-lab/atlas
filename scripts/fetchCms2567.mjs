// Fetch CMS Form 2567 documents from Care Compare (pilot +
// document layer), Alexander's 2567 build, 2026-11-09.
//
// Two modes:
//   --probe   Try every declared candidate URL per target and
//             receipt the outcome (status, bytes, sha256, PDF
//             magic). Posts nothing. This is how the unverified
//             kind slugs get verified or eliminated from clean
//             egress (Render), because medicare.gov refuses this
//             workspace's sandbox egress with a 403.
//   (default) For each target, take the FIRST candidate that
//             answers with a real PDF, hash the bytes, and post a
//             document signal through the governed ingest door
//             under (cms_nh / us_state_WA) — the pilot tuple; the
//             national document family mirrors the deficiency
//             families' split when it is built.
//
// A target no candidate answers for is reported in the summary's
// failures and exits non-zero — unknown stays unknown, labeled.
//
// Usage:
//   node scripts/fetchCms2567.mjs --ccn 505442 \
//     --target health:2026-03-04 --target fire:2026-03-04 [--probe]
//

import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import axios from 'axios';

import {
  form2567Candidates,
  isPdfBytes,
  normalizeForm2567Document,
  FORM_2567_MODULE_HINT,
} from '../src/adapters/cmsForm2567Adapter.js';
import { postSignalsToAtlas } from '../src/adapters/ingestClient.js';
import { withRetry } from './loadCmsNationalBulk.mjs';

async function defaultHttpGetBytes(url) {
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 90000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      validateStatus: () => true,
    });
    return { status: response.status, bytes: Buffer.from(response.data) };
  } catch (error) {
    return { status: null, bytes: Buffer.alloc(0), error: String(error?.message ?? error).slice(0, 200) };
  }
}

// Probe every candidate for one target. Returns the receipts and
// the first answering PDF (if any) so fetch mode never downloads
// twice.
export async function probeForm2567Target({ ccn, category, surveyDate, httpGetBytes = defaultHttpGetBytes }) {
  const receipts = [];
  let found = null;
  for (const { kind, url } of form2567Candidates(ccn, category, surveyDate)) {
    const { status, bytes, error } = await httpGetBytes(url);
    const isPdf = status === 200 && isPdfBytes(bytes);
    const receipt = {
      kind,
      url,
      status,
      bytes: bytes?.length ?? 0,
      is_pdf: isPdf,
      sha256: isPdf ? createHash('sha256').update(bytes).digest('hex') : null,
      ...(error ? { error } : {}),
    };
    receipts.push(receipt);
    if (isPdf && !found) found = { ...receipt, body: bytes };
  }
  return { ccn, category, survey_date: surveyDate, receipts, found };
}

export async function runForm2567({ ccn, targets, probe = false, apiBaseUrl, state = 'WA', httpGetBytes, post = null, log = console.log, retrievedAt = new Date().toISOString() }) {
  const results = [];
  const failures = [];
  for (const { category, surveyDate } of targets) {
    const outcome = await probeForm2567Target({ ccn, category, surveyDate, httpGetBytes });
    for (const r of outcome.receipts) {
      log(`[cms-2567] ${ccn} ${category} ${surveyDate} ${r.kind}: status=${r.status} bytes=${r.bytes} pdf=${r.is_pdf}${r.sha256 ? ` sha256=${r.sha256}` : ''}`);
    }
    // The per-candidate receipts ride in the summary itself:
    // stdout log lines scroll out of a job's retrievable log
    // window, the closing summary does not.
    const candidateReceipts = outcome.receipts.map(({ body, ...receipt }) => receipt);
    if (!outcome.found) {
      failures.push({ category, survey_date: surveyDate, error: 'no candidate answered with a PDF' });
      results.push({ category, survey_date: surveyDate, found: false, candidates: candidateReceipts });
      continue;
    }
    const entry = {
      category,
      survey_date: surveyDate,
      found: true,
      kind: outcome.found.kind,
      source_url: outcome.found.url,
      bytes: outcome.found.bytes,
      sha256: outcome.found.sha256,
      candidates: candidateReceipts,
    };
    if (!probe) {
      const signal = normalizeForm2567Document({
        ccn,
        state,
        surveyDate,
        category,
        kind: outcome.found.kind,
        sourceUrl: outcome.found.url,
        sha256: outcome.found.sha256,
        bytes: outcome.found.bytes,
        retrievedAt,
      });
      const poster = post ?? (async (signals) => withRetry(() => postSignalsToAtlas({
        sourceId: 'cms_nh',
        jurisdictionId: 'us_state_WA',
        moduleHint: FORM_2567_MODULE_HINT,
        signals,
        apiBaseUrl,
        batchSize: 25,
      })));
      const result = await poster([signal]);
      entry.ingested_count = result.ingested_count ?? 0;
      entry.replayed_count = result.replayed_count ?? 0;
      entry.records_failed = result.records_failed ?? 0;
    }
    results.push(entry);
  }
  return { ccn, probe, results, failures };
}

export function parseForm2567Args(argv) {
  const args = { ccn: null, targets: [], probe: false, state: 'WA' };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--ccn' && value) {
      args.ccn = value;
      i += 1;
    } else if (flag === '--target' && value) {
      const [category, surveyDate] = value.split(':');
      if (!category || !/^\d{4}-\d{2}-\d{2}$/.test(surveyDate ?? '')) {
        throw new Error(`cms_2567_bad_target: ${value} (want category:YYYY-MM-DD)`);
      }
      args.targets.push({ category, surveyDate });
      i += 1;
    } else if (flag === '--state' && value) {
      args.state = value.toUpperCase();
      i += 1;
    } else if (flag === '--probe') {
      args.probe = true;
    } else if (flag.startsWith('--')) {
      throw new Error(`cms_2567_unknown_flag: ${flag}`);
    }
  }
  if (!args.ccn) throw new Error('cms_2567_ccn_required: pass --ccn');
  if (!args.targets.length) throw new Error('cms_2567_targets_required: pass at least one --target');
  return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseForm2567Args(process.argv.slice(2));
  const apiBaseUrl = process.env.ATLAS_PUBLIC_URL || 'https://atlas.columbiacitycustomllc.com';
  const summary = await runForm2567({ ...args, apiBaseUrl });
  console.log(JSON.stringify({ ok: summary.failures.length === 0, source: 'cms_2567', ...summary }, null, 2));
  if (summary.failures.length) process.exitCode = 1;
}
