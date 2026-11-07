// Contract tests for the WHD historical backfill script
// (feature/whd-history-backfill-2026-11-07).
//
// The backfill pages the adapter's governed fetch and posts
// through the adapter's governed doors; these tests pin the
// paging loop's contract with stubbed effects — ordering,
// accounting, exhaustion, resume offsets, and loud failure —
// plus the argument parser's bounds. No network, no key.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BACKFILL_CASE_TUPLE,
  BACKFILL_DECLARATION_TUPLE,
  isTransientError,
  parseBackfillArgs,
  runBackfill,
} from '../scripts/backfillWhdHistory.mjs';

const NO_WAIT = { maxAttempts: 3, baseDelayMs: 1, rateLimitDelayMs: 1, sleepFn: async () => {} };

function record(caseId, findingsEnd = '2020-06-30T00:00:00') {
  return {
    case_id: caseId,
    legal_name: `Employer ${caseId} LLC`,
    trade_nm: '',
    st_cd: 'WA',
    cty_nm: 'Seattle',
    zip_cd: '98101',
    case_violtn_cnt: 1,
    findings_start_date: '2019-01-01T00:00:00',
    findings_end_date: findingsEnd,
    load_dt: '2026-10-09T08:25:28',
  };
}

function harness(pages) {
  const calls = { fetch: [], cases: [], declarations: [] };
  let index = 0;
  return {
    calls,
    fetchPage: async ({ limit, offset }) => {
      calls.fetch.push({ limit, offset });
      const page = pages[index] || [];
      index += 1;
      return page;
    },
    postCases: async (signals) => { calls.cases.push(signals); return { accepted: true }; },
    postDeclarations: async (signals) => { calls.declarations.push(signals); return { accepted: true }; },
  };
}

test('tuples match the governed doors exactly', () => {
  assert.deepEqual(BACKFILL_CASE_TUPLE, {
    sourceId: 'dol_whd', jurisdictionId: 'us_federal', moduleHint: 'labor_enforcement',
  });
  assert.deepEqual(BACKFILL_DECLARATION_TUPLE, {
    sourceId: 'atlas_integrity', jurisdictionId: 'us_federal', moduleHint: 'integrity_observation',
  });
});

test('pages in offset order and stops at the short page', async () => {
  const h = harness([
    [record(1), record(2)],
    [record(3), record(4)],
    [record(5)],
  ]);
  const summary = await runBackfill({
    ...h, fromOffset: 0, maxPages: 10, pageSize: 2, delayMs: 0,
  });
  assert.deepEqual(h.calls.fetch.map((c) => c.offset), [0, 2, 4]);
  assert.equal(summary.records_fetched, 5);
  assert.equal(summary.case_signals_posted, 5);
  assert.equal(summary.declaration_signals_posted, 5);
  assert.equal(summary.pages_posted, 3);
  assert.equal(summary.exhausted, true);
  assert.equal(summary.next_offset, 5);
  // Cases post through the case shape; declarations carry the observation.
  assert.equal(h.calls.cases[0][0].signal_type, 'dol_whd_violation');
  assert.equal(h.calls.declarations[0][0].payload.integrity_observation.metric, 'findings_end_date');
});

test('max-pages bounds the run and reports the resume offset', async () => {
  const full = [record(1), record(2)];
  const h = harness([full, full, full, full]);
  const summary = await runBackfill({
    ...h, fromOffset: 1000, maxPages: 2, pageSize: 2, delayMs: 0,
  });
  assert.deepEqual(h.calls.fetch.map((c) => c.offset), [1000, 1002]);
  assert.equal(summary.pages_posted, 2);
  assert.equal(summary.exhausted, false);
  assert.equal(summary.next_offset, 1004);
});

test('undated cases post no declarations for their page', async () => {
  const h = harness([[record(1, ''), record(2, '')]]);
  const summary = await runBackfill({
    ...h, fromOffset: 0, maxPages: 5, pageSize: 2, delayMs: 0,
  });
  assert.equal(summary.case_signals_posted, 2);
  assert.equal(summary.declaration_signals_posted, 0);
  assert.equal(h.calls.declarations.length, 0);
});

test('a fetch failure stops the sweep cleanly instead of reporting partial success', async () => {
  const h = harness([[record(1), record(2)]]);
  const failing = {
    ...h,
    fetchPage: async () => { throw new Error('dol_whd_request_failed status=503'); },
  };
  const summary = await runBackfill({
    ...failing, fromOffset: 0, maxPages: 3, pageSize: 2, delayMs: 0, retry: NO_WAIT,
  });
  assert.equal(summary.pages_posted, 0);
  assert.equal(summary.case_signals_posted, 0);
  assert.equal(summary.next_offset, 0);
  assert.match(summary.stopped_reason, /fetch_failed offset=0: dol_whd_request_failed status=503/);
});

test('a non-array page is a loud failure, not a silent zero', async () => {
  const h = harness([]);
  const weird = { ...h, fetchPage: async () => ({ nope: true }) };
  await assert.rejects(
    () => runBackfill({ ...weird, fromOffset: 0, maxPages: 1, pageSize: 2, delayMs: 0 }),
    /backfill_fetch_unexpected/,
  );
});

test('a rate-limited fetch is retried and the page still lands', async () => {
  let fetches = 0;
  const h = harness([[record(1), record(2)]]);
  const flaky = {
    ...h,
    fetchPage: async (args) => {
      fetches += 1;
      if (fetches < 3) throw new Error('dol_whd_request_failed status=429 detail=');
      return h.fetchPage(args);
    },
  };
  const summary = await runBackfill({
    ...flaky, fromOffset: 0, maxPages: 5, pageSize: 2, delayMs: 0, retry: NO_WAIT,
  });
  // 3 fetches for the retried first page + 1 for the empty page
  // that proves exhaustion.
  assert.equal(fetches, 4);
  assert.equal(summary.case_signals_posted, 2);
  assert.equal(summary.stopped_reason, null);
  assert.equal(summary.exhausted, true);
});

test('a timed-out post is retried; dedupe makes the replay safe', async () => {
  let posts = 0;
  const h = harness([[record(1), record(2)]]);
  const flaky = {
    ...h,
    postCases: async (signals) => {
      posts += 1;
      if (posts === 1) throw new Error('timeout of 60000ms exceeded');
      return h.postCases(signals);
    },
  };
  const summary = await runBackfill({
    ...flaky, fromOffset: 0, maxPages: 5, pageSize: 2, delayMs: 0, retry: NO_WAIT,
  });
  assert.equal(posts, 2);
  assert.equal(summary.case_signals_posted, 2);
  assert.equal(summary.stopped_reason, null);
});

test('exhausted retries stop cleanly with the resume offset at the failed page', async () => {
  const h = harness([[record(1), record(2)], [record(3), record(4)]]);
  const doomed = {
    ...h,
    fetchPage: async ({ offset }) => {
      if (offset === 2) throw new Error('dol_whd_request_failed status=503 detail=');
      return h.fetchPage({ limit: 2, offset });
    },
  };
  const summary = await runBackfill({
    ...doomed, fromOffset: 0, maxPages: 5, pageSize: 2, delayMs: 0, retry: NO_WAIT,
  });
  assert.equal(summary.pages_posted, 1);
  assert.equal(summary.case_signals_posted, 2);
  assert.equal(summary.next_offset, 2);
  assert.match(summary.stopped_reason, /fetch_failed offset=2/);
});

test('non-transient errors are not retried', async () => {
  assert.equal(isTransientError(new Error('dol_whd_request_failed status=429')), true);
  assert.equal(isTransientError(new Error('dol_whd_request_failed status=503')), true);
  assert.equal(isTransientError(new Error('timeout of 60000ms exceeded')), true);
  assert.equal(isTransientError(new Error('DOL_API_KEY is required')), false);
  assert.equal(isTransientError(new Error('dol_whd_unexpected_payload')), false);
  let fetches = 0;
  const h = harness([]);
  const fatal = {
    ...h,
    fetchPage: async () => { fetches += 1; throw new Error('DOL_API_KEY is required'); },
  };
  const summary = await runBackfill({
    ...fatal, fromOffset: 0, maxPages: 2, pageSize: 2, delayMs: 0, retry: NO_WAIT,
  });
  assert.equal(fetches, 1);
  assert.match(summary.stopped_reason, /fetch_failed offset=0/);
});

test('argument parser honors flags and ignores junk', () => {
  assert.deepEqual(parseBackfillArgs([]), {
    fromOffset: 0, maxPages: 10, pageSize: 100, delayMs: 250,
  });
  assert.deepEqual(
    parseBackfillArgs(['--from-offset', '5000', '--max-pages', '300', '--page-size', '100', '--delay-ms', '0', '--bogus']),
    { fromOffset: 5000, maxPages: 300, pageSize: 100, delayMs: 0 },
  );
  // Out-of-bound values fall back to defaults rather than running wild.
  assert.equal(parseBackfillArgs(['--page-size', '99999']).pageSize, 100);
  assert.equal(parseBackfillArgs(['--max-pages', '0']).maxPages, 10);
});
