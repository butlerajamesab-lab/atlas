import { firstValue, ingestSocrataObservations, observationEnvelope, stableExternalId } from './socrataPublicDataAdapter.js';

export const CHICAGO_311_API_URL = 'https://data.cityofchicago.org/resource/v6vf-nfxy.json';
export const CHICAGO_311_SOURCE_URL = 'https://data.cityofchicago.org/Service-Requests/311-Service-Requests/v6vf-nfxy';

export function normalizeChicago311(record) {
  const created = firstValue(record, ['created_date']);
  const requestType = firstValue(record, ['sr_type']);
  const department = firstValue(record, ['owner_department', 'created_department']);
  const address = firstValue(record, ['street_address']);
  const zip = firstValue(record, ['zip_code']);
  const id = stableExternalId('chi311', record, ['sr_number'], [created, requestType, address]);
  return observationEnvelope({
    signalType: 'municipal_service_request', timestamp: created, jurisdiction: 'us_city_chicago',
    region: firstValue(record, ['community_area']) ? `chicago_community_area_${firstValue(record, ['community_area'])}` : 'us_city_chicago', channel: 'chicago_311', sourceSystem: 'chicago_311', sourceUrl: CHICAGO_311_SOURCE_URL,
    geography: { zip, ward: firstValue(record, ['ward']), community_area: firstValue(record, ['community_area']), latitude: firstValue(record, ['latitude']), longitude: firstValue(record, ['longitude']) },
    payload: { external_id: id, request_id: firstValue(record, ['sr_number']), request_type: requestType, short_code: firstValue(record, ['sr_short_code']), department, status: firstValue(record, ['status']), origin: firstValue(record, ['origin']), created_date: created, last_modified_date: firstValue(record, ['last_modified_date']), closed_date: firstValue(record, ['closed_date']), street_address: address, city: firstValue(record, ['city']) || 'Chicago', state: firstValue(record, ['state']) || 'IL', zip_code: zip, ward: firstValue(record, ['ward']), community_area: firstValue(record, ['community_area']) },
  });
}

export function ingestChicago311ServiceRequests({ limit = 1000, apiBaseUrl } = {}) {
  return ingestSocrataObservations({ apiUrl: CHICAGO_311_API_URL, sourceId: 'chicago_311', jurisdictionId: 'us_city_chicago', moduleHint: 'municipal_services', normalize: normalizeChicago311, limit, pageSize: 1000, apiBaseUrl });
}
