import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCourtListenerOpinion } from '../src/adapters/courtListenerAdapter.js';
import { normalizeOpenStatesBill } from '../src/adapters/openStatesAdapter.js';
import { normalizeProPublicaOrganization, ingestProPublicaSignals } from '../src/adapters/proPublicaAdapter.js';

/**
 * Narrow source-field snapshots copied from existing Atlas signal_events.payload.raw
 * during the read-only production check on Nov 1, 2026. These are not new API
 * requests and do NOT certify the original provider's byte-for-byte response.
 * No personal complaint records or non-public data are included.
 */
const courtlistener = Object.freeze({
  id: 11519561,
  cluster_id: 11051775,
  date_created: '2026-11-01T06:02:57.942305-08:00',
  absolute_url: '/opinion/11051775/edward-jason-settle-v-katherine-anne-adolf-valley-grown-nursery-llc-and/',
});
const washingtonBill = Object.freeze({
  id: 'ocd-bill/b517f76a-2c43-4173-8141-02dce2968dc0',
  identifier: 'SB 5519',
  title: 'Reducing environmental impacts associated with the operation of certain ocean-going vessels.',
  session: '2025-2026',
  created_at: '2025-01-27T18:57:48.757366+00:00',
  updated_at: '2026-10-28T10:42:37.335908+00:00',
  openstates_url: 'https://openstates.org/wa/bills/2025-2026/SB5519/',
});
const nonprofit = Object.freeze({
  ein: 331065485,
  name: 'Legacy Salmon Creek Hospital',
  state: 'WA',
  subseccd: 3,
});

test('stored CourtListener source fields retain original opinion identity and source time', () => {
  const event = normalizeCourtListenerOpinion(courtlistener);
  assert.equal(event.payload.external_id, 11519561);
  assert.equal(event.payload.cluster_id, 11051775);
  assert.equal(event.timestamp, '2026-11-01T14:02:57.942Z');
  assert.equal(event.provenance.source_url,
    'https://www.courtlistener.com/opinion/11051775/edward-jason-settle-v-katherine-anne-adolf-valley-grown-nursery-llc-and/');
});

test('stored OpenStates WA source fields retain bill identity, date, and primary URL', () => {
  const event = normalizeOpenStatesBill(washingtonBill, { jurisdiction: 'wa' });
  assert.equal(event.payload.external_id, washingtonBill.id);
  assert.equal(event.payload.identifier, 'SB 5519');
  assert.equal(event.timestamp, '2026-10-28T10:42:37.335Z');
  assert.equal(event.provenance.source_url, washingtonBill.openstates_url);
});

test('stored ProPublica search row has no provider date; it must be held, not redated', async () => {
  assert.throws(() => normalizeProPublicaOrganization(nonprofit), /atlas_source_timestamp_missing/);
  let wrote = false;
  const receipt = await ingestProPublicaSignals({
    organizations: [nonprofit],
    postSignals: async () => { wrote = true; throw Error('source record must not be published'); },
  });
  assert.equal(wrote, false);
  assert.equal(receipt.accepted, false);
  assert.equal(receipt.ingested_count, 0);
  assert.equal(receipt.source_hold_count, 1);
  assert.match(receipt.source_holds[0].source_record_json_sha256, /^[0-9a-f]{64}$/);
});
