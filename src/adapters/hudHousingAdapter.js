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

export async function fetchHudFmr(stateCode = '53', year = '2024') {
  // HUD API requires a token. If no key, use the bulk CSV endpoint
  if (!HUD_API_KEY) {
    // Fallback: use the FMR summary endpoint (no auth needed for state-level)
    const url = `https://www.huduser.gov/hudapi/public/fmr/statedata/${stateCode}`;
    try {
      const response = await axios.get(url, { timeout: 30000, headers: hudHeaders() });
      const data = response.data?.data || response.data || {};
      const counties = data.counties || data.metroareas || [];
      if (Array.isArray(counties)) {
        return counties.map((c) => normalizeHudFmr(c, year));
      }
    } catch (e) {
      // If HUD API fails without key, generate from known WA county data
    }
  }

  // If we have a key, use the proper endpoint
  const url = `${HUD_API_BASE}/fmr/statedata/${stateCode}`;
  const response = await axios.get(url, { timeout: 30000, headers: hudHeaders() });
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
    jurisdictionId: `us_state_${stateCode}`,
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
