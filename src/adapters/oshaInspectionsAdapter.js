import axios from 'axios';
import dotenv from 'dotenv';
import { postSignalsToAtlas, toIsoTimestamp } from './ingestClient.js';
dotenv.config();

// OSHA enforcement data via DOL API
// ROUTE STATUS (verified 2026-10-31):
// - The enforcedata.dol.gov API below was decommissioned (DOL retired the
//   enforcement data page on 2026-02-23); every path now answers
//   301 -> https://data.dol.gov/ (the portal homepage, HTML).
// - The Socrata fallback host data.dol.gov no longer serves the Socrata
//   API either: /resource/8emu-7hor.json returns the same portal HTML,
//   and the domain is gone from the Socrata catalog.
// - The successor is the DOL Open Data Portal API at api.dol.gov, which
//   requires a free registered API key (registration via data.dol.gov).
//   Once a key exists it belongs in Atlas's env as DOL_API_KEY and the
//   keyed route can be wired here. Until then this stream is
//   credential-blocked upstream, and fetchInspections fails loudly in
//   the logs instead of silently reporting zero.
const OSHA_API_BASE = 'https://enforcedata.dol.gov/api/v2/safety_and_health';

export function normalizeInspection(inspection) {
  const id = inspection.activity_nr || inspection.inspection_id || '';
  const estabName = inspection.estab_name || inspection.establishment_name || 'Unknown';
  const state = inspection.site_state || inspection.state || '';
  const city = inspection.site_city || inspection.city || '';
  const zip = inspection.site_zip || '';
  const openDate = inspection.open_date || inspection.inspection_date || '';
  const closeDate = inspection.close_date || '';
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

// Extract a record array from an API payload. Returns null when the
// payload is not inspection data at all (e.g. the HTML portal page the
// decommissioned endpoints now redirect to), so a dead route is treated
// as a failure instead of being silently mapped to zero records.
function asInspectionRecords(payload) {
  const rows = payload?.results || payload;
  return Array.isArray(rows) ? rows : null;
}

export async function fetchInspections({ state = 'WA', limit = 100 } = {}) {
  try {
    // DOL enforcement data API (decommissioned — see route status above;
    // kept so a restored route needs no code change)
    const response = await axios.get(`${OSHA_API_BASE}/inspections`, {
      params: {
        site_state: state,
        limit,
        offset: 0,
        sort: '-open_date',
      },
      timeout: 30000,
      headers: { Accept: 'application/json' },
    });
    const results = asInspectionRecords(response.data);
    if (results === null) throw new Error('primary route returned a non-data payload');
    if (results.length) return results.map(normalizeInspection);
  } catch (e) {
    // Fall through to the fallback on errors AND on empty/non-data
    // primary results. Previously the fallback only ran when the
    // primary threw, so a moved endpoint answering 200-with-HTML
    // produced a silent zero.
  }
  try {
    // Fallback: Socrata-based OSHA dataset (host retired — see above)
    const socrataUrl = 'https://data.dol.gov/resource/8emu-7hor.json';
    const response = await axios.get(socrataUrl, {
      params: {
        $where: `site_state = '${state}'`,
        $order: 'open_date DESC',
        $limit: limit,
      },
      timeout: 30000,
    });
    const results = asInspectionRecords(response.data);
    if (results === null) throw new Error('fallback route returned a non-data payload');
    return results.map(normalizeInspection);
  } catch (e2) {
    console.warn(`OSHA fetch failed: both DOL routes are unavailable (enforcedata API decommissioned 2026-02-23; successor api.dol.gov requires a registered DOL_API_KEY). ${e2.message}`);
    return [];
  }
}

export async function ingestOshaSignals({ state = 'WA', apiBaseUrl } = {}) {
  const signals = await fetchInspections({ state });
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
