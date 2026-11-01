import axios from 'axios';
import dotenv from 'dotenv';
import { postSignalsToAtlas, toIsoTimestamp } from './ingestClient.js';
dotenv.config();

const HUD_API_BASE = 'https://www.huduser.gov/hudapi/public';
const HUD_API_KEY = process.env.HUD_API_KEY || '';

function hudHeaders() {
  return HUD_API_KEY ? { Authorization: `Bearer ${HUD_API_KEY}` } : {};
}

export function normalizeHudFmr(record, year = '2024') {
  const fips = record.fips_code || record.county_code || record.fips || '';
  const countyName = record.county_name || record.areaname || record.metro_name || 'Unknown';
  const state = record.state_alpha || record.state || 'WA';

  return {
    signal_type: 'housing_affordability',
    timestamp: toIsoTimestamp(`${year}-10-01`),
    spacetime: {
      region: `us_county_${fips}`,
      jurisdiction: `us_state_${state}`,
      county_name: countyName,
      state,
    },
    provenance: {
      channel: 'hud_fmr',
      source_system: 'hud_user_api',
      confidence: 1.0,
      source_url: `https://www.huduser.gov/portal/datasets/fmr.html`,
    },
    payload: {
      external_id: `hud_fmr_${year}_${fips}`,
      county_name: countyName,
      state,
      fips,
      fmr_0br: record.fmr_0 || record.Efficiency || null,
      fmr_1br: record.fmr_1 || record.One_Bedroom || null,
      fmr_2br: record.fmr_2 || record.Two_Bedroom || null,
      fmr_3br: record.fmr_3 || record.Three_Bedroom || null,
      fmr_4br: record.fmr_4 || record.Four_Bedroom || null,
      median_rent: record.fmr_2 || record.Two_Bedroom || null,
      year,
    },
  };
}

// The HUD FMR API addresses states by postal abbreviation
// (statedata/WA). The scheduler hands this adapter the FIPS code
// (STATE_FIPS, '53' for Washington), and statedata/53 answers
// HTTP 400 "Missing or invalid value in the query parameter(s)"
// even with a valid token — the pinned cause of the hud_housing
// failures verified live on 2026-10-31 (same token: /53 -> 400,
// /WA -> 200 with all 39 counties). Translate before requesting.
const STATE_ABBR_BY_FIPS = { '53': 'WA' };

export function resolveStateAbbr(stateCode) {
  const raw = String(stateCode || '').trim();
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
  return STATE_ABBR_BY_FIPS[raw] || raw;
}

export async function fetchHudFmr(stateCode = '53', year = '2024') {
  // TOKEN REQUIREMENT (verified live 2026-10-31): the HUD User FMR API
  // rejects every unauthenticated request with HTTP 401
  // {"error":"Unauthenticated"}. There is no anonymous route. A token
  // is issued by registering an application on huduser.gov
  // (HUD User API / FMR API documentation) and belongs in Atlas's env
  // as HUD_API_KEY. Without it this stream is credential-blocked;
  // say so loudly instead of issuing doomed requests. (Atlas's
  // runtime recorded this failure as HTTP 400; from a clean probe the
  // API's own answer to a missing/invalid token is 401.)
  if (!HUD_API_KEY) {
    console.warn('HUD FMR: HUD_API_KEY is not set. The HUD User FMR API requires a registered Bearer token (register an app at huduser.gov); unauthenticated requests are rejected with 401. Skipping fetch.');
    return [];
  }

  const url = `${HUD_API_BASE}/fmr/statedata/${resolveStateAbbr(stateCode)}`;
  let response;
  try {
    response = await axios.get(url, { timeout: 30000, headers: hudHeaders() });
  } catch (e) {
    // Surface HUD's own error body: axios's generic message ("Request
    // failed with status code 400") hid the parameter cause of this
    // stream's failures throughout the 2026-10-31 repair session.
    const status = e?.response?.status ?? null;
    const body = e?.response?.data;
    const detail = typeof body === 'string' ? body : body?.error || body?.detail || null;
    const wrapped = new Error(
      `hud_request_failed url=${url}` +
      `${status ? ` status=${status}` : ''}` +
      `${detail ? ` detail=${String(detail).slice(0, 240)}` : ''}`
    );
    wrapped.cause = e;
    throw wrapped;
  }
  const data = response.data?.data || response.data || {};
  const counties = data.counties || data.basicdata || [];
  return (Array.isArray(counties) ? counties : []).map((c) => normalizeHudFmr(c, year));
}

export async function ingestHudSignals({ stateCode = '53', year = '2024', apiBaseUrl } = {}) {
  const signals = await fetchHudFmr(stateCode, year);
  if (!signals.length) {
    console.warn('HUD: No data returned. HUD API may require API key (set HUD_API_KEY).');
    return { accepted: true, ingested_count: 0, note: 'HUD API key may be required' };
  }
  return postSignalsToAtlas({
    sourceId: 'hud_fmr',
    jurisdictionId: `us_state_${resolveStateAbbr(stateCode)}`,
    moduleHint: 'housing',
    signals,
    apiBaseUrl,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const stateCode = process.argv[2] || '53';
  console.log(`Fetching HUD Fair Market Rents for state ${stateCode}...`);
  const result = await ingestHudSignals({ stateCode });
  console.log(JSON.stringify({ ok: true, source: 'hud_fmr', stateCode, result }, null, 2));
}
