// Historical backfill for the WHD enforcement stream
// (feature/whd-history-backfill-2026-11-07; approved by the
// operator 2026-11-07).
//
// The scheduled WHD adapter draws only the 100 most recently
// loaded concluded cases per run (newest load_dt first). The
// dataset behind it — all concluded WHD compliance actions since
// FY2005 — was never drawn historically, so the reservoir holds
// the verification side of the labor story only for the newest
// slice. This script pages the SAME governed fetch the adapter
// uses (fetchWhdRecords: DOL Open Data API v4, load_dt desc,
// offset paging) and posts every page through the SAME governed
// ingest doors the adapter uses — cases to dol_whd / us_federal /
// labor_enforcement, integrity declarations to atlas_integrity /
// us_federal / integrity_observation. Nothing here bypasses the
// ingest resolver, the dedupe (event identity), or the run
// receipts: a backfilled record is indistinguishable from a
// scheduled one, which is the point.
//
// Execution: this runs as a one-off Render job in the Atlas
// service's own environment — the only place DOL_API_KEY (fetch)
// and ATLAS_INGEST_TOKEN (ingest) both exist. Inside a job there
// is no local server, so posts go to the service's public URL
// (ATLAS_PUBLIC_URL, defaulting to the Atlas custom domain),
// token-gated as usual. The script is inert in the deployed
// service: nothing imports it; only an explicit job runs it.
//
// Resumability: paging is offset-based over a stable sort; the
// ingest dedupe absorbs any overlap, so a failed or interrupted
// run restarts safely with --from-offset set to (events already
// in the reservoir for the stream, rounded down) minus a page or
// two of overlap. Each page's offset is printed BEFORE it posts,
// and a JSON summary prints at the end; a short page (fewer
// records than the page size) means the dataset is exhausted and
// the run completes.
//
// Usage:
//   node scripts/backfillWhdHistory.mjs [--from-offset N]
//        [--max-pages N] [--page-size N] [--delay-ms N]
// Defaults bound an accidental bare run: max-pages 10.

import { pathToFileURL } from 'node:url';

import {
  buildWhdDeclarations,
  fetchWhdRecords,
  normalizeWhdCase,
} from '../src/adapters/dolWhdAdapter.js';
import { postSignalsToAtlas } from '../src/adapters/ingestClient.js';

export const BACKFILL_CASE_TUPLE = {
  sourceId: 'dol_whd',
  jurisdictionId: 'us_federal',
  moduleHint: 'labor_enforcement',
};

export const BACKFILL_DECLARATION_TUPLE = {
  sourceId: 'atlas_integrity',
  jurisdictionId: 'us_federal',
  moduleHint: 'integrity_observation',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The paging loop, with every side effect injectable for tests.
// fetchPage({limit, offset}) resolves to raw WHD records;
// postCases/postDeclarations receive signal arrays and resolve to
// the ingest endpoint's response (or anything — only their
// success/failure matters here).
export async function runBackfill({
  fetchPage,
  postCases,
  postDeclarations,
  fromOffset = 0,
  maxPages = 10,
  pageSize = 100,
  delayMs = 250,
  log = () => {},
} = {}) {
  if (typeof fetchPage !== 'function' || typeof postCases !== 'function' || typeof postDeclarations !== 'function') {
    throw new Error('runBackfill requires fetchPage, postCases and postDeclarations functions');
  }
  const summary = {
    from_offset: fromOffset,
    page_size: pageSize,
    pages_posted: 0,
    records_fetched: 0,
    case_signals_posted: 0,
    declaration_signals_posted: 0,
    next_offset: fromOffset,
    exhausted: false,
  };

  for (let page = 0; page < maxPages; page += 1) {
    const offset = fromOffset + page * pageSize;
    summary.next_offset = offset;
    log(`backfill page offset=${offset}`);
    const records = await fetchPage({ limit: pageSize, offset });
    if (!Array.isArray(records)) {
      throw new Error(`backfill_fetch_unexpected: page at offset ${offset} did not resolve to a record array`);
    }
    summary.records_fetched += records.length;
    if (records.length === 0) {
      summary.exhausted = true;
      break;
    }

    const caseSignals = records.map(normalizeWhdCase);
    await postCases(caseSignals);
    summary.case_signals_posted += caseSignals.length;

    const declarations = buildWhdDeclarations(records);
    if (declarations.length) {
      await postDeclarations(declarations);
      summary.declaration_signals_posted += declarations.length;
    }

    summary.pages_posted += 1;
    summary.next_offset = offset + records.length;
    if (records.length < pageSize) {
      summary.exhausted = true;
      break;
    }
    if (delayMs > 0 && page + 1 < maxPages) await sleep(delayMs);
  }

  return summary;
}

export function parseBackfillArgs(argv) {
  const args = { fromOffset: 0, maxPages: 10, pageSize: 100, delayMs: 250 };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = Number(argv[i + 1]);
    if (flag === '--from-offset' && Number.isSafeInteger(value) && value >= 0) { args.fromOffset = value; i += 1; }
    if (flag === '--max-pages' && Number.isSafeInteger(value) && value >= 1) { args.maxPages = value; i += 1; }
    if (flag === '--page-size' && Number.isSafeInteger(value) && value >= 1 && value <= 500) { args.pageSize = value; i += 1; }
    if (flag === '--delay-ms' && Number.isSafeInteger(value) && value >= 0) { args.delayMs = value; i += 1; }
  }
  return args;
}

async function main() {
  const args = parseBackfillArgs(process.argv.slice(2));
  const apiBaseUrl = process.env.ATLAS_PUBLIC_URL || 'https://atlas.columbiacitycustomllc.com';
  const summary = await runBackfill({
    fetchPage: ({ limit, offset }) => fetchWhdRecords({ limit, offset }),
    postCases: (signals) => postSignalsToAtlas({ ...BACKFILL_CASE_TUPLE, signals, apiBaseUrl }),
    postDeclarations: (signals) => postSignalsToAtlas({ ...BACKFILL_DECLARATION_TUPLE, signals, apiBaseUrl }),
    fromOffset: args.fromOffset,
    maxPages: args.maxPages,
    pageSize: args.pageSize,
    delayMs: args.delayMs,
    log: (line) => console.log(line),
  });
  console.log(JSON.stringify({ ok: true, backfill: 'dol_whd_violations', ...summary }));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: String(error?.message || error) }));
    process.exit(1);
  });
}
