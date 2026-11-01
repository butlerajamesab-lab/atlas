// Contract tests for the OSHA adapter's DOL Open Data API v4 route
// (repair/osha-dol-successor-2026-11-01).
//
// The two routes this adapter used before are dead (enforcedata.dol.gov
// decommissioned 2026-02-23; the data.dol.gov Socrata host retired).
// The successor is the DOL Open Data API v4 at apiprod.dol.gov
// (DOL API User Guide, data.dol.gov, updated 2024-08-05):
//   GET https://apiprod.dol.gov/v4/get/OSHA/inspection/json
// with the registered API key as the X-API-KEY query parameter.
//
// These tests run entirely against a stubbed HTTP transport — no
// network, no real key. They pin:
//   1. the request URL and the auth placement (key read from
//      process.env.DOL_API_KEY at call time, sent as the X-API-KEY
//      query parameter, never hardcoded in the source);
//   2. the response -> signal mapping for inspection records;
//   3. loud failure — a rejection, never a silent zero — when the key
//      is absent, when the API errors, and when the payload shape is
//      not inspection data.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildInspectionParams,
  extractInspectionRecords,
  fetchInspections,
  ingestOshaSignals,
  normalizeInspection,
} from '../src/adapters/oshaInspectionsAdapter.js';

const adapterSource = readFileSync(
  new URL('../src/adapters/oshaInspectionsAdapter.js', import.meta.url),
  'utf8',
);

const SENTINEL_KEY = 'test-sentinel-key-not-a-real-credential';

// Run fn with DOL_API_KEY set to value (or deleted when undefined),
// restoring the previous environment afterwards.
async function withDolKey(value, fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, 'DOL_API_KEY');
  const previous = process.env.DOL_API_KEY;
  if (value === undefined) delete process.env.DOL_API_KEY;
  else process.env.DOL_API_KEY = value;
  try {
    return await fn();
  } finally {
    if (had) process.env.DOL_API_KEY = previous;
    else delete process.env.DOL_API_KEY;
  }
}

// A stub transport in the adapter's httpGet shape: records every call
// and delegates the response to handler.
function stubTransport(handler) {
  const calls = [];
  const httpGet = async (url, options) => {
    calls.push({ url, options });
    return handler(url, options);
  };
  return { calls, httpGet };
}

const WA_INSPECTION = {
  activity_nr: '1234567',
  estab_name: 'Example Builders LLC',
  site_address: '100 Pine St',
  site_city: 'Seattle',
  site_state: 'WA',
  site_zip: '98101',
  open_date: '2026-09-14',
  close_conf_date: '2026-10-02',
  insp_type: 'Complaint',
  sic_code: '1522',
  naics_code: '236118',
  total_current_penalty: '4200',
};

test('OSHA fetch targets the v4 inspection URL with the key as X-API-KEY query param', async () => {
  const { calls, httpGet } = stubTransport(async () => []);
  await withDolKey(SENTINEL_KEY, () => fetchInspections({ state: 'WA', limit: 25, httpGet }));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://apiprod.dol.gov/v4/get/OSHA/inspection/json');
  const params = calls[0].options.params;
  assert.equal(params['X-API-KEY'], SENTINEL_KEY);
  assert.equal(params.limit, 25);
  assert.equal(params.offset, 0);
  assert.equal(params.sort, 'desc');
  assert.equal(params.sort_by, 'open_date');
  assert.deepEqual(JSON.parse(params.filter_object), {
    field: 'site_state',
    operator: 'eq',
    value: 'WA',
  });
});

test('buildInspectionParams carries the env-supplied key and the state filter', () => {
  const params = buildInspectionParams({ state: 'OR', limit: 10, offset: 5, apiKey: SENTINEL_KEY });
  assert.equal(params['X-API-KEY'], SENTINEL_KEY);
  assert.equal(params.limit, 10);
  assert.equal(params.offset, 5);
  assert.deepEqual(JSON.parse(params.filter_object), {
    field: 'site_state',
    operator: 'eq',
    value: 'OR',
  });
});

test('the API key comes from the environment, never from the source', () => {
  assert.match(adapterSource, /process\.env\.DOL_API_KEY/);
  assert.doesNotMatch(adapterSource, /test-sentinel-key/);
  // No dead route survives in the adapter.
  assert.doesNotMatch(adapterSource, /enforcedata\.dol\.gov\/api/);
  assert.doesNotMatch(adapterSource, /data\.dol\.gov\/resource/);
});

test('inspection records map to the established signal shape', async () => {
  const { httpGet } = stubTransport(async () => ({ data: [WA_INSPECTION] }));
  const signals = await withDolKey(SENTINEL_KEY, () => fetchInspections({ state: 'WA', httpGet }));

  assert.equal(signals.length, 1);
  const [signal] = signals;
  assert.equal(signal.signal_type, 'workplace_safety_inspection');
  assert.equal(signal.timestamp, new Date('2026-09-14').toISOString());
  assert.equal(signal.spacetime.region, 'us_state_WA');
  assert.equal(signal.spacetime.jurisdiction, 'us_state_WA');
  assert.equal(signal.spacetime.city, 'Seattle');
  assert.equal(signal.spacetime.state, 'WA');
  assert.equal(signal.spacetime.zip, '98101');
  assert.equal(signal.provenance.channel, 'osha');
  assert.equal(signal.provenance.source_system, 'osha_enforcement');
  assert.equal(signal.provenance.source_url, 'https://www.osha.gov/pls/imis/establishment.inspection_detail?id=1234567');
  assert.equal(signal.payload.external_id, 'osha_1234567');
  assert.equal(signal.payload.activity_nr, '1234567');
  assert.equal(signal.payload.establishment_name, 'Example Builders LLC');
  assert.equal(signal.payload.open_date, '2026-09-14');
  assert.equal(signal.payload.close_date, '2026-10-02');
  assert.equal(signal.payload.total_penalty, 4200);
  assert.equal(signal.payload.naics_code, '236118');
  assert.equal(signal.payload.inspection_type, 'Complaint');
  assert.equal(signal.payload.is_severe, false);
});

test('a bare array payload is accepted, and a high-penalty record is severe', async () => {
  const severe = { ...WA_INSPECTION, activity_nr: '7654321', total_current_penalty: '75000' };
  const { httpGet } = stubTransport(async () => [severe]);
  const signals = await withDolKey(SENTINEL_KEY, () => fetchInspections({ state: 'WA', httpGet }));
  assert.equal(signals.length, 1);
  assert.equal(signals[0].signal_type, 'severe_workplace_violation');
  assert.equal(signals[0].payload.is_severe, true);
  assert.equal(signals[0].payload.total_penalty, 75000);
});

test('normalizeInspection keeps the pre-rewrite field fallbacks', () => {
  const signal = normalizeInspection({
    inspection_id: '999',
    establishment_name: 'Fallback Co',
    state: 'OR',
    city: 'Portland',
    inspection_date: '2026-01-05',
    penalty: '10',
    violation_type: 'Willful',
  });
  assert.equal(signal.payload.external_id, 'osha_999');
  assert.equal(signal.payload.establishment_name, 'Fallback Co');
  assert.equal(signal.spacetime.jurisdiction, 'us_state_OR');
  assert.equal(signal.signal_type, 'severe_workplace_violation');
});

test('extractInspectionRecords rejects shapes that are not inspection data', () => {
  assert.equal(extractInspectionRecords('<html>portal</html>'), null);
  assert.equal(extractInspectionRecords({ unexpected: true }), null);
  assert.equal(extractInspectionRecords(null), null);
  assert.deepEqual(extractInspectionRecords([]), []);
  assert.deepEqual(extractInspectionRecords({ OSHA_inspection: [1] }), [1]);
});

test('missing DOL_API_KEY fails loudly before any request is issued', async () => {
  const { calls, httpGet } = stubTransport(async () => []);
  await withDolKey(undefined, async () => {
    await assert.rejects(
      () => fetchInspections({ state: 'WA', httpGet }),
      /DOL_API_KEY is not set/,
    );
  });
  assert.equal(calls.length, 0);
});

test('an API error fails loudly with status and the API detail, and never leaks the key', async () => {
  const apiError = new Error('Request failed with status code 401');
  apiError.response = {
    status: 401,
    data: 'The API key is either incorrect or missing from your query.',
  };
  const { httpGet } = stubTransport(async () => { throw apiError; });
  await withDolKey(SENTINEL_KEY, async () => {
    await assert.rejects(
      () => fetchInspections({ state: 'WA', httpGet }),
      (error) => {
        assert.match(error.message, /osha_dol_request_failed/);
        assert.match(error.message, /status=401/);
        assert.match(error.message, /API key is either incorrect or missing/);
        assert.doesNotMatch(error.message, /test-sentinel-key/);
        return true;
      },
    );
  });
});

test('a non-data payload fails loudly instead of mapping to zero', async () => {
  const { httpGet } = stubTransport(async () => '<html><body>portal</body></html>');
  await withDolKey(SENTINEL_KEY, async () => {
    await assert.rejects(
      () => fetchInspections({ state: 'WA', httpGet }),
      /osha_dol_unexpected_payload/,
    );
  });
});

test('ingest preserves the osha_inspections / us_state_WA / workplace_safety tuple', async () => {
  // Source-level pin, in the style of streamRegistrationContract.test.js:
  // the governed ingest resolver keys on exactly this tuple.
  assert.match(adapterSource, /sourceId:\s*'osha_inspections'/);
  assert.match(adapterSource, /jurisdictionId:\s*`us_state_\$\{state\}`/);
  assert.match(adapterSource, /moduleHint:\s*'workplace_safety'/);

  // And a genuinely empty (but successful) fetch still takes the
  // no-post branch rather than posting an empty batch.
  const { httpGet } = stubTransport(async () => []);
  const result = await withDolKey(SENTINEL_KEY, () => ingestOshaSignals({ state: 'WA', httpGet }));
  assert.equal(result.accepted, true);
  assert.equal(result.ingested_count, 0);
});

test('ingest propagates a fetch failure instead of reporting a zero', async () => {
  const { httpGet } = stubTransport(async () => { throw new Error('socket hang up'); });
  await withDolKey(SENTINEL_KEY, async () => {
    await assert.rejects(() => ingestOshaSignals({ state: 'WA', httpGet }), /osha_dol_request_failed/);
  });
});
