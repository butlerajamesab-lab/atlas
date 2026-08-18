import axios from 'axios';
import dotenv from 'dotenv';
import { postSignalsToAtlas, toIsoTimestamp } from './ingestClient.js';
dotenv.config();

// DOJ FARA (Foreign Agents Registration Act) - tracks foreign influence.
// Current public endpoint contract: /api/v1/Registrants/json/Active
const FARA_API_BASE = 'https://efile.fara.gov/api/v1';

export function normalizeFaraRegistrant(registrant) {
  const name = registrant.Name || registrant.registrant_name || registrant.name || 'Unknown';
  const id = registrant.Registration_Number || registrant.reg_number || registrant.id || '';
  const foreignPrincipal = registrant.Foreign_Principal || registrant.foreign_principal || '';
  const country = registrant.Country || registrant.country || '';
  const state = registrant.State || registrant.state || '';
  const regDate = registrant.Registration_Date || registrant.date || '';
  const status = registrant.Status || registrant.status || 'Active';

  return {
    signal_type: 'foreign_agent_registration',
    timestamp: toIsoTimestamp(regDate),
    spacetime: {
      region: state ? `us_state_${state}` : 'us_federal',
      jurisdiction: 'us_federal',
      country_of_origin: country,
    },
    provenance: {
      channel: 'doj_fara',
      source_system: 'fara_efile',
      confidence: 1.0,
      source_url: `https://efile.fara.gov/docs/${id}`,
    },
    payload: {
      external_id: `fara_${id}`,
      registration_number: id,
      registrant_name: name,
      foreign_principal: foreignPrincipal,
      country,
      state,
      registration_date: regDate,
      status,
    },
  };
}

export function normalizeFaraActivity(activity) {
  const registrantName = activity.registrant_name || activity.Registrant || '';
  const foreignPrincipal = activity.foreign_principal || activity.Foreign_Principal || '';
  const country = activity.country || activity.Country || '';
  const description = activity.description || activity.Description || '';
  const amount = parseFloat(activity.amount || activity.payment || 0);
  const date = activity.date || activity.Date || '';
  const id = activity.id || `${registrantName}_${date}`.replace(/\s+/g, '_');

  const isLarge = amount > 100000;

  return {
    signal_type: isLarge ? 'large_foreign_influence_payment' : 'foreign_influence_activity',
    timestamp: toIsoTimestamp(date),
    spacetime: {
      region: 'us_federal',
      jurisdiction: 'us_federal',
      country_of_origin: country,
    },
    provenance: {
      channel: 'doj_fara',
      source_system: 'fara_efile',
      confidence: 1.0,
      source_url: 'https://efile.fara.gov/ords/fara/production/apex_util.get_blob',
    },
    payload: {
      external_id: `fara_act_${id}`,
      registrant_name: registrantName,
      foreign_principal: foreignPrincipal,
      country,
      description: description.slice(0, 500),
      amount,
      date,
      is_large: isLarge,
    },
  };
}

export async function fetchFaraRegistrants({ country = null, limit = 100 } = {}) {
  // The active-registrant endpoint does not expose foreign-principal country,
  // so country filtering requires a later principal-enrichment pass. Do not
  // invent or infer country from the registrant address.
  void country;
  try {
    const response = await axios.get(`${FARA_API_BASE}/Registrants/json/Active`, {
      timeout: 30000,
      headers: { Accept: 'application/json' },
    });
    const rows = response.data?.REGISTRANTS_ACTIVE?.ROW || [];
    const results = Array.isArray(rows) ? rows : rows ? [rows] : [];
    return results.slice(0, limit).map(normalizeFaraRegistrant);
  } catch (error) {
    console.warn(`FARA fetch failed: ${error.message}`);
    return [];
  }
}

export async function ingestFaraSignals({ country = null, apiBaseUrl } = {}) {
  const signals = await fetchFaraRegistrants({ country });
  if (!signals.length) {
    return { accepted: true, ingested_count: 0, note: 'No FARA data returned' };
  }
  return postSignalsToAtlas({
    sourceId: 'fara',
    jurisdictionId: 'us_federal',
    moduleHint: 'foreign_influence',
    signals,
    apiBaseUrl,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const country = process.argv[2] || null;
  console.log(`Fetching FARA foreign agent registrations${country ? ` for ${country}` : ''}...`);
  const result = await ingestFaraSignals({ country });
  console.log(JSON.stringify({ ok: true, source: 'fara', country, result }, null, 2));
}
