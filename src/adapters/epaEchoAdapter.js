import axios from 'axios';
import dotenv from 'dotenv';
import { postSignalsToAtlas, toIsoTimestamp } from './ingestClient.js';
dotenv.config();

const EPA_ECHO_BASE = 'https://echodata.epa.gov/echo';

export function normalizeViolation(facility) {
  const name = facility.FacName || facility.facility_name || 'Unknown Facility';
  const registryId = facility.RegistryID || facility.registry_id || '';
  const state = facility.FacState || facility.state || '';
  const city = facility.FacCity || facility.city || '';
  const lat = parseFloat(facility.FacLat || facility.latitude) || null;
  const lng = parseFloat(facility.FacLong || facility.longitude) || null;
  const violationCount = parseInt(facility.CWAVioCount || facility.violations || 0);
  const penaltyAmount = parseFloat(facility.FedPenalty || facility.penalty || 0);
  const lastInspection = facility.CWALastInspDate || facility.last_inspection || null;
  const programAreas = facility.ObjectiveName || facility.program || '';

  const isRepeatOffender = violationCount > 3;
  const signalType = isRepeatOffender ? 'repeat_environmental_violator' : 'environmental_violation';

  return {
    signal_type: signalType,
    timestamp: toIsoTimestamp(lastInspection),
    spacetime: {
      region: state ? `us_state_${state}` : 'us_federal',
      jurisdiction: state ? `us_state_${state}` : 'us_federal',
      city,
      state,
      latitude: lat,
      longitude: lng,
    },
    provenance: {
      channel: 'epa_echo',
      source_system: 'epa_echo_enforcement',
      confidence: 1.0,
      source_url: `https://echo.epa.gov/detailed-facility-report?fid=${registryId}`,
    },
    payload: {
      external_id: `epa_${registryId}`,
      registry_id: registryId,
      facility_name: name,
      city,
      state,
      latitude: lat,
      longitude: lng,
      violation_count: violationCount,
      federal_penalty: penaltyAmount,
      last_inspection: lastInspection,
      program_areas: programAreas,
      is_repeat_offender: isRepeatOffender,
      in_significant_noncompliance: facility.CWASNCFlag === 'Y' || facility.snc === true,
    },
  };
}

export async function fetchViolators({ state = 'WA', minViolations = 1, limit = 100 } = {}) {
  // ECHO REST services for facility search with violations
  const params = {
    output: 'JSON',
    p_st: state,
    p_cwa_viol: 'Y', // Has Clean Water Act violations
    p_act: 'CWA',
    responseset: limit,
  };

  try {
    const response = await axios.get(`${EPA_ECHO_BASE}/cwa_rest_services.get_facilities`, {
      params,
      timeout: 30000,
    });
    const results = response.data?.Results?.Facilities || response.data?.Results?.ClusterOutput?.ClusterData || [];
    return (Array.isArray(results) ? results : []).map(normalizeViolation);
  } catch (e) {
    // Try alternative endpoint
    try {
      const altParams = {
        output: 'JSON',
        p_st: state,
        p_snc: 'Y', // Significant non-compliance
        responseset: limit,
      };
      const response = await axios.get(`${EPA_ECHO_BASE}/rcra_rest_services.get_facilities`, {
        params: altParams,
        timeout: 30000,
      });
      const results = response.data?.Results?.Facilities || [];
      return (Array.isArray(results) ? results : []).map(normalizeViolation);
    } catch (e2) {
      console.warn(`EPA ECHO fetch failed: ${e2.message}`);
      return [];
    }
  }
}

export async function ingestEpaSignals({ state = 'WA', apiBaseUrl } = {}) {
  const signals = await fetchViolators({ state });
  if (!signals.length) {
    return { accepted: true, ingested_count: 0, note: 'No EPA violations returned' };
  }
  return postSignalsToAtlas({
    sourceId: 'epa_echo',
    jurisdictionId: `us_state_${state}`,
    moduleHint: 'environmental_enforcement',
    signals,
    apiBaseUrl,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const state = process.argv[2] || 'WA';
  console.log(`Fetching EPA ECHO violations for ${state}...`);
  const result = await ingestEpaSignals({ state });
  console.log(JSON.stringify({ ok: true, source: 'epa_echo', state, result }, null, 2));
}
