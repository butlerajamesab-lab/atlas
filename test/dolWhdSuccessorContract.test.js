// Contract tests for the WHD adapter's DOL Open Data API v4 route
// (repair/whd-dol-successor-2026-11-06).
//
// The dol_whd_violations stream was registered on 2026-05-09 but
// never had a fetch adapter — only a records-push door
// (officialAgencyRecordsAdapter.js) that nothing ever fed. The fetch
// route is the DOL Open Data API v4, the same contract as the OSHA
// successor (PR #85):
//   GET https://apiprod.dol.gov/v4/get/WHD/enforcement/json
// with the registered API key as the X-API-KEY query parameter.
// Dataset identity and field names were verified 2026-11-06 against
// the keyless catalog (GET /v4/datasets: WHD_enforcement) and the
// metadata endpoint (GET /v4/datasets/10362: 110 field definitions
// plus preview rows). The fixtures below are trimmed from that
// endpoint's own published preview rows.
//
// These tests run entirely against a stubbed HTTP transport — no
// network, no real key. They pin:
//   1. the request URL and params (newest-loaded-first via load_dt)
//      and the auth placement (key from process.env.DOL_API_KEY at
//      call time, sent as the X-API-KEY query parameter, never
//      hardcoded);
//   2. the response -> signal mapping for enforcement cases,
//      including the zero-violation (compliance) outcome;
//   3. the governed ingest tuple (dol_whd / us_federal /
//      labor_enforcement) the stream was registered with;
//   4. loud failure — never a silent zero — when the key is absent,
//      when the API errors, and when the payload shape is not case
//      data.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildWhdParams,
  extractWhdRecords,
  fetchWhdCases,
  ingestWhdSignals,
  normalizeWhdCase,
} from '../src/adapters/dolWhdAdapter.js';

const adapterSource = readFileSync(
  new URL('../src/adapters/dolWhdAdapter.js', import.meta.url),
  'utf8',
);

const SENTINEL_KEY = 'test-sentinel-key-not-a-real-credential';

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

function stubTransport(handler) {
  const calls = [];
  const httpGet = async (url, options) => {
    calls.push({ url, options });
    return handler(url, options);
  };
  return { httpGet, calls };
}

// Trimmed from the DOL metadata endpoint's published preview rows
// (GET /v4/datasets/10362, read 2026-11-06).
const VIOLATION_CASE = {
  case_id: 1784005,
  trade_nm: 'Healthcare Services Group at Westwood Center',
  legal_name: 'Healthcare Services Group, Inc.',
  street_addr_1_txt: '298 Main Street',
  cty_nm: 'Keene',
  st_cd: 'NH',
  zip_cd: '03431',
  naic_cd: '0967',
  naics_code_description: 'Local Nursing Homes',
  case_violtn_cnt: 1,
  cmp_assd: 0.0,
  ee_violtd_cnt: 0,
  bw_atp_amt: 0.0,
  ee_atp_cnt: 0,
  findings_start_date: '2019-01-01T00:00:00',
  findings_end_date: '2020-06-30T00:00:00',
  flsa_violtn_cnt: 1,
  flsa_repeat_violator: 'N/A',
  flsa_bw_atp_amt: 0.0,
};

const COMPLIANCE_CASE = {
  case_id: 1428484,
  trade_nm: 'Reliant Energy',
  legal_name: 'Reliant Energy Retail Services, LLC',
  street_addr_1_txt: '1000 Main',
  cty_nm: 'Houston',
  st_cd: 'TX',
  zip_cd: '77002',
  naic_cd: '09310',
  naics_code_description: 'State Generation and Distribution of Electric Power',
  case_violtn_cnt: 0,
  cmp_assd: 0.0,
  ee_violtd_cnt: 1,
  bw_atp_amt: 0.0,
  ee_atp_cnt: 0,
  findings_start_date: '2005-06-20T00:00:00',
  findings_end_date: '2005-07-19T00:00:00',
  flsa_violtn_cnt: 0,
  flsa_repeat_violator: 'N/A',
  flsa_bw_atp_amt: 0.0,
};

test('request targets the WHD enforcement v4 route, newest loaded first', async () => {
  const { httpGet, calls } = stubTransport(async () => []);
  await withDolKey(SENTINEL_KEY, () => fetchWhdCases({ httpGet }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://apiprod.dol.gov/v4/get/WHD/enforcement/json');
  const params = calls[0].options.params;
  assert.equal(params['X-API-KEY'], SENTINEL_KEY);
  assert.equal(params.sort, 'desc');
  assert.equal(params.sort_by, 'load_dt');
  assert.equal(params.limit, 100);
});

test('buildWhdParams carries limit/offset and the key as a query parameter', () => {
  const params = buildWhdParams({ limit: 25, offset: 50, apiKey: SENTINEL_KEY });
  assert.deepEqual(params, {
    limit: 25,
    offset: 50,
    sort: 'desc',
    sort_by: 'load_dt',
    'X-API-KEY': SENTINEL_KEY,
  });
});

test('the API key is never hardcoded in the adapter source', () => {
  assert.doesNotMatch(adapterSource, /X-API-KEY['"]?\s*[:=]\s*['"][A-Za-z0-9]{16,}['"]/);
  assert.match(adapterSource, /process\.env\.DOL_API_KEY/);
});

test('normalize maps a violation case to a dol_whd_violation signal', () => {
  const signal = normalizeWhdCase(VIOLATION_CASE);
  assert.equal(signal.signal_type, 'dol_whd_violation');
  assert.equal(signal.payload.external_id, 'whd_1784005');
  assert.equal(signal.payload.employer_legal_name, 'Healthcare Services Group, Inc.');
  assert.equal(signal.payload.employer_trade_name, 'Healthcare Services Group at Westwood Center');
  assert.equal(signal.payload.case_violation_count, 1);
  assert.equal(signal.spacetime.state, 'NH');
  assert.equal(signal.spacetime.jurisdiction, 'us_state_NH');
  assert.equal(signal.provenance.channel, 'dol_whd');
  assert.equal(signal.payload.raw.case_id, 1784005);
});

test('normalize maps a zero-violation case to the compliance outcome, not a violation', () => {
  const signal = normalizeWhdCase(COMPLIANCE_CASE);
  assert.equal(signal.signal_type, 'dol_whd_no_violation_found');
  assert.equal(signal.payload.case_violation_count, 0);
});

test('normalize flags repeat/willful FLSA violators from the source designation', () => {
  const signal = normalizeWhdCase({ ...VIOLATION_CASE, flsa_repeat_violator: 'RW', bw_atp_amt: 12000.5, cmp_assd: 3000 });
  assert.equal(signal.payload.is_repeat_or_willful, true);
  assert.equal(signal.payload.back_wages_agreed_amt, 12000.5);
  assert.equal(signal.payload.civil_money_penalties_assd, 3000);
  assert.equal(normalizeWhdCase(VIOLATION_CASE).payload.is_repeat_or_willful, false);
});

test('extract accepts bare arrays and the tablename envelope, rejects other shapes', () => {
  assert.deepEqual(extractWhdRecords([VIOLATION_CASE]), [VIOLATION_CASE]);
  assert.deepEqual(extractWhdRecords({ WHD_enforcement: [VIOLATION_CASE] }), [VIOLATION_CASE]);
  assert.deepEqual(extractWhdRecords({ data: [VIOLATION_CASE] }), [VIOLATION_CASE]);
  assert.equal(extractWhdRecords({ html: '<html>portal</html>' }), null);
  assert.equal(extractWhdRecords('not json'), null);
});

test('fetch fails loudly before any request when DOL_API_KEY is absent', async () => {
  const { httpGet, calls } = stubTransport(async () => []);
  await withDolKey(undefined, async () => {
    await assert.rejects(() => fetchWhdCases({ httpGet }), /dol_whd_request_failed: DOL_API_KEY is not set/);
  });
  assert.equal(calls.length, 0);
});

test('fetch surfaces the API error detail and status, without leaking the key', async () => {
  const httpGet = async () => {
    const error = new Error('Request failed with status code 401');
    error.response = { status: 401, data: { error: 'Invalid API key supplied' } };
    throw error;
  };
  await withDolKey(SENTINEL_KEY, async () => {
    await assert.rejects(
      () => fetchWhdCases({ httpGet }),
      (error) => {
        assert.match(error.message, /dol_whd_request_failed/);
        assert.match(error.message, /status=401/);
        assert.match(error.message, /Invalid API key supplied/);
        assert.doesNotMatch(error.message, new RegExp(SENTINEL_KEY));
        return true;
      },
    );
  });
});

test('fetch refuses an unrecognised payload instead of mapping it to zero', async () => {
  const { httpGet } = stubTransport(async () => ({ datasets: [] }));
  await withDolKey(SENTINEL_KEY, async () => {
    await assert.rejects(() => fetchWhdCases({ httpGet }), /dol_whd_unexpected_payload/);
  });
});

test('fetch maps a tablename-envelope payload end to end', async () => {
  const { httpGet } = stubTransport(async () => ({ WHD_enforcement: [VIOLATION_CASE, COMPLIANCE_CASE] }));
  const signals = await withDolKey(SENTINEL_KEY, () => fetchWhdCases({ httpGet }));
  assert.equal(signals.length, 2);
  assert.deepEqual(signals.map((s) => s.signal_type), ['dol_whd_violation', 'dol_whd_no_violation_found']);
});

test('ingest preserves the dol_whd / us_federal / labor_enforcement tuple', async () => {
  // Source-level pin: the governed ingest resolver keys on exactly
  // this tuple, which is the tuple the stream was registered with.
  assert.match(adapterSource, /sourceId:\s*'dol_whd'/);
  assert.match(adapterSource, /jurisdictionId:\s*'us_federal'/);
  assert.match(adapterSource, /moduleHint:\s*'labor_enforcement'/);

  // A genuinely empty (but successful) fetch takes the no-post branch.
  const { httpGet } = stubTransport(async () => []);
  const result = await withDolKey(SENTINEL_KEY, () => ingestWhdSignals({ httpGet }));
  assert.equal(result.accepted, true);
  assert.equal(result.ingested_count, 0);
});

test('ingest propagates a fetch failure instead of reporting a zero', async () => {
  const { httpGet } = stubTransport(async () => { throw new Error('socket hang up'); });
  await withDolKey(SENTINEL_KEY, async () => {
    await assert.rejects(() => ingestWhdSignals({ httpGet }), /dol_whd_request_failed/);
  });
});
