import { firstValue, ingestSocrataObservations, observationEnvelope, stableExternalId } from './socrataPublicDataAdapter.js';

export const WA_AG_API_URL = 'https://data.wa.gov/resource/gpri-47xz.json';
export const WA_AG_SOURCE_URL = 'https://data.wa.gov/Consumer-Protection/Attorney-General-Consumer-Complaints/gpri-47xz';

export function normalizeWaAgComplaint(record) {
  const openedDate = firstValue(record, ['openeddate', 'opened_date']);
  const business = firstValue(record, ['business', 'businessname', 'business_name']) || 'Unknown Business';
  const category = firstValue(record, ['businesscategory', 'business_category']);
  const city = firstValue(record, ['businesscity', 'business_city']);
  const state = firstValue(record, ['businessstate', 'business_state']) || 'WA';
  const zip = firstValue(record, ['businesszip', 'business_zip']);
  const id = stableExternalId('wa_ag', record, ['id'], [openedDate, business, city, category]);
  return observationEnvelope({
    signalType: 'state_ag_consumer_complaint', timestamp: openedDate, jurisdiction: 'us_state_wa',
    region: state ? `us_state_${String(state).toLowerCase()}` : 'us_state_wa', channel: 'wa_ag',
    sourceSystem: 'washington_attorney_general_consumer_protection', sourceUrl: WA_AG_SOURCE_URL,
    geography: { state, city, zip },
    payload: {
      external_id: id, complaint_id: firstValue(record, ['id']), business_name: business,
      business_category: category, naics: firstValue(record, ['naics']), naics_name: firstValue(record, ['naicsname', 'naics_name']),
      status: firstValue(record, ['status']), opened_date: openedDate, opened_year: firstValue(record, ['openedyear', 'opened_year']),
      estimated_savings: firstValue(record, ['estimatedsavings', 'estimated_savings']), actual_savings: firstValue(record, ['actualsavings', 'actual_savings']),
      business_street_1: firstValue(record, ['businessstreetline1', 'business_street_line_1']), business_street_2: firstValue(record, ['businessstreetline2', 'business_street_line_2']),
      business_city: city, business_state: state, business_zip: zip, geocode: firstValue(record, ['geocode']),
      disclaimer: 'The existence of a complaint is not evidence of wrongdoing.',
    },
  });
}

export function ingestWaAgComplaints({ limit = 5000, apiBaseUrl } = {}) {
  return ingestSocrataObservations({ apiUrl: WA_AG_API_URL, sourceId: 'wa_ag', jurisdictionId: 'us_state_wa', moduleHint: 'consumer_protection', normalize: normalizeWaAgComplaint, limit, order: 'openeddate DESC', apiBaseUrl });
}
