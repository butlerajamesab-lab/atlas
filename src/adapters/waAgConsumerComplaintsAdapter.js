import { firstValue, ingestSocrataObservations, observationEnvelope, stableExternalId } from './socrataPublicDataAdapter.js';

export const WA_AG_API_URL = 'https://data.wa.gov/resource/gpri-47xz.json';
export const WA_AG_SOURCE_URL = 'https://data.wa.gov/Consumer-Protection/Attorney-General-Consumer-Complaints/gpri-47xz';

export function normalizeWaAgComplaint(record) {
  const openedDate = firstValue(record, ['openeddate']);
  const business = firstValue(record, ['business']) || 'Unknown Business';
  const category = firstValue(record, ['businesscategory']);
  const city = firstValue(record, ['businesscity']);
  const state = firstValue(record, ['businessstate']) || 'WA';
  const zip = firstValue(record, ['businesszip']);
  const id = stableExternalId('wa_ag', record, ['id'], [openedDate, business, city, category]);
  return observationEnvelope({
    signalType: 'state_ag_consumer_complaint', timestamp: openedDate, jurisdiction: 'us_state_wa',
    region: 'us_state_wa', channel: 'wa_ag', sourceSystem: 'washington_attorney_general_consumer_protection', sourceUrl: WA_AG_SOURCE_URL,
    geography: { state, city, zip },
    payload: {
      external_id: id, complaint_id: firstValue(record, ['id']), business_name: business,
      business_category: category, naics: firstValue(record, ['naics']), naics_name: firstValue(record, ['naicsname']),
      status: firstValue(record, ['status']), opened_date: openedDate, opened_year: firstValue(record, ['openedyear']),
      estimated_savings: firstValue(record, ['estimatedsavings']), actual_savings: firstValue(record, ['actualsavings']),
      business_street_1: firstValue(record, ['businessstreetline1']), business_street_2: firstValue(record, ['businessstreetline2']),
      business_city: city, business_state: state, business_zip: zip, geocode: firstValue(record, ['geocode']),
      disclaimer: 'The existence of a complaint is not evidence of wrongdoing.',
    },
  });
}

export function ingestWaAgComplaints({ limit = 5000, apiBaseUrl } = {}) {
  return ingestSocrataObservations({ apiUrl: WA_AG_API_URL, sourceId: 'wa_ag', jurisdictionId: 'us_state_wa', moduleHint: 'consumer_protection', normalize: normalizeWaAgComplaint, limit, pageSize: 1000, apiBaseUrl });
}
