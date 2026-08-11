import { firstValue, ingestSocrataObservations, observationEnvelope, stableExternalId } from './socrataPublicDataAdapter.js';

export const OREGON_COMPLAINTS_API_URL = 'https://data.oregon.gov/resource/2ix7-8hwk.json';
export const OREGON_COMPLAINTS_SOURCE_URL = 'https://data.oregon.gov/Public-Safety/Oregon-Consumer-Complaints/2ix7-8hwk';

export function normalizeOregonComplaint(record) {
  const openedDate = firstValue(record, ['date_open']);
  const closedDate = firstValue(record, ['date_closed']);
  const business = firstValue(record, ['respondent']) || 'Unknown Business';
  const businessType = firstValue(record, ['business_type']);
  const description = firstValue(record, ['complaint_description']);
  const city = firstValue(record, ['city']);
  const state = firstValue(record, ['state']) || 'OR';
  const zip = firstValue(record, ['zip']);
  const referenceNo = firstValue(record, ['reference_no_']);
  const id = stableExternalId('or_doj', record, ['reference_no_'], [openedDate, business, city, businessType, description]);
  return observationEnvelope({
    signalType: 'state_ag_consumer_complaint', timestamp: openedDate || closedDate, jurisdiction: 'us_state_or',
    region: 'us_state_or', channel: 'oregon_doj', sourceSystem: 'oregon_department_of_justice_consumer_protection', sourceUrl: OREGON_COMPLAINTS_SOURCE_URL,
    geography: { state, city, zip },
    payload: {
      external_id: id, complaint_id: referenceNo, business_name: business, business_type: businessType,
      complaint_description: description, closing_description: firstValue(record, ['closing_description']), status: firstValue(record, ['status']),
      opened_date: openedDate, closed_date: closedDate, business_address_1: firstValue(record, ['address_1']), business_address_2: firstValue(record, ['address_2']),
      business_city: city, business_state: state, business_zip: zip, location_by_zip: firstValue(record, ['location_by_zip']),
      disclaimer: 'A complaint record is an allegation/consumer report and is not by itself evidence of wrongdoing.',
    },
  });
}

export function ingestOregonConsumerComplaints({ limit = 5000, apiBaseUrl } = {}) {
  return ingestSocrataObservations({ apiUrl: OREGON_COMPLAINTS_API_URL, sourceId: 'or_doj', jurisdictionId: 'us_state_or', moduleHint: 'consumer_protection', normalize: normalizeOregonComplaint, limit, pageSize: 1000, apiBaseUrl });
}
