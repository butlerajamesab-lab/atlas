import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  DMAP_QUERY_URL,
  SNC_DETECTION_CODES,
  SNC_UNRESOLVED_RESOLUTION_CODES,
  buildPermitsQuery,
  buildViolationSummaryQuery,
  buildSncQuery,
  dmapGraphql,
  fetchViolators,
  mapDmapFacilityToEchoRecord,
  normalizeViolation,
} from '../src/adapters/epaEchoAdapter.js';

const adapter = readFileSync(new URL('../src/adapters/epaEchoAdapter.js', import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
// Source contract: the ECHO two-step retrieval is gone; the ingest tuple and
// signal provenance the downstream legs key on are preserved exactly.
// ---------------------------------------------------------------------------

test('EPA adapter reads DMAP-EF, never the broken ECHO two-step retrieval', () => {
  assert.match(adapter, /data\.epa\.gov\/dmapservice\/query/);
  assert.doesNotMatch(adapter, /echodata\.epa\.gov/);
  assert.doesNotMatch(adapter, /get_facilities/);
  assert.doesNotMatch(adapter, /get_qid/);
  assert.equal(DMAP_QUERY_URL, 'https://data.epa.gov/dmapservice/query');
});

test('EPA adapter preserves the exact ingest tuple', () => {
  assert.match(adapter, /sourceId: 'epa_echo'/);
  assert.match(adapter, /jurisdictionId: `us_state_\$\{state\}`/);
  assert.match(adapter, /moduleHint: 'environmental_enforcement'/);
});

test('EPA adapter fails loudly instead of returning a silent zero', () => {
  assert.match(adapter, /epa_dmap_request_failed/);
  assert.match(adapter, /epa_dmap_unexpected_shape/);
  assert.doesNotMatch(adapter, /console\.warn\(`EPA ECHO fetch failed/);
});

// ---------------------------------------------------------------------------
// Request construction
// ---------------------------------------------------------------------------

test('permits query scopes by the state-prefixed NPDES permit number', () => {
  const q = buildPermitsQuery('WA', { limit: 250, offset: 500 });
  assert.match(q, /icis__icis_permit/);
  assert.match(q, /external_permit_nmbr: \{beginsWith: "WA"\}/);
  assert.match(q, /limit: 250, offset: 500/);
  assert.throws(() => buildPermitsQuery('W'), /epa_dmap_invalid_state/);
  assert.throws(() => buildPermitsQuery('W1'), /epa_dmap_invalid_state/);
});

test('violation summary query groups counts and recency per permit', () => {
  const q = buildViolationSummaryQuery([111, 222]);
  assert.match(q, /icis__icis_npdes_violation/);
  assert.match(q, /permit_activity_id: \{in: \[111,222\]\}/);
  assert.match(q, /groupBy: \["permit_activity_id"\]/);
  assert.match(q, /fn__count\(parameters: \["npdes_violation_id"\], alias: "violation_count"\)/);
  assert.match(q, /fn__max\(parameters: \["single_event_violation_date"\], alias: "last_violation_date"\)/);
});

test('SNC query uses the documented detection and unresolved-resolution codes', () => {
  const q = buildSncQuery([111]);
  // Chronic (C/H/Z), TRC (T/R/V/U/X/Y) and enforcement-order (A/P) detection
  // types from icis.ref_rnc_detection.
  for (const code of ['C', 'H', 'Z', 'T', 'R', 'V', 'U', 'X', 'Y', 'A', 'P']) {
    assert.ok(SNC_DETECTION_CODES.includes(code), `missing detection code ${code}`);
    assert.match(q, new RegExp(`"${code}"`));
  }
  // '1' and 'A' are the "NC - Unresolved" codes in icis.ref_rnc_resolution.
  assert.deepEqual(SNC_UNRESOLVED_RESOLUTION_CODES, ['1', 'A']);
  assert.match(q, /rnc_resolution_code: \{in: \["1", "A"\]\}/);
});

// ---------------------------------------------------------------------------
// Field-by-field mapping: DMAP source -> ECHO-shaped record -> signal
// ---------------------------------------------------------------------------

test('mapDmapFacilityToEchoRecord maps every ECHO field from its DMAP source', () => {
  const record = mapDmapFacilityToEchoRecord({
    icis_facility_interest_id: 9001,
    facility_name: 'ACME WATER RECLAMATION', // icis_facility_interest.facility_name -> FacName
    facility_uin: '110012345678', //            icis_facility_interest.facility_uin -> RegistryID
    state_code: 'WA', //                        icis_facility_interest.state_code -> FacState
    city: 'TACOMA', //                          icis_facility_interest.city -> FacCity
    geocode_latitude: '47.25', //               icis_facility_interest.geocode_latitude -> FacLat
    geocode_longitude: '-122.44', //            icis_facility_interest.geocode_longitude -> FacLong
    violation_count: 5, //                      count of icis_npdes_violation rows -> CWAVioCount
    federal_penalty: 1750.5, //                 sum of icis_enf_conclusion.fed_penalty_assessed_amt -> FedPenalty
    last_inspection_date: '2024-06-01', //      max icis_activity.actual_end_date of CWA comp-monitor activities -> CWALastInspDate
    snc_open_count: 2, //                       unresolved SNC-type violations -> CWASNCFlag
    last_violation_date: '2025-03-03',
    npdes_permit_numbers: ['WA0001111'],
  });
  assert.equal(record.FacName, 'ACME WATER RECLAMATION');
  assert.equal(record.RegistryID, '110012345678');
  assert.equal(record.FacState, 'WA');
  assert.equal(record.FacCity, 'TACOMA');
  assert.equal(record.FacLat, '47.25');
  assert.equal(record.FacLong, '-122.44');
  assert.equal(record.CWAVioCount, 5);
  assert.equal(record.FedPenalty, 1750.5);
  assert.equal(record.CWALastInspDate, '2024-06-01');
  assert.equal(record.ObjectiveName, 'Clean Water Act'); // NPDES by construction
  assert.equal(record.CWASNCFlag, 'Y');
  assert.equal(mapDmapFacilityToEchoRecord({ snc_open_count: 0 }).CWASNCFlag, 'N');
});

// ---------------------------------------------------------------------------
// Stubbed transport: full fetch pipeline
// ---------------------------------------------------------------------------

function idsInQuery(query) {
  return new Set((query.match(/\d+/g) || []).map(Number));
}

function makeStubDmap() {
  const queries = [];
  const permits = [
    { activity_id: 111, external_permit_nmbr: 'WA0001111' },
    { activity_id: 222, external_permit_nmbr: 'WA0002222' },
    { activity_id: 333, external_permit_nmbr: 'WA0003333' },
  ];
  const violationSummaries = [
    { permit_activity_id: 111, violation_count: 2, last_violation_date: '2024-01-01 00:00:00', last_detection_date: '2024-02-01 00:00:00' },
    { permit_activity_id: 222, violation_count: 3, last_violation_date: '2025-03-03 00:00:00', last_detection_date: null },
    { permit_activity_id: 333, violation_count: 1, last_violation_date: '2023-05-05 00:00:00', last_detection_date: null },
  ];
  const facilities = [
    { icis_facility_interest_id: 9001, facility_name: 'ACME WATER RECLAMATION', city: 'TACOMA', state_code: 'WA', facility_uin: '110012345678', geocode_latitude: '47.25', geocode_longitude: '-122.44' },
    { icis_facility_interest_id: 9002, facility_name: 'SMALL DISCHARGER LLC', city: 'YAKIMA', state_code: 'WA', facility_uin: '110087654321', geocode_latitude: null, geocode_longitude: null },
  ];
  const xrefByActivity = [
    { activity_id: 111, icis_facility_interest_id: 9001 },
    { activity_id: 222, icis_facility_interest_id: 9001 },
    { activity_id: 333, icis_facility_interest_id: 9002 },
  ];
  const xrefByFacility = [
    ...xrefByActivity,
    { activity_id: 777, icis_facility_interest_id: 9001 },
    { activity_id: 888, icis_facility_interest_id: 9002 },
  ];

  async function dmapQuery(query) {
    queries.push(query);
    const ids = idsInQuery(query);
    if (query.includes('atlasEpaPermits')) {
      const offset = Number(query.match(/offset: (\d+)/)[1]);
      return { icis__icis_permit: offset === 0 ? permits : [] };
    }
    if (query.includes('atlasEpaViolations')) {
      return { icis__icis_npdes_violation: violationSummaries.filter((r) => ids.has(r.permit_activity_id)) };
    }
    if (query.includes('atlasEpaSnc')) {
      return { icis__icis_npdes_violation: [{ permit_activity_id: 222, snc_open_count: 1 }].filter((r) => ids.has(r.permit_activity_id)) };
    }
    if (query.includes('atlasEpaXrefByActivity')) {
      return { icis__xref_activity_facility_int: xrefByActivity.filter((r) => ids.has(r.activity_id)) };
    }
    if (query.includes('atlasEpaXrefByFacility')) {
      return { icis__xref_activity_facility_int: xrefByFacility.filter((r) => ids.has(r.icis_facility_interest_id)) };
    }
    if (query.includes('atlasEpaFacilities')) {
      return { icis__icis_facility_interest: facilities.filter((r) => ids.has(r.icis_facility_interest_id)) };
    }
    if (query.includes('atlasEpaPrograms')) {
      return { icis__xref_activity_program: [111, 222, 777, 888].filter((id) => ids.has(id)).map((activity_id) => ({ activity_id, program_code: 'CWAOTHR' })) };
    }
    if (query.includes('atlasEpaPenalties')) {
      return { icis__icis_enf_conclusion: [
        { activity_id: 111, fed_penalty_assessed_amt: 250 },
        { activity_id: 777, fed_penalty_assessed_amt: 1500.5 },
      ].filter((r) => ids.has(r.activity_id)) };
    }
    if (query.includes('atlasEpaCompMonitor')) {
      return { icis__icis_comp_monitor: [{ activity_id: 777 }, { activity_id: 888 }].filter((r) => ids.has(r.activity_id)) };
    }
    if (query.includes('atlasEpaActivityDates')) {
      return { icis__icis_activity: [
        { activity_id: 777, actual_begin_date: '2024-05-30 00:00:00', actual_end_date: '2024-06-01 00:00:00' },
        { activity_id: 888, actual_begin_date: '2022-01-15 00:00:00', actual_end_date: null },
      ].filter((r) => ids.has(r.activity_id)) };
    }
    throw new Error(`stub received unrecognized query: ${query.slice(0, 120)}`);
  }
  return { dmapQuery, queries };
}

test('fetchViolators aggregates DMAP rows into the preserved signal shape', async () => {
  const { dmapQuery, queries } = makeStubDmap();
  const signals = await fetchViolators({ state: 'WA', limit: 10, dmapQuery });

  assert.equal(signals.length, 2);
  assert.ok(queries.length >= 8, 'pipeline should page permits, violations, xref, facilities and enrichment');
  assert.match(queries[0], /atlasEpaPermits/);

  const [first, second] = signals; // sorted by violation_count desc
  assert.equal(first.payload.facility_name, 'ACME WATER RECLAMATION');
  assert.equal(first.payload.registry_id, '110012345678');
  assert.equal(first.payload.external_id, 'epa_110012345678');
  assert.equal(first.payload.city, 'TACOMA');
  assert.equal(first.payload.state, 'WA');
  assert.equal(first.payload.latitude, 47.25);
  assert.equal(first.payload.longitude, -122.44);
  assert.equal(first.payload.violation_count, 5); // permits 111 (2) + 222 (3) rolled up
  assert.equal(first.payload.federal_penalty, 1750.5); // enf conclusions on CWA activities 111 + 777
  assert.equal(first.payload.last_inspection, '2024-06-01 00:00:00'); // comp-monitor activity 777 end date
  assert.equal(first.payload.program_areas, 'Clean Water Act');
  assert.equal(first.payload.in_significant_noncompliance, true); // permit 222 has an unresolved SNC-type violation
  assert.equal(first.payload.is_repeat_offender, true);
  assert.equal(first.signal_type, 'repeat_environmental_violator');
  assert.equal(first.payload.last_violation_date, '2025-03-03 00:00:00');
  assert.deepEqual(first.payload.npdes_permit_numbers, ['WA0001111', 'WA0002222']);
  assert.equal(first.payload.dmap_facility_interest_id, 9001);
  assert.equal(first.spacetime.region, 'us_state_WA');
  assert.equal(first.spacetime.jurisdiction, 'us_state_WA');
  assert.equal(first.provenance.channel, 'epa_echo');
  assert.equal(first.provenance.source_system, 'epa_echo_enforcement');
  assert.equal(first.provenance.source_url, 'https://echo.epa.gov/detailed-facility-report?fid=110012345678');
  assert.equal(first.timestamp, new Date('2024-06-01 00:00:00').toISOString());

  assert.equal(second.payload.facility_name, 'SMALL DISCHARGER LLC');
  assert.equal(second.payload.violation_count, 1);
  assert.equal(second.payload.federal_penalty, 0);
  assert.equal(second.payload.last_inspection, '2022-01-15 00:00:00'); // begin date used when end date is null
  assert.equal(second.payload.in_significant_noncompliance, false);
  assert.equal(second.payload.is_repeat_offender, false);
  assert.equal(second.signal_type, 'environmental_violation');
  assert.equal(second.payload.latitude, null);
  assert.equal(second.payload.longitude, null);
});

test('fetchViolators returns an honest empty array when no violations exist', async () => {
  const signals = await fetchViolators({
    state: 'WA',
    dmapQuery: async (query) => {
      if (query.includes('atlasEpaPermits')) return { icis__icis_permit: [] };
      throw new Error(`unexpected query after empty permits: ${query.slice(0, 80)}`);
    },
  });
  assert.deepEqual(signals, []);
});

test('fetchViolators propagates transport failures instead of swallowing them', async () => {
  await assert.rejects(
    fetchViolators({ state: 'WA', dmapQuery: async () => { throw new Error('epa_dmap_request_failed status=503 detail=down'); } }),
    /epa_dmap_request_failed status=503/,
  );
});

test('fetchViolators rejects unexpected payload shapes loudly', async () => {
  await assert.rejects(
    fetchViolators({ state: 'WA', dmapQuery: async () => ({ icis__icis_permit: { not: 'an array' } }) }),
    /epa_dmap_unexpected_shape table=icis__icis_permit/,
  );
});

// ---------------------------------------------------------------------------
// Transport: dmapGraphql against a stubbed HTTP layer
// ---------------------------------------------------------------------------

test('dmapGraphql posts to the DMAP endpoint and returns data', async () => {
  const seen = [];
  const data = await dmapGraphql('query { x }', {
    httpPost: async (url, body) => {
      seen.push([url, body]);
      return { data: { data: { icis__icis_permit: [] }, status: 'COMPLETED' } };
    },
  });
  assert.equal(seen[0][0], 'https://data.epa.gov/dmapservice/query');
  assert.deepEqual(seen[0][1], { query: 'query { x }' });
  assert.deepEqual(data, { icis__icis_permit: [] });
});

test('dmapGraphql surfaces HTTP errors with status and upstream detail', async () => {
  const failure = new Error('Request failed with status code 503');
  failure.response = { status: 503, data: { error: 'DMAP unavailable' } };
  await assert.rejects(
    dmapGraphql('query { x }', { httpPost: async () => { throw failure; } }),
    /epa_dmap_request_failed status=503 detail=DMAP unavailable/,
  );
});

test('dmapGraphql rejects GraphQL error payloads and missing data', async () => {
  await assert.rejects(
    dmapGraphql('query { x }', { httpPost: async () => ({ data: { errors: [{ message: 'table is not available' }] } }) }),
    /epa_dmap_query_failed detail=.*table is not available/,
  );
  await assert.rejects(
    dmapGraphql('query { x }', { httpPost: async () => ({ data: { status: 'COMPLETED' } }) }),
    /epa_dmap_unexpected_payload/,
  );
});

// ---------------------------------------------------------------------------
// Regression: legacy ECHO-shaped records still normalize identically
// ---------------------------------------------------------------------------

test('normalizeViolation still accepts legacy ECHO-shaped records', () => {
  const signal = normalizeViolation({
    FacName: 'LEGACY PLANT',
    RegistryID: '110099999999',
    FacState: 'WA',
    FacCity: 'SPOKANE',
    FacLat: '47.65',
    FacLong: '-117.42',
    CWAVioCount: '2',
    FedPenalty: '100',
    CWALastInspDate: '2023-01-01',
    ObjectiveName: 'Clean Water Act',
    CWASNCFlag: 'Y',
  });
  assert.equal(signal.payload.facility_name, 'LEGACY PLANT');
  assert.equal(signal.payload.violation_count, 2);
  assert.equal(signal.payload.federal_penalty, 100);
  assert.equal(signal.payload.in_significant_noncompliance, true);
  assert.equal(signal.signal_type, 'environmental_violation');
});
