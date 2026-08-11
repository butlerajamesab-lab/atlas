import { firstValue, ingestSocrataObservations, observationEnvelope, stableExternalId } from './socrataPublicDataAdapter.js';

export const NYC_311_API_URL = 'https://data.cityofnewyork.us/resource/erm2-nwe9.json';
export const NYC_311_SOURCE_URL = 'https://data.cityofnewyork.us/Social-Services/311-Service-Requests/erm2-nwe9';

export function normalizeNyc311(record) {
  const created = firstValue(record, ['created_date']);
  const agency = firstValue(record, ['agency']);
  const complaintType = firstValue(record, ['complaint_type']);
  const descriptor = firstValue(record, ['descriptor']);
  const borough = firstValue(record, ['borough']);
  const zip = firstValue(record, ['incident_zip']);
  const address = firstValue(record, ['incident_address']);
  const id = stableExternalId('nyc311', record, ['unique_key'], [created, agency, complaintType, borough, address]);
  return observationEnvelope({
    signalType: 'municipal_service_request', timestamp: created, jurisdiction: 'us_city_nyc',
    region: borough ? `nyc_borough_${String(borough).toLowerCase().replaceAll(' ', '_')}` : 'us_city_nyc', channel: 'nyc_311', sourceSystem: 'new_york_city_311', sourceUrl: NYC_311_SOURCE_URL,
    geography: { borough, zip, latitude: firstValue(record, ['latitude']), longitude: firstValue(record, ['longitude']) },
    payload: { external_id: id, request_id: firstValue(record, ['unique_key']), agency, agency_name: firstValue(record, ['agency_name']), complaint_type: complaintType, descriptor, location_type: firstValue(record, ['location_type']), status: firstValue(record, ['status']), created_date: created, closed_date: firstValue(record, ['closed_date']), due_date: firstValue(record, ['due_date']), resolution_description: firstValue(record, ['resolution_description']), incident_address: address, street_name: firstValue(record, ['street_name']), city: firstValue(record, ['city']), borough, incident_zip: zip, community_board: firstValue(record, ['community_board']), council_district: firstValue(record, ['council_district']) },
  });
}

export function ingestNyc311ServiceRequests({ limit = 5000, apiBaseUrl } = {}) {
  return ingestSocrataObservations({ apiUrl: NYC_311_API_URL, sourceId: 'nyc_311', jurisdictionId: 'us_city_nyc', moduleHint: 'municipal_services', normalize: normalizeNyc311, limit, order: 'created_date DESC', apiBaseUrl });
}
