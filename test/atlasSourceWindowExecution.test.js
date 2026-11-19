import assert from 'node:assert/strict';
import test from 'node:test';
import { runIngestCourtListener } from '../src/adapters/courtListenerAdapter.js';
import { runIngestOpenStatesWA } from '../src/adapters/openStatesAdapter.js';
import { assertCompleteAdapterReceipt } from '../src/services/adapterReceiptAcceptance.js';

// The fixture shapes are grounded in the November 1 Atlas read-only inventory of
// archived upstream raw JSON. Values here are fabricated for isolation; they do
// not certify a byte-exact upstream response or consume source API credits.
const courtOpinion = {
  id: 10203, cluster_id: 20304,
  date_created: '2026-10-28T12:30:00Z', absolute_url: '/opinion/20304/example-v-example/',
  cluster: { case_name: 'Example v. Example', docket: { docket_number: '25-test', court_id: 'ca9' } },
};
const openBill = {
  id: 'ocd-bill/example-1', identifier: 'SB 1111', title: 'Example bill',
  updated_at: '2026-10-29T00:00:00Z', latest_action_date: '2026-10-28',
  session: '2025-2026', jurisdiction: { id: 'ocd-jurisdiction/country:us/state:wa/government' },
  openstates_url: 'https://openstates.org/wa/bills/2025-2026/SB1111/',
};

test('CourtListener refuses pagination-incomplete page without posting an observation', async () => {
  let requests = 0, writes = 0;
  const result = await runIngestCourtListener(null, 'fixture-token', 'us_federal',
    async () => { requests++; return {results: [courtOpinion], next: 'https://www.courtlistener.com/api/rest/v3/opinions/?cursor=more'}; },
    async () => { writes++; throw new Error('unexpected Atlas write'); });
  assert.equal(requests, 1);
  assert.equal(writes, 0);
  assert.equal(result.accepted, false);
  assert.equal(result.source_hold.reason, 'source_window_incomplete');
  assert.throws(() => assertCompleteAdapterReceipt(result), /atlas_adapter_missing_receipt/);
});

test('CourtListener preserves dated opinion fields when provider declares end of window', async () => {
  let emitted;
  const result = await runIngestCourtListener(null, 'fixture-token', 'us_federal',
    async () => ({results: [courtOpinion], next: null}),
    async (input) => { emitted = input; return {accepted:true,status:'completed',ingested_count:1,records_failed:0}; });
  assert.equal(result.status, 'completed');
  assert.equal(emitted.sourceId, 'court_listener');
  assert.equal(emitted.signals[0].payload.external_id, 10203);
  assert.equal(emitted.signals[0].timestamp, '2026-10-28T12:30:00.000Z');
  assert.equal(emitted.signals[0].provenance.source_url, 'https://www.courtlistener.com/opinion/20304/example-v-example/');
});

test('OpenStates refuses page 1 when declared pagination continues', async () => {
  let requests = 0, writes = 0;
  const result = await runIngestOpenStatesWA(null, 'fixture-key',
    async () => { requests++; return {results:[openBill],next:2,pagination:{page:1,max_page:2}}; },
    async () => { writes++; throw new Error('unexpected Atlas write'); });
  assert.equal(requests, 1);
  assert.equal(writes, 0);
  assert.equal(result.source_hold.reason, 'source_window_incomplete');
  assert.throws(() => assertCompleteAdapterReceipt(result), /atlas_adapter_missing_receipt/);
});

test('OpenStates preserves source bill identity and date on complete response', async () => {
  let emitted;
  const result = await runIngestOpenStatesWA(null, 'fixture-key',
    async () => ({results:[openBill], next:null, pagination:{page:1,max_page:1}}),
    async input => {emitted=input;return {accepted:true,status:'completed',ingested_count:1,records_failed:0};});
  assert.equal(result.status,'completed');
  assert.equal(emitted.sourceId,'open_states');
  assert.equal(emitted.signals[0].payload.external_id,'ocd-bill/example-1');
  assert.equal(emitted.signals[0].timestamp,'2026-10-29T00:00:00.000Z');
  assert.equal(emitted.signals[0].provenance.source_url,openBill.openstates_url);
});
