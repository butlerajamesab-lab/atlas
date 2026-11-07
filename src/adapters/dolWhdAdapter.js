import axios from 'axios';
import dotenv from 'dotenv';
import { postSignalsToAtlas, toIsoTimestamp } from './ingestClient.js';
dotenv.config();

// WHD enforcement data via the DOL Open Data API v4.
//
// The dol_whd_violations stream has been registered since 2026-05-09
// (dol_whd / us_federal / labor_enforcement) but never had a fetch
// adapter: the only WHD code was a records-push door in
// officialAgencyRecordsAdapter.js, which nothing ever fed. This
// adapter is the fetch side, wired to the same DOL v4 contract as the
// OSHA successor (PR #85).
//
// Dataset (verified 2026-11-06 against the keyless catalog and
// metadata endpoints): Wage and Hour Division, "Enforcement" — all
// concluded WHD compliance actions since FY2005, refreshed quarterly.
//   GET https://apiprod.dol.gov/v4/datasets       -> tablename
//     WHD_enforcement, api_url "enforcement"
//   GET https://apiprod.dol.gov/v4/datasets/10362 -> 110 field
//     definitions + preview rows (field names below are from it)
// Data route: GET https://apiprod.dol.gov/v4/get/WHD/enforcement/json
// with the registered key as the X-API-KEY query parameter from
// Atlas's env (DOL_API_KEY), exactly as the OSHA successor does.
//
// Draw shape: the stream is registered federally, so the draw is
// national — the 100 most recently loaded concluded cases per run.
// Sorting is by load_dt (the publisher's own load stamp), NOT by
// findings_end_date: findings dates are the period WHD's findings
// cover (not case open/close dates), some rows carry none, and the
// source itself carries occasional far-future typos — load_dt is the
// freshness order that cannot trap the draw on undated rows. Replay
// dedupe downstream absorbs overlap between quarterly refreshes.
//
// Integrity declarations (2026-11-07): alongside each case signal,
// this adapter also emits DECLARED numeric observations for the
// Domain 3 integrity engine (src/services/
// integrityPatternDetectorService.js). That engine is deliberately
// strict: it detects only over structures a governed source adapter
// explicitly declares in payload.integrity_observation — it never
// infers structure from raw record fields. For every case carrying
// a findings_end_date, the adapter declares one observation:
//   metric        findings_end_date (as epoch days)
//   expected_min  the dataset's documented coverage start,
//                 2005-01-01 (concluded actions since FY2005, per
//                 the DOL catalog record for WHD_enforcement)
//   expected_max  the record's own load_dt in epoch days — a
//                 concluded case's findings period cannot end
//                 after the publisher loaded the record
// A record whose findings_end_date falls outside that declared
// range (the source carries at least one far-future typo, a
// findings end dated 3021) is exactly what the engine's
// numeric_range_anomaly rule exists to surface — as an anomaly
// observation, never as a finding of wrongdoing. Declarations are
// posted to the dedicated atlas_integrity_observations stream
// (registration: src/schema/
// 20261107_integrity_observations_stream_registration.sql). Cases
// without a findings_end_date, or without a load_dt to bound
// against, emit NO declaration — a missing value is not a number,
// and an unbounded observation would be an inference, not a
// declaration.
const DOL_WHD_ENFORCEMENT_URL = 'https://apiprod.dol.gov/v4/get/WHD/enforcement/json';

function asNumber(value) {
  const parsed = parseFloat(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeWhdCase(record) {
  const caseId = record.case_id ?? '';
  const legalName = record.legal_name || record.trade_nm || 'Unknown';
  const tradeName = record.trade_nm || '';
  const state = record.st_cd || '';
  const city = record.cty_nm || '';
  const zip = record.zip_cd || '';
  const violationCount = asNumber(record.case_violtn_cnt);
  const backWages = asNumber(record.bw_atp_amt);
  const penalties = asNumber(record.cmp_assd);
  const repeatViolator = record.flsa_repeat_violator || '';
  const isRepeatOrWillful = ['R', 'W', 'RW'].includes(repeatViolator);

  return {
    signal_type: violationCount > 0 ? 'dol_whd_violation' : 'dol_whd_no_violation_found',
    timestamp: toIsoTimestamp(record.findings_end_date || record.findings_start_date),
    spacetime: {
      region: state ? `us_state_${state}` : 'us_federal',
      jurisdiction: state ? `us_state_${state}` : 'us_federal',
      city,
      state,
      zip,
    },
    provenance: {
      channel: 'dol_whd',
      source_system: 'whd_enforcement',
      confidence: 1.0,
      source_url: null,
    },
    payload: {
      external_id: `whd_${caseId}`,
      case_id: caseId,
      employer_legal_name: legalName,
      employer_trade_name: tradeName,
      street_address: record.street_addr_1_txt || '',
      city,
      state,
      zip,
      naics_code: record.naic_cd || '',
      naics_description: record.naics_code_description || '',
      findings_start_date: record.findings_start_date || '',
      findings_end_date: record.findings_end_date || '',
      case_violation_count: violationCount,
      employees_violated_count: asNumber(record.ee_violtd_cnt),
      back_wages_agreed_amt: backWages,
      employees_agreed_to_pay_count: asNumber(record.ee_atp_cnt),
      civil_money_penalties_assd: penalties,
      flsa_violation_count: asNumber(record.flsa_violtn_cnt),
      flsa_back_wages_amt: asNumber(record.flsa_bw_atp_amt),
      flsa_minimum_wage_bw_amt: asNumber(record.flsa_mw_bw_atp_amt),
      flsa_overtime_bw_amt: asNumber(record.flsa_ot_bw_atp_amt),
      flsa_repeat_violator: repeatViolator,
      is_repeat_or_willful: isRepeatOrWillful,
      child_labor_violation_count: asNumber(record.flsa_cl_violtn_cnt),
      child_labor_minors_count: asNumber(record.flsa_cl_minor_cnt),
      raw: record,
    },
  };
}

// Build the v4 query parameters for one page of WHD enforcement
// cases: newest loaded first (see the header for why load_dt, not a
// findings date, is the sort key).
export function buildWhdParams({ limit = 100, offset = 0, apiKey } = {}) {
  return {
    limit,
    offset,
    sort: 'desc',
    sort_by: 'load_dt',
    'X-API-KEY': apiKey,
  };
}

// Default transport: one axios GET, resolving to the parsed JSON body.
// Tests inject a stub httpGet with this same shape.
async function defaultHttpGet(url, { params } = {}) {
  const response = await axios.get(url, {
    params,
    timeout: 30000,
    headers: { Accept: 'application/json' },
  });
  return response.data;
}

// Extract the record array from a v4 payload. Returns null when the
// payload is not case data at all, so an unexpected response is a
// failure instead of a silent zero. The recognised envelopes mirror
// the OSHA successor's tolerance; an unrecognised shape fails loudly
// and names the keys it actually saw.
const RECORD_ARRAY_KEYS = ['WHD_enforcement', 'data', 'records', 'results', 'enforcement'];

export function extractWhdRecords(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    for (const key of RECORD_ARRAY_KEYS) {
      if (Array.isArray(payload[key])) return payload[key];
    }
  }
  return null;
}

function payloadShape(payload) {
  if (Array.isArray(payload)) return 'array';
  if (payload && typeof payload === 'object') return `object keys=[${Object.keys(payload).join(',')}]`;
  return typeof payload;
}

// Surface the API's own error detail instead of axios's generic
// message. The dataset URL printed here carries no query string, so
// the API key (a query parameter) can never leak into a log line.
function whdRequestError(error) {
  const status = error?.response?.status ?? null;
  const body = error?.response?.data;
  const detail = typeof body === 'string'
    ? body
    : body?.error || body?.detail || body?.message || error?.message || String(error);
  const wrapped = new Error(
    `dol_whd_request_failed url=${DOL_WHD_ENFORCEMENT_URL}` +
    `${status ? ` status=${status}` : ''}` +
    ` detail=${String(detail).slice(0, 300)}`
  );
  wrapped.status = status;
  wrapped.cause = error;
  return wrapped;
}

export async function fetchWhdRecords({ limit = 100, offset = 0, httpGet = defaultHttpGet } = {}) {
  // Fail before any request when the key is absent: a credential
  // block must read as a failure in the run receipts, never a
  // silent zero.
  const apiKey = process.env.DOL_API_KEY;
  if (!apiKey) {
    throw new Error(
      'dol_whd_request_failed: DOL_API_KEY is not set. The DOL Open Data API requires a ' +
      'registered API key as the X-API-KEY query parameter (register at ' +
      'https://dataportal.dol.gov/registration); refusing to issue a request that would ' +
      'fail with HTTP 401.'
    );
  }

  let payload;
  try {
    payload = await httpGet(DOL_WHD_ENFORCEMENT_URL, {
      params: buildWhdParams({ limit, offset, apiKey }),
    });
  } catch (e) {
    throw whdRequestError(e);
  }

  const results = extractWhdRecords(payload);
  if (results === null) {
    throw new Error(
      `dol_whd_unexpected_payload: response from ${DOL_WHD_ENFORCEMENT_URL} was not ` +
      `case data (payload shape: ${payloadShape(payload)}). Refusing to map an ` +
      'unrecognised payload to zero records.'
    );
  }
  return results;
}

export async function fetchWhdCases(args = {}) {
  const records = await fetchWhdRecords(args);
  return records.map(normalizeWhdCase);
}

// --- Integrity declarations ----------------------------------------
// The declared-range rule for WHD findings dates. Versioned so a
// future bounds change is a new rule, never a silent edit.
export const WHD_FINDINGS_RANGE_RULE = 'whd_findings_end_date_range_v1';

// The dataset's documented coverage start: concluded WHD compliance
// actions since FY2005 (DOL Open Data catalog, WHD_enforcement,
// verified 2026-11-06).
const WHD_COVERAGE_START = '2005-01-01';

// Whole days since the Unix epoch for an ISO date or datetime
// string, computed on the UTC calendar date. Returns null for
// anything that is not a real calendar date — Date.UTC alone
// tolerates overflow (month 13 rolls over), so the components are
// round-tripped and must match.
export function epochDays(value) {
  if (value === undefined || value === null || value === '') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value).trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = Date.UTC(year, month - 1, day);
  const check = new Date(ms);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return Math.floor(ms / 86_400_000);
}

// Build the declared numeric observation for one WHD record (see
// the header). Returns null when the record cannot carry an honest
// declaration: no case id, no findings_end_date, an unparseable
// date, or no load_dt to bound the range against.
export function buildWhdFindingsDeclaration(record) {
  const caseId = record?.case_id ?? '';
  const findingsEnd = record?.findings_end_date || '';
  const loadDt = record?.load_dt || '';
  const actual = epochDays(findingsEnd);
  const expectedMax = epochDays(loadDt);
  if (!caseId || actual === null || expectedMax === null) return null;

  const legalName = record.legal_name || record.trade_nm || 'Unknown';
  const state = record.st_cd || '';
  const jurisdictionId = state ? `us_state_${state}` : 'us_federal';

  return {
    signal_type: 'declared_numeric_observation',
    timestamp: toIsoTimestamp(loadDt),
    spacetime: {
      region: jurisdictionId,
      jurisdiction: jurisdictionId,
      city: record.cty_nm || '',
      state,
      zip: record.zip_cd || '',
    },
    provenance: {
      channel: 'atlas_integrity_declaration',
      source_system: 'whd_enforcement',
      confidence: 1.0,
      source_url: null,
      declared_by: 'dol_whd_adapter',
      declaration_rule: WHD_FINDINGS_RANGE_RULE,
    },
    payload: {
      external_id: `whd_decl_findings_end_${caseId}`,
      declaration_kind: 'numeric_observation',
      declaration_rule: WHD_FINDINGS_RANGE_RULE,
      source_case_id: caseId,
      source_external_id: `whd_${caseId}`,
      source_dataset: 'WHD_enforcement',
      employer_legal_name: legalName,
      employer_trade_name: record.trade_nm || '',
      findings_end_date: findingsEnd,
      load_dt: loadDt,
      bounds_basis: {
        expected_min:
          'Dataset coverage start: concluded WHD compliance actions since FY2005 ' +
          '(DOL Open Data catalog record for WHD_enforcement).',
        expected_max:
          "The record's own load_dt: a concluded case's findings period cannot end " +
          'after the publisher loaded the record.',
      },
      integrity_observation: {
        kind: 'numeric_observation',
        observation_id: `whd_findings_end:${caseId}`,
        subject_canonical_entity_id: `whd_case:${caseId}`,
        subject_name: `${legalName} — WHD case ${caseId}`,
        metric: 'findings_end_date',
        actual,
        expected_min: epochDays(WHD_COVERAGE_START),
        expected_max: expectedMax,
        observed_at: toIsoTimestamp(loadDt),
        jurisdiction_id: jurisdictionId,
      },
    },
  };
}

export function buildWhdDeclarations(records) {
  return (records || []).map(buildWhdFindingsDeclaration).filter(Boolean);
}

export async function ingestWhdSignals({ apiBaseUrl, httpGet, limit } = {}) {
  const records = await fetchWhdRecords({ httpGet, limit });
  const signals = records.map(normalizeWhdCase);
  if (!signals.length) {
    return { accepted: true, ingested_count: 0, note: 'No WHD enforcement cases returned' };
  }
  const result = await postSignalsToAtlas({
    sourceId: 'dol_whd',
    jurisdictionId: 'us_federal',
    moduleHint: 'labor_enforcement',
    signals,
    apiBaseUrl,
  });
  // Declarations ride the same fetched records through their own
  // governed door. A declaration failure fails the run visibly,
  // exactly like a case-post failure — never a silent skip.
  const declarations = buildWhdDeclarations(records);
  let declarationResult = null;
  if (declarations.length) {
    declarationResult = await postSignalsToAtlas({
      sourceId: 'atlas_integrity',
      jurisdictionId: 'us_federal',
      moduleHint: 'integrity_observation',
      signals: declarations,
      apiBaseUrl,
    });
  }
  return { ...result, declarations_posted: declarations.length, declaration_result: declarationResult };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Fetching WHD enforcement cases (newest loaded, national)...');
  const result = await ingestWhdSignals({});
  console.log(JSON.stringify({ ok: true, source: 'dol_whd', result }, null, 2));
}
