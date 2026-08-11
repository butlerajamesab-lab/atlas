import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeComplaint } from '../src/adapters/cfpbComplaintsAdapter.js';
import { normalizeWaAgComplaint } from '../src/adapters/waAgConsumerComplaintsAdapter.js';
import { normalizeOregonComplaint } from '../src/adapters/oregonConsumerComplaintsAdapter.js';
import { normalizeNyc311 } from '../src/adapters/nyc311ServiceRequestsAdapter.js';
import { normalizeChicago311 } from '../src/adapters/chicago311ServiceRequestsAdapter.js';
import { ADAPTER_STREAM_IDS } from '../src/services/scheduler.js';

test('CFPB complaint remains an observation with stable actor and jurisdiction fields', () => {
  const row = normalizeComplaint({ complaint_id: '100', company: 'Example Bank', state: 'OR', date_received: '2026-08-01', issue: 'Fees' });
  assert.equal(row.signal_type, 'consumer_complaint');
  assert.equal(row.payload.external_id, 'cfpb_100');
  assert.equal(row.payload.company, 'Example Bank');
  assert.equal(row.spacetime.jurisdiction, 'us_state_or');
});

test('WA AG complaint preserves business identity and disclaimer', () => {
  const row = normalizeWaAgComplaint({ id: '44', openeddate: '2026-07-01', business: 'Example Holdings LLC', businesscategory: 'Property Management', businessstate: 'WA' });
  assert.equal(row.payload.external_id, 'wa_ag_44');
  assert.equal(row.payload.business_name, 'Example Holdings LLC');
  assert.match(row.payload.disclaimer, /not evidence of wrongdoing/i);
});

test('Oregon complaint normalizer tolerates source-schema aliases', () => {
  const row = normalizeOregonComplaint({ complaint_number: 'OR-9', date_opened: '2026-07-02', respondent_name: 'Example Holdings LLC', complaint_type: 'Housing' });
  assert.equal(row.payload.external_id, 'or_doj_OR-9');
  assert.equal(row.payload.business_name, 'Example Holdings LLC');
  assert.equal(row.spacetime.jurisdiction, 'us_state_or');
});

test('municipal complaint/service streams preserve request identity', () => {
  const nyc = normalizeNyc311({ unique_key: 'NY-1', created_date: '2026-07-03', agency: 'HPD', complaint_type: 'HEAT/HOT WATER', borough: 'BROOKLYN' });
  const chi = normalizeChicago311({ sr_number: 'CHI-1', created_date: '2026-07-03', sr_type: 'Building Violation', owner_department: 'Buildings' });
  assert.equal(nyc.payload.external_id, 'nyc311_NY-1');
  assert.equal(chi.payload.external_id, 'chi311_CHI-1');
});

test('scheduler binds all complaint acquisition adapters to canonical stream ids', () => {
  assert.equal(ADAPTER_STREAM_IDS.cfpb_complaints, 'cfpb_complaints');
  assert.equal(ADAPTER_STREAM_IDS.wa_ag_consumer_complaints, 'wa_ag_consumer_complaints');
  assert.equal(ADAPTER_STREAM_IDS.or_doj_consumer_complaints, 'or_doj_consumer_complaints');
  assert.equal(ADAPTER_STREAM_IDS.nyc_311_service_requests, 'nyc_311_service_requests');
  assert.equal(ADAPTER_STREAM_IDS.chicago_311_service_requests, 'chicago_311_service_requests');
});
