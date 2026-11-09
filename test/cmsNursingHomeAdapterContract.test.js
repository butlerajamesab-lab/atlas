// Contract tests for the CMS nursing-home adapter (Provider Data
// Catalog API), built 2026-11-08 on Alexander's direction.
//
// Source class: graded inspector findings (the WHD class), not
// complaint counts. Datasets and field names were verified
// 2026-11-08 against the live public API (no key required); the
// fixtures below are trimmed from first-hand pulls of that API on
// the same day — the deficiency fixture is Kline Galland's real
// F0610 citation row (CCN 505442, survey 2026-03-04) with the
// provider row's verified values.
//
// These tests run entirely against a stubbed HTTP transport. They
// pin:
//   1. the datastore request shape (WA condition, stable sort,
//      limit/offset paging across pages);
//   2. the response -> signal mapping for providers, health and
//      fire-safety deficiencies, and penalties, including the
//      canonical provider identity (cms_provider:<ccn>) every
//      stream joins on;
//   3. the governed ingest tuples (cms_nh / us_state_WA /
//      nursing_home_*) the streams are registered with;
//   4. loud failure — never a silent zero — on API errors and on
//      payloads that are not datastore results.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildCmsDatastoreUrl,
  cmsProviderEntityId,
  fetchCmsDataset,
  ingestCmsHealthDeficiencySignals,
  normalizeCmsFireSafetyDeficiency,
  normalizeCmsHealthDeficiency,
  normalizeCmsPenalty,
  normalizeCmsProvider,
} from '../src/adapters/cmsNursingHomeAdapter.js';

const adapterSource = readFileSync(
  new URL('../src/adapters/cmsNursingHomeAdapter.js', import.meta.url),
  'utf8',
);

const PROVIDER_ROW = {
  cms_certification_number_ccn: '505442',
  provider_name: 'CAROLINE KLINE GALLAND HOME',
  legal_business_name: 'CAROLINE KLINE GALLAND HOME',
  provider_address: '7500 SEWARD PARK AVENUE SOUTH',
  citytown: 'SEATTLE',
  state: 'WA',
  zip_code: '98118',
  latitude: '47.553',
  longitude: '-122.264',
  ownership_type: 'Non profit - Corporation',
  number_of_certified_beds: '205',
  overall_rating: '3',
  health_inspection_rating: '2',
  staffing_rating: '3',
  qm_rating: '5',
  number_of_fines: '0',
  total_amount_of_fines_in_dollars: '0.00',
  number_of_payment_denials: '0',
  rating_cycle_1_standard_survey_health_date: '2026-03-04',
  rating_cycle_1_total_number_of_health_deficiencies: '19',
  processing_date: '2026-10-01',
};

const HEALTH_DEFICIENCY_ROW = {
  cms_certification_number_ccn: '505442',
  provider_name: 'CAROLINE KLINE GALLAND HOME',
  provider_address: '7500 SEWARD PARK AVENUE SOUTH',
  citytown: 'SEATTLE',
  state: 'WA',
  zip_code: '98118',
  survey_date: '2026-03-04',
  survey_type: 'Health',
  survey_footnote: '',
  deficiency_prefix: 'F',
  deficiency_tag_number: '0610',
  deficiency_category: 'Freedom from Abuse, Neglect, and Exploitation Deficiencies',
  deficiency_description: 'Respond appropriately to all alleged violations.',
  scope_severity_code: 'D',
  deficiency_corrected: 'Deficient, Provider has date of correction',
  correction_date: '2026-04-08',
  inspection_cycle: '1',
  standard_deficiency: 'Y',
  complaint_deficiency: 'N',
  infection_control_inspection_deficiency: 'N',
  citation_under_idr: 'N',
  citation_under_iidr: 'N',
  processing_date: '2026-10-01',
};

const FIRE_DEFICIENCY_ROW = {
  ...HEALTH_DEFICIENCY_ROW,
  survey_type: 'Fire Safety',
  deficiency_prefix: 'K',
  deficiency_tag_number: '0353',
  deficiency_category: 'Fire Safety Deficiencies',
  deficiency_description: 'Inspect, test, and maintain automatic extinguishing systems.',
  scope_severity_code: 'E',
};

const PENALTY_ROW = {
  cms_certification_number_ccn: '505442',
  provider_name: 'CAROLINE KLINE GALLAND HOME',
  provider_address: '7500 SEWARD PARK AVENUE SOUTH',
  citytown: 'SEATTLE',
  state: 'WA',
  zip_code: '98118',
  fine_id: '99999',
  penalty_type: 'Fine',
  penalty_date: '2025-06-15',
  fine_amount: '12000',
  payment_denial_start_date: '',
  payment_denial_length_in_days: '',
  processing_date: '2026-10-01',
};

function stubTransport(handler) {
  const calls = [];
  const httpGet = async (url) => {
    calls.push(url);
    return handler(url, calls.length);
  };
  return { httpGet, calls };
}

test('canonical provider identity is the typed CCN key', () => {
  assert.equal(cmsProviderEntityId('505442'), 'cms_provider:505442');
  assert.equal(cmsProviderEntityId(' 505442 '), 'cms_provider:505442');
  assert.equal(cmsProviderEntityId(''), null);
});

test('datastore URL carries the WA condition, paging, and stable sort', () => {
  const url = buildCmsDatastoreUrl('r5ix-sfxw', {
    limit: 500,
    offset: 1000,
    sortProperties: ['cms_certification_number_ccn', 'survey_date', 'deficiency_tag_number'],
  });
  assert.match(url, /datastore\/query\/r5ix-sfxw\/0/);
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('conditions[0][property]'), 'state');
  assert.equal(parsed.searchParams.get('conditions[0][value]'), 'WA');
  assert.equal(parsed.searchParams.get('limit'), '500');
  assert.equal(parsed.searchParams.get('offset'), '1000');
  assert.equal(parsed.searchParams.get('sorts[1][property]'), 'survey_date');
});

test('provider mapping keeps identity, ratings, and penalty totals', () => {
  const signal = normalizeCmsProvider(PROVIDER_ROW);
  assert.equal(signal.signal_type, 'cms_nursing_home_provider');
  assert.equal(signal.payload.external_id, 'cms_nh_provider_505442');
  assert.equal(signal.payload.canonical_entity_id, 'cms_provider:505442');
  assert.equal(signal.payload.overall_rating, 3);
  assert.equal(signal.payload.health_inspection_rating, 2);
  assert.equal(signal.payload.number_of_certified_beds, 205);
  assert.equal(signal.payload.total_amount_of_fines_in_dollars, 0);
  assert.equal(signal.spacetime.jurisdiction, 'us_state_WA');
  assert.equal(signal.spacetime.city, 'SEATTLE');
});

test('health deficiency mapping keeps the tag, grade, and correction state', () => {
  const signal = normalizeCmsHealthDeficiency(HEALTH_DEFICIENCY_ROW);
  assert.equal(signal.signal_type, 'cms_nursing_home_health_deficiency');
  assert.equal(signal.payload.external_id, 'cms_nh_def_505442_2026-03-04_F0610');
  assert.equal(signal.payload.deficiency_tag, 'F0610');
  assert.equal(signal.payload.scope_severity_code, 'D');
  assert.equal(signal.payload.standard_deficiency, 'Y');
  assert.equal(signal.payload.complaint_deficiency, 'N');
  assert.equal(signal.payload.correction_date, '2026-04-08');
  assert.equal(signal.payload.canonical_entity_id, 'cms_provider:505442');
});

test('fire safety mapping is its own signal type on the same identity', () => {
  const signal = normalizeCmsFireSafetyDeficiency(FIRE_DEFICIENCY_ROW);
  assert.equal(signal.signal_type, 'cms_nursing_home_fire_safety_deficiency');
  assert.equal(signal.payload.deficiency_tag, 'K0353');
  assert.match(signal.payload.external_id, /^cms_nh_fire_505442_/);
});

test('penalty mapping keeps the fine identity and amount', () => {
  const signal = normalizeCmsPenalty(PENALTY_ROW);
  assert.equal(signal.signal_type, 'cms_nursing_home_penalty');
  assert.equal(signal.payload.external_id, 'cms_nh_penalty_99999');
  assert.equal(signal.payload.fine_amount, 12000);
  assert.equal(signal.payload.penalty_type, 'Fine');
});

test('fetch pages until a short page and concatenates in order', async () => {
  const page1 = Array.from({ length: 500 }, (_, i) => ({ cms_certification_number_ccn: `505${String(i).padStart(3, '0')}` }));
  const page2 = [{ cms_certification_number_ccn: '505999' }];
  const { httpGet, calls } = stubTransport(async (_url, n) => ({ results: n === 1 ? page1 : page2, count: '501' }));
  const records = await fetchCmsDataset('4pq5-n9py', { httpGet });
  assert.equal(records.length, 501);
  assert.equal(calls.length, 2);
  assert.match(calls[1], /offset=500/);
});

test('fetch refuses an unrecognised payload instead of mapping it to zero', async () => {
  const { httpGet } = stubTransport(async () => ({ datasets: [] }));
  await assert.rejects(() => fetchCmsDataset('r5ix-sfxw', { httpGet }), /cms_nh_unexpected_payload/);
});

test('fetch wraps transport errors with the dataset id and status', async () => {
  const failure = new Error('Request failed');
  failure.response = { status: 503, data: { message: 'Service unavailable' } };
  const { httpGet } = stubTransport(async () => { throw failure; });
  await assert.rejects(
    () => fetchCmsDataset('r5ix-sfxw', { httpGet }),
    (error) => {
      assert.match(error.message, /cms_nh_request_failed dataset=r5ix-sfxw/);
      assert.match(error.message, /status=503/);
      return true;
    },
  );
});

test('ingest preserves the cms_nh / us_state_WA / nursing_home_* tuples', () => {
  assert.match(adapterSource, /sourceId:\s*'cms_nh'/);
  assert.match(adapterSource, /jurisdictionId:\s*JURISDICTION_ID/);
  assert.match(adapterSource, /moduleHint:\s*'nursing_home_provider'/);
  assert.match(adapterSource, /moduleHint:\s*'nursing_home_deficiency'/);
  assert.match(adapterSource, /moduleHint:\s*'nursing_home_fire_safety'/);
  assert.match(adapterSource, /moduleHint:\s*'nursing_home_penalty'/);
});

test('a genuinely empty fetch takes the no-post branch', async () => {
  const { httpGet } = stubTransport(async () => ({ results: [], count: '0' }));
  const result = await ingestCmsHealthDeficiencySignals({ httpGet });
  assert.equal(result.accepted, true);
  assert.equal(result.ingested_count, 0);
});

test('ingest propagates a fetch failure instead of reporting a zero', async () => {
  const { httpGet } = stubTransport(async () => { throw new Error('socket hang up'); });
  await assert.rejects(() => ingestCmsHealthDeficiencySignals({ httpGet }), /cms_nh_request_failed/);
});
