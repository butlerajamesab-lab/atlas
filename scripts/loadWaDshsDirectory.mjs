// Loader for the WA DSHS fortress directory streams (adult family
// homes + assisted living facilities), Alexander's WA AFH/ALF
// family build, 2026-11-09.
//
// Shape: one pull per license class yields the WHOLE state
// directory as a single CSV from the fortress lookups (form-driven;
// see src/adapters/waDshsAdapter.js). Each pull is hash-stamped,
// parsed through the CMS bulk loader's RFC4180 parser, normalized
// by the DSHS adapter, deduped WITHIN the run by external_id —
// the state's own file carries at least one byte-identical
// duplicate row (ALF license 2160, first pull 2026-11-09); a
// source duplicate is counted and reported, never posted twice
// and never silently renumbered — and posted through the SAME
// governed ingest door under (wa_dshs_rcs / us_state_WA).
//
// Execution: one-off Render jobs in the Atlas service's own
// environment, monthly cadence by re-firing the job. --file loads
// a sealed local CSV instead of pulling live: the first load
// (2026-11-09) used the artifacts pulled and hash-stamped in
// ~/workspace/luminari-recovery/afh-alf-pull/, so the reservoir's
// first DSHS contents trace to those exact bytes.
//
// Usage:
//   node scripts/loadWaDshsDirectory.mjs [--class afh|alf|all]
//        [--afh-file PATH] [--alf-file PATH] [--concurrency 4]
//

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import {
  WA_DSHS_JURISDICTION_ID,
  WA_DSHS_REQUIRED_COLUMNS,
  WA_DSHS_SOURCE_ID,
  fetchWaDshsDirectoryCsv,
  normalizeWaDshsDirectoryRow,
  waDshsClassSpec,
} from '../src/adapters/waDshsAdapter.js';
import { postSignalsToAtlas } from '../src/adapters/ingestClient.js';
import { parseCsvRows, withRetry } from './loadCmsNationalBulk.mjs';

async function postSlice(spec, signals, apiBaseUrl) {
  if (!signals.length) return { ingested_count: 0, replayed_count: 0, records_failed: 0 };
  const result = await withRetry(() => postSignalsToAtlas({
    sourceId: WA_DSHS_SOURCE_ID,
    jurisdictionId: WA_DSHS_JURISDICTION_ID,
    moduleHint: spec.moduleHint,
    signals,
    apiBaseUrl,
    batchSize: 25,
  }));
  return {
    ingested_count: result.ingested_count ?? 0,
    replayed_count: result.replayed_count ?? 0,
    records_failed: result.records_failed ?? 0,
  };
}

// Same posting discipline as the CMS bulk loader: disjoint slices,
// a small worker pool, per-slice receipts that aggregate, and one
// slice's failure never masks the others.
export async function postDirectorySignals({ spec, signals, apiBaseUrl, concurrency = 4, post = postSlice }) {
  const totals = { ingested_count: 0, replayed_count: 0, records_failed: 0, slices_failed: 0 };
  if (!signals.length) return totals;
  const workers = Math.max(1, Math.min(concurrency, signals.length));
  const slices = Array.from({ length: workers }, () => []);
  signals.forEach((signal, index) => slices[index % workers].push(signal));
  const settled = await Promise.allSettled(slices.map((slice) => post(spec, slice, apiBaseUrl)));
  settled.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') {
      totals.ingested_count += outcome.value.ingested_count ?? 0;
      totals.replayed_count += outcome.value.replayed_count ?? 0;
      totals.records_failed += outcome.value.records_failed ?? 0;
    } else {
      totals.slices_failed += 1;
      totals.records_failed += slices[index].length;
    }
  });
  return totals;
}

export async function loadWaDshsClass(licenseClass, {
  apiBaseUrl,
  concurrency = 4,
  log = console.log,
  filePath = null,
  fetchCsv = fetchWaDshsDirectoryCsv,
  readLocalFile = (path) => readFile(path, 'utf8'),
  post = null,
  retrievedAt = new Date().toISOString(),
} = {}) {
  const spec = waDshsClassSpec(licenseClass);
  const csvText = filePath ? await readLocalFile(filePath) : await fetchCsv(licenseClass);
  const artifact = {
    bytes: Buffer.byteLength(csvText, 'utf8'),
    sha256: createHash('sha256').update(csvText, 'utf8').digest('hex'),
    origin: filePath ? `local file ${filePath}` : `fortress live pull (${spec.resultsPage})`,
  };
  log(`[wa-dshs] ${licenseClass}: ${artifact.origin} bytes=${artifact.bytes} sha256=${artifact.sha256}`);

  let headers = null;
  const seenExternalIds = new Set();
  const signals = [];
  let rowsReceived = 0;
  let sourceDuplicates = 0;
  let blankLicenseRows = 0;
  for await (const values of parseCsvRows([csvText])) {
    if (!headers) {
      headers = values.map((h) => String(h ?? '').replace(/^\uFEFF/, '').trim());
      const missing = WA_DSHS_REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
      if (missing.length) {
        throw new Error(`wa_dshs_header_mismatch: ${licenseClass} CSV is missing required columns: ${missing.join(', ')}`);
      }
      continue;
    }
    if (values.length === 1 && String(values[0] ?? '').trim() === '') continue; // trailing blank line
    rowsReceived += 1;
    const record = {};
    headers.forEach((header, index) => { record[header] = values[index] ?? ''; });
    const signal = normalizeWaDshsDirectoryRow(licenseClass, record, { retrievedAt });
    if (!signal.payload.license_number) { blankLicenseRows += 1; continue; }
    const externalId = signal.payload.external_id;
    if (seenExternalIds.has(externalId)) { sourceDuplicates += 1; continue; }
    seenExternalIds.add(externalId);
    signals.push(signal);
  }

  const totals = await postDirectorySignals({
    spec,
    signals,
    apiBaseUrl,
    concurrency,
    ...(post ? { post } : {}),
  });
  log(`[wa-dshs] ${licenseClass}: received=${rowsReceived} duplicates_in_source=${sourceDuplicates} posted=${signals.length} -> ingested=${totals.ingested_count} replayed=${totals.replayed_count} failed=${totals.records_failed}`);

  return {
    license_class: licenseClass,
    stream_id: spec.streamId,
    artifact,
    rows_received: rowsReceived,
    source_duplicates: sourceDuplicates,
    blank_license_rows: blankLicenseRows,
    rows_posted: signals.length,
    ingested_count: totals.ingested_count,
    replayed_count: totals.replayed_count,
    records_failed: totals.records_failed,
    slices_failed: totals.slices_failed,
  };
}

export function parseWaDshsArgs(argv) {
  const args = { classes: ['afh', 'alf'], files: {}, concurrency: 4 };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--class' && value) {
      args.classes = value === 'all' ? ['afh', 'alf'] : [value];
      for (const c of args.classes) waDshsClassSpec(c);
      i += 1;
    } else if (flag === '--afh-file' && value) {
      args.files.afh = value;
      i += 1;
    } else if (flag === '--alf-file' && value) {
      args.files.alf = value;
      i += 1;
    } else if (flag === '--concurrency' && value) {
      args.concurrency = Math.max(1, Math.min(16, parseInt(value, 10) || 4));
      i += 1;
    } else if (flag.startsWith('--')) {
      throw new Error(`wa_dshs_unknown_flag: ${flag}`);
    }
  }
  return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseWaDshsArgs(process.argv.slice(2));
  const apiBaseUrl = process.env.ATLAS_PUBLIC_URL || 'https://atlas.columbiacitycustomllc.com';
  const summaries = [];
  for (const licenseClass of args.classes) {
    summaries.push(await loadWaDshsClass(licenseClass, {
      apiBaseUrl,
      concurrency: args.concurrency,
      filePath: args.files[licenseClass] ?? null,
    }));
  }
  const failed = summaries.filter((s) => s.records_failed > 0 || s.slices_failed > 0);
  console.log(JSON.stringify({ ok: failed.length === 0, source: WA_DSHS_SOURCE_ID, family: 'wa-dshs-directory', summaries }, null, 2));
  if (failed.length) process.exitCode = 1;
}
