// Contract tests for the Senate LDA history backfill
// (scripts/backfillLdaHistory.mjs), built 2026-11-09.
//
// The backfill exists because the stream's held window
// (2026-08-17 → 2026-11-07, 1,680 events) carries zero
// activity_details — it predates the PR #105 normalizer fix and
// the standing draw only samples the 25 most recent filings a
// day. These tests pin: the paging loop reconciles against the
// API's own count and reports exhaustion honestly; posted signals
// carry the per-activity substance (description + entities) the
// fix exists for; an unrecognised payload fails loudly instead of
// becoming a zero; arguments are disciplined.

import assert from 'node:assert/strict';
import test from 'node:test';

import { parseLdaBackfillArgs, runLdaBackfill } from '../scripts/backfillLdaHistory.mjs';

const FILING = {
  filing_uuid: 'uuid-1',
  registrant_name: 'Registrant LLC',
  client_name: 'Client Inc',
  income: '120000',
  dt_posted: '2026-09-01T00:00:00Z',
  filing_type: 'Q3',
  registrant: { id: 11 },
  client: { id: 22 },
  lobbying_activities: [
    {
      general_issue_code: 'HCR',
      general_issue_code_display: 'Health Issues',
      description: 'Discussed the Medicare reimbursement rule with committee staff.',
      government_entities: [{ name: 'House of Representatives' }],
      foreign_entity_interest: null,
    },
  ],
};

function stubTransport(pages) {
  const calls = [];
  const httpGet = async (_url, params) => {
    calls.push(params);
    const page = pages[params.page - 1];
    if (!page) return { count: 0, next: null, results: [] };
    return page;
  };
  return { httpGet, calls };
}

function stubPost() {
  const posted = [];
  const post = async (signals) => {
    posted.push(...signals);
    return { ingested_count: signals.length, replayed_count: 0, records_failed: 0 };
  };
  return { post, posted };
}

test('backfill pages to exhaustion and reconciles against the API count', async () => {
  const { httpGet, calls } = stubTransport([
    { count: 3, next: 'x', results: [FILING, FILING] },
    { count: 3, next: null, results: [FILING] },
  ]);
  const { post, posted } = stubPost();
  const summary = await runLdaBackfill({ httpGet, post, log: () => {} });
  assert.equal(summary.exhausted, true);
  assert.equal(summary.api_count, 3);
  assert.equal(summary.filings_fetched, 3);
  assert.equal(summary.pages_posted, 2);
  assert.equal(summary.next_page, null);
  assert.equal(calls[0].filing_dt_posted_after, '2026-08-17');
  assert.equal(calls[0].ordering, 'dt_posted');
  assert.equal(posted.length, 3);
});

test('posted signals carry the per-activity substance (PR #105 shape)', async () => {
  const { httpGet } = stubTransport([{ count: 1, next: null, results: [FILING] }]);
  const { post, posted } = stubPost();
  await runLdaBackfill({ httpGet, post, log: () => {} });
  const details = posted[0].payload.activity_details;
  assert.equal(details.length, 1);
  assert.match(details[0].description, /Medicare reimbursement rule/);
  assert.deepEqual(details[0].government_entities, ['House of Representatives']);
  assert.equal(posted[0].payload.government_entities, 'House of Representatives');
});

test('an unrecognised payload fails loudly instead of reporting zero', async () => {
  const httpGet = async () => ({ unexpected: true });
  const { post } = stubPost();
  await assert.rejects(() => runLdaBackfill({ httpGet, post, log: () => {} }), /unrecognised_payload/);
});

test('max-pages bounds the run and leaves a resume point', async () => {
  const page = { count: 9999, next: 'x', results: [FILING] };
  const { httpGet } = stubTransport([page, page, page, page]);
  const { post } = stubPost();
  const summary = await runLdaBackfill({ httpGet, post, log: () => {}, maxPages: 2, fromPage: 3 });
  assert.equal(summary.exhausted, false);
  assert.equal(summary.pages_posted, 2);
  assert.equal(summary.next_page, 5);
});

test('argument discipline: dates validated, flags known, page size capped', () => {
  assert.equal(parseLdaBackfillArgs([]).from, '2026-08-17');
  assert.equal(parseLdaBackfillArgs(['--from', '2026-01-01']).from, '2026-01-01');
  assert.equal(parseLdaBackfillArgs(['--page-size', '500']).pageSize, 100);
  assert.throws(() => parseLdaBackfillArgs(['--from', 'Aug 17']), /bad_from_date/);
  assert.throws(() => parseLdaBackfillArgs(['--bogus']), /unknown_flag/);
});
