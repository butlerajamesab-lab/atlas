// Backfill for Senate LDA lobbying filings through the FIXED
// normalizer (PR #105, 2026-11-08).
//
// Why this exists (measured 2026-11-09): the open_secrets stream
// holds 1,680 events spanning posted dates 2026-08-17 → 2026-11-07,
// and ZERO of them carry activity_details — the whole held set
// predates the PR #105 deploy, and the adapter's standing draw is
// only the 25 most recent filings of a rolling 90-day window, so
// re-drawn filings dedupe against their thin originals and busy
// days are sampled rather than covered. This script pages the
// full held window through the fixed normalizer and posts it
// through the same governed door (senate_lda / us_federal /
// lobbying). Enriched filings carry a new identity (their payload
// changed) and land alongside the thin originals; retirement of
// the thin set is the derivation layer's business, not the
// backfill's.
//
// Execution: one-off Render jobs in the Atlas service's own
// environment. Posts go to the service's public URL
// (ATLAS_PUBLIC_URL, defaulting to the Atlas custom domain).
// Inert in the deployed service: nothing imports it.
//
// Usage:
//   node scripts/backfillLdaHistory.mjs [--from 2026-08-17]
//        [--to 2026-11-09] [--from-page 13] [--max-pages 500]
//        [--page-size 100]
//

import { pathToFileURL } from 'node:url';

import axios from 'axios';

import { normalizeLobbyingFiling } from '../src/adapters/openSecretsAdapter.js';
import { postSignalsToAtlas } from '../src/adapters/ingestClient.js';

const SENATE_LDA_BASE = 'https://lda.senate.gov/api/v1';
export const LDA_BACKFILL_DEFAULT_FROM = '2026-08-17';

async function withRetry(fn, { attempts = 5, baseDelayMs = 2000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(Math.min(30000, baseDelayMs * 2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

async function defaultHttpGet(url, params) {
  const { data } = await axios.get(url, { params, timeout: 60000, headers: { Accept: 'application/json' } });
  return data;
}

async function defaultPost(signals, apiBaseUrl) {
  return withRetry(() => postSignalsToAtlas({
    sourceId: 'senate_lda',
    jurisdictionId: 'us_federal',
    moduleHint: 'lobbying',
    signals,
    apiBaseUrl,
    batchSize: 25,
  }));
}

// Page the LDA filings endpoint over the posted-date window,
// oldest first so a resume point is a page number, not a guess.
// Returns the API's own total count from the first page read, so
// the summary reconciles fetched-vs-expected without trusting the
// loop.
export async function runLdaBackfill({
  from = LDA_BACKFILL_DEFAULT_FROM,
  to = null,
  fromPage = 1,
  maxPages = 1000,
  pageSize = 100,
  apiBaseUrl,
  httpGet = defaultHttpGet,
  post = defaultPost,
  log = console.log,
} = {}) {
  let page = fromPage;
  let pagesPosted = 0;
  let filingsFetched = 0;
  let apiCount = null;
  let ingested = 0;
  let replayed = 0;
  let recordsFailed = 0;
  let exhausted = false;

  while (pagesPosted < maxPages) {
    const params = {
      filing_dt_posted_after: from,
      ordering: 'dt_posted',
      page_size: pageSize,
      page,
    };
    if (to) params.filing_dt_posted_before = to;
    const data = await httpGet(`${SENATE_LDA_BASE}/filings/`, params);
    const results = Array.isArray(data?.results) ? data.results : null;
    if (!results) {
      throw new Error(`lda_backfill_unrecognised_payload: page ${page} carried no results array — refusing to map it to zero`);
    }
    if (apiCount === null && Number.isFinite(data?.count)) apiCount = data.count;
    if (!results.length) { exhausted = true; break; }

    const signals = results.map(normalizeLobbyingFiling);
    const result = await post(signals, apiBaseUrl);
    filingsFetched += results.length;
    ingested += result.ingested_count ?? 0;
    replayed += result.replayed_count ?? 0;
    recordsFailed += result.records_failed ?? 0;
    pagesPosted += 1;
    log(`[lda-backfill] page ${page}: ${results.length} filings -> ingested=${result.ingested_count ?? 0} replayed=${result.replayed_count ?? 0} failed=${result.records_failed ?? 0}`);

    if (!data?.next) { exhausted = true; break; }
    page += 1;
  }

  return {
    source: 'senate_lda',
    window: { from, to },
    api_count: apiCount,
    pages_posted: pagesPosted,
    filings_fetched: filingsFetched,
    ingested_count: ingested,
    replayed_count: replayed,
    records_failed: recordsFailed,
    next_page: exhausted ? null : page,
    exhausted,
  };
}

export function parseLdaBackfillArgs(argv) {
  const args = { from: LDA_BACKFILL_DEFAULT_FROM, to: null, fromPage: 1, maxPages: 1000, pageSize: 100 };
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--from' && value) {
      if (!dateRe.test(value)) throw new Error(`lda_backfill_bad_from_date: ${value}`);
      args.from = value; i += 1;
    } else if (flag === '--to' && value) {
      if (!dateRe.test(value)) throw new Error(`lda_backfill_bad_to_date: ${value}`);
      args.to = value; i += 1;
    } else if (flag === '--from-page' && value) {
      args.fromPage = Math.max(1, parseInt(value, 10) || 1); i += 1;
    } else if (flag === '--max-pages' && value) {
      args.maxPages = Math.max(1, parseInt(value, 10) || 1000); i += 1;
    } else if (flag === '--page-size' && value) {
      args.pageSize = Math.max(1, Math.min(100, parseInt(value, 10) || 100)); i += 1;
    } else if (flag.startsWith('--')) {
      throw new Error(`lda_backfill_unknown_flag: ${flag}`);
    }
  }
  return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseLdaBackfillArgs(process.argv.slice(2));
  const apiBaseUrl = process.env.ATLAS_PUBLIC_URL || 'https://atlas.columbiacitycustomllc.com';
  const summary = await runLdaBackfill({ ...args, apiBaseUrl });
  console.log(JSON.stringify({ ok: summary.records_failed === 0, ...summary }, null, 2));
  if (summary.records_failed > 0) process.exitCode = 1;
}
