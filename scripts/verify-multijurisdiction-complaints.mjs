import assert from 'node:assert/strict';
import { normalizeComplaint } from '../src/adapters/cfpbComplaintsAdapter.js';
import { normalizeWaAgComplaint } from '../src/adapters/waAgConsumerComplaintsAdapter.js';
import { normalizeOregonComplaint } from '../src/adapters/oregonConsumerComplaintsAdapter.js';
import { normalizeNyc311 } from '../src/adapters/nyc311ServiceRequestsAdapter.js';
import { normalizeChicago311 } from '../src/adapters/chicago311ServiceRequestsAdapter.js';
import { ADAPTER_STREAM_IDS } from '../src/services/scheduler.js';

assert.equal(normalizeComplaint({ complaint_id: '1', company: 'A', state: 'WA', date_received: '2026-01-01' }).payload.external_id, 'cfpb_1');
assert.equal(normalizeWaAgComplaint({ id: '2', business: 'A', openeddate: '2026-01-01' }).payload.external_id, 'wa_ag_2');
assert.equal(normalizeOregonComplaint({ complaint_number: '3', respondent_name: 'A', date_opened: '2026-01-01' }).payload.external_id, 'or_doj_3');
assert.equal(normalizeNyc311({ unique_key: '4', created_date: '2026-01-01' }).payload.external_id, 'nyc311_4');
assert.equal(normalizeChicago311({ sr_number: '5', created_date: '2026-01-01' }).payload.external_id, 'chi311_5');
for (const key of ['cfpb_complaints','wa_ag_consumer_complaints','or_doj_consumer_complaints','nyc_311_service_requests','chicago_311_service_requests']) {
  assert.ok(ADAPTER_STREAM_IDS[key]);
}
console.log('multijurisdiction complaint adapter contract: ok');
