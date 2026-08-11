import { firstValue, ingestSocrataObservations, observationEnvelope, stableExternalId } from './socrataPublicDataAdapter.js';

export const OREGON_COMPLAINTS_API_URL = 'https://data.oregon.gov/resource/2ix7-8hwk.json';
export const OREGON_COMPLAINTS_SOURCE_URL = 'https://data.oregon.gov/Public-Safety/Oregon-Consumer-Complaints/2ix7-8hwk';

export function normalizeOregonComplaint(record) {
  const openedDate = firstValue(record, ['date_opened', 'opened_date', 'dateopened', 'openeddate', 'complaint_date']);
  const closedDate = firstValue(record, ['date_closed', 'closed_date', 'dateclosed', 'closeddate']);
  const business = firstValue(record, ['business_name', 'respondent_name', 'business', 'company_name', 'respondent']) || 'Unknown Business';
  const businessType = firstValue(record, ['business_type', 'complaint_type', 'category', 'industry']);
  const description = firstValue(record, ['complaint_description', 'description', 'complaint_issue', 'issue']);
  const city = firstValue(record, ['business_city', 'city', 'respondent_city']);
  const state = firstValue(record, ['business_state', 'state', 'respondent_state']) || 'OR';
  const zip = firstValue(record, ['business_zip', 'zip', 'zip_code', 'respondent_zip']);
  const id = stableExternalId('or_doj', record, ['complaint_number', 'complaint_id', 'id'], [openedDate, business, city, businessType, description]);
  return observationEnvelope({
    signalType: 'state_ag_consumer_complaint', timestamp: openedDate || closedDate, jurisdiction: 'us_state_or',
    region: state ? `us_state_${String(state).toLowerCase()}` : 'us_state_or', channel: 'oregon_doj', sourceSystem: 'oregon_department_of_justice_consumer_protection', sourceUrl: OREGON_COMPLAINTS_SOURCE_URL,
    geography: { state, city, zip },
    payload: { external_id: id, complaint_id: firstValue(record, ['complaint_number', 'complaint_id', 'id']), business_name: business, business_type: businessType, complaint_description: description, status: firstValue(record, ['status', 'complaint_status']), opened_date: openedDate, closed_date: closedDate, business_address: firstValue(record, ['business_address', 'address', 'respondent_address']), business_city: city, business_state: state, business_zip: zip, source_record: record, disclaimer: 'A complaint record is an allegation/consumer report and is not by itself evidence of wrongdoing.' },
  });
}

export function ingestOregonConsumerComplaints({ limit = 5000, apiBaseUrl } = {}) {
  return ingestSocrataObservations({ apiUrl: OREGON_COMPLAINTS_API_URL, sourceId: 'or_doj', jurisdictionId: 'us_state_or', moduleHint: 'consumer_protection', normalize: normalizeOregonComplaint, limit, apiBaseUrl });
}
