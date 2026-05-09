import axios from 'axios';
import dotenv from 'dotenv';
import { postSignalsToAtlas, toIsoTimestamp } from './ingestClient.js';
dotenv.config();

// OSHA enforcement data via DOL API
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

export async function fetchInspections({ state = 'WA', limit = 100 } = {}) {
  try {
    // DOL enforcement data API
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
    const results = response.data?.results || response.data || [];
    return (Array.isArray(results) ? results : []).map(normalizeInspection);
  } catch (e) {
    // Fallback: try the Socrata-based OSHA dataset
    try {
      const socrataUrl = 'https://data.dol.gov/resource/8emu-7hor.json';
      const response = await axios.get(socrataUrl, {
        params: {
          $where: `site_state = '${state}'`,
          $order: 'open_date DESC',
          $limit: limit,
        },
        timeout: 30000,
      });
      return (response.data || []).map(normalizeInspection);
    } catch (e2) {
      console.warn(`OSHA fetch failed: ${e2.message}`);
      return [];
    }
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
