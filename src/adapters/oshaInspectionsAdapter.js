import axios from 'axios';
import dotenv from 'dotenv';
import { postSignalsToAtlas, toIsoTimestamp } from './ingestClient.js';
dotenv.config();

// OSHA enforcement data via the DOL Open Data API (v4)
// ROUTE STATUS (verified 2026-11-01):
// - The old enforcedata.dol.gov API was decommissioned (DOL retired the
//   enforcement data service on 2026-02-23); every path now answers
//   301 -> https://data.dol.gov/ (the portal homepage, HTML).
// - The Socrata fallback host data.dol.gov no longer serves the Socrata
//   API either: /resource/8emu-7hor.json returns the same portal HTML,
//   and the domain is gone from the Socrata catalog. Both dead routes
//   were removed in this rewrite; nothing here falls back to them.
// - The successor is the DOL Open Data API v4 at apiprod.dol.gov
//   (DOL API User Guide, data.dol.gov, last updated 2024-08-05):
//     GET https://apiprod.dol.gov/v4/get/<agency>/<endpoint>/json
//   with the dataset's api_url from the Datasets catalog
//   (https://apiprod.dol.gov/v4/datasets, no key required there).
//   For OSHA inspections the catalog entry (verified live 2026-11-01)
//   is tablename OSHA_inspection, agency abbreviation OSHA,
//   api_url "inspection", so the data URL is
//     https://apiprod.dol.gov/v4/get/OSHA/inspection/json
// - Auth: a registered API key is a REQUIRED query parameter on every
//   metadata and data request, sent as X-API-KEY (guide, "Parameters").
//   Register at https://dataportal.dol.gov/registration; the key
//   belongs in Atlas's env as DOL_API_KEY. A missing or incorrect key
//   is answered HTTP 401 with a plain-text explanation (verified live
//   2026-11-01 against the exact URL above).
// - Query parameters (guide, "Parameters" / "Conditional Filtering"):
//   limit (default 10, max 10,000 records or 5 MB per request),
//   offset (default 0), fields (comma-separated), sort ("asc"/"desc"),
//   sort_by (field name), and filter_object, a JSON string of
//   {field, operator, value} conditions (operators: eq, neq, gt, lt,
//   in, not_in, like), combinable under {"and": [...]} / {"or": [...]}.
// - The key is read from the environment at call time, never at module
//   load and never hardcoded, so a rotated key needs no code change
//   and tests can stub the environment. It is never written into
//   error messages or logs: errors name the dataset URL (which carries
//   no query string) plus the HTTP status and the API's own detail.
const DOL_OSHA_INSPECTION_URL = 'https://apiprod.dol.gov/v4/get/OSHA/inspection/json';

export function normalizeInspection(inspection) {
  const id = inspection.activity_nr || inspection.inspection_id || '';
  const estabName = inspection.estab_name || inspection.establishment_name || 'Unknown';
  const state = inspection.site_state || inspection.state || '';
  const city = inspection.site_city || inspection.city || '';
  const zip = inspection.site_zip || '';
  const openDate = inspection.open_date || inspection.inspection_date || '';
  const closeDate = inspection.close_date || inspection.close_conf_date || '';
  const violationType = inspection.viol_type || inspection.violation_type || '';
  const penalty = parseFloat(inspection.total_current_penalty || inspection.penalty || 0);
  const gravity = inspection.gravity || '';
  const sic = inspection.sic_code || '';
  const naics = inspection.naics_code || '';

  const isSevere = penalty > 50000 || gravity === 'High' || violationType === 'Willful';

  return {
    signal_type: isSevere ? 'severe_workplace_violation' : 'workplace_safety_inspection',
    timestamp: toIsoTimestamp(openDate),
    spacetime: {
      region: state ? `us_state_${state}` : 'us_federal',
      jurisdiction: state ? `us_state_${state}` : 'us_federal',
      city,
      state,
      zip,
    },
    provenance: {
      channel: 'osha',
      source_system: 'osha_enforcement',
      confidence: 1.0,
      source_url: `https://www.osha.gov/pls/imis/establishment.inspection_detail?id=${id}`,
    },
    payload: {
      external_id: `osha_${id}`,
      activity_nr: id,
      establishment_name: estabName,
      city,
      state,
      zip,
      open_date: openDate,
      close_date: closeDate,
      violation_type: violationType,
      total_penalty: penalty,
      gravity,
      sic_code: sic,
      naics_code: naics,
      is_severe: isSevere,
      inspection_type: inspection.insp_type || null,
      case_status: inspection.case_status || null,
    },
  };
}

// Build the v4 query parameters for one page of OSHA inspections in a
// state. The state filter uses the guide's filter_object form against
// site_state, the same field both dead routes filtered on.
export function buildInspectionParams({ state = 'WA', limit = 100, offset = 0, apiKey } = {}) {
  return {
    limit,
    offset,
    sort: 'desc',
    sort_by: 'open_date',
    filter_object: JSON.stringify({ field: 'site_state', operator: 'eq', value: state }),
    'X-API-KEY': apiKey,
  };
}

// Default transport: one axios GET, resolving to the parsed JSON body.
// Tests inject a stub httpGet with this same shape
// (url, { params }) -> Promise<payload>; a stub that throws an
// axios-shaped error ({ response: { status, data } }) exercises the
// failure path exactly as a real HTTP error would.
async function defaultHttpGet(url, { params } = {}) {
  const response = await axios.get(url, {
    params,
    timeout: 30000,
    headers: { Accept: 'application/json' },
  });
  return response.data;
}

// Extract the record array from a v4 payload. Returns null when the
// payload is not inspection data at all (e.g. an HTML error page, or an
// envelope whose shape this adapter does not recognise), so an
// unexpected response is treated as a failure instead of being
// silently mapped to zero records. The recognised object envelopes
// are a tolerance, NOT a verified fact: the datasets catalog endpoint
// answers under a named key ({"datasets": [...], "meta": {...}}), but
// the data endpoint's exact envelope could not be verified without a
// key (the metadata endpoint requires one). First live run with data
// settles it; an unrecognised shape fails loudly below and names the
// keys it actually saw.
const RECORD_ARRAY_KEYS = ['OSHA_inspection', 'data', 'records', 'results', 'inspection'];

export function extractInspectionRecords(payload) {
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

// Surface the API's own error detail, as the CourtListener repair did:
// axios's generic message ("Request failed with status code 401")
// hides the cause DOL states in its response body. The dataset URL
// printed here carries no query string, so the API key (a query
// parameter) can never leak into an error or a log line.
function dolRequestError(error) {
  const status = error?.response?.status ?? null;
  const body = error?.response?.data;
  const detail = typeof body === 'string'
    ? body
    : body?.error || body?.detail || body?.message || error?.message || String(error);
  const wrapped = new Error(
    `osha_dol_request_failed url=${DOL_OSHA_INSPECTION_URL}` +
    `${status ? ` status=${status}` : ''}` +
    ` detail=${String(detail).slice(0, 300)}`
  );
  wrapped.status = status;
  wrapped.cause = error;
  return wrapped;
}

export async function fetchInspections({ state = 'WA', limit = 100, offset = 0, httpGet = defaultHttpGet } = {}) {
  // Fail before any request when the key is absent: the API answers
  // unauthenticated calls with a guaranteed 401, and a credential
  // block must read as a failure in the run receipts (the scheduler
  // records a thrown adapter error as outcome "failed"), never as a
  // silent zero.
  const apiKey = process.env.DOL_API_KEY;
  if (!apiKey) {
    throw new Error(
      'osha_dol_request_failed: DOL_API_KEY is not set. The DOL Open Data API requires a ' +
      'registered API key as the X-API-KEY query parameter (register at ' +
      'https://dataportal.dol.gov/registration); refusing to issue a request that would ' +
      'fail with HTTP 401.'
    );
  }

  let payload;
  try {
    payload = await httpGet(DOL_OSHA_INSPECTION_URL, {
      params: buildInspectionParams({ state, limit, offset, apiKey }),
    });
  } catch (e) {
    throw dolRequestError(e);
  }

  const results = extractInspectionRecords(payload);
  if (results === null) {
    throw new Error(
      `osha_dol_unexpected_payload: response from ${DOL_OSHA_INSPECTION_URL} was not ` +
      `inspection data (payload shape: ${payloadShape(payload)}). Refusing to map an ` +
      'unrecognised payload to zero records.'
    );
  }
  return results.map(normalizeInspection);
}

export async function ingestOshaSignals({ state = 'WA', apiBaseUrl, httpGet } = {}) {
  const signals = await fetchInspections({ state, httpGet });
  if (!signals.length) {
    return { accepted: true, ingested_count: 0, note: 'No OSHA inspections returned' };
  }
  return postSignalsToAtlas({
    sourceId: 'osha_inspections',
    jurisdictionId: `us_state_${state}`,
    moduleHint: 'workplace_safety',
    signals,
    apiBaseUrl,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const state = process.argv[2] || 'WA';
  console.log(`Fetching OSHA inspections for ${state}...`);
  const result = await ingestOshaSignals({ state });
  console.log(JSON.stringify({ ok: true, source: 'osha', state, result }, null, 2));
}
