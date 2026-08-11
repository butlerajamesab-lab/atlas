import axios from 'axios';
import { postSignalsToAtlas } from './ingestClient.js';
import { firstValue, observationEnvelope, socrataHeaders, stableExternalId } from './socrataPublicDataAdapter.js';

// City of Chicago's current API Foundry contract for dataset v6vf-nfxy is
// SODA 3.0 /api/v3/views/{dataset}/query.json. The older /resource path remains
// common on other Socrata portals but is no longer the authoritative Chicago
// contract for this dataset.
export const CHICAGO_311_API_URL = 'https://data.cityofchicago.org/api/v3/views/v6vf-nfxy/query.json';
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
    payload: { external_id: id, request_id: firstValue(record, ['sr_number']), request_type: requestType, short_code: firstValue(record, ['sr_short_code']), department, status: firstValue(record, ['status']), origin: firstValue(record, ['origin']), created_date: created, last_modified_date: firstValue(record, ['last_modified_date']), closed_date: firstValue(record, ['closed_date']), street_address: address, city: firstValue(record, ['city']) || 'Chicago', state: firstValue(record, ['state']) || 'IL', zip_code: zip, ward: firstValue(record, ['ward']), community_area: firstValue(record, ['community_area']), parent_request_id: firstValue(record, ['parent_sr_number']), legacy_record: firstValue(record, ['legacy_record']) },
  });
}

function extractV3Rows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.rows)) return payload.rows;
  return [];
}

export async function fetchChicago311Rows({ limit = 1000 } = {}) {
  const boundedLimit = Math.min(Math.max(Number(limit) || 1000, 1), 5000);
  const pageSize = Math.min(1000, boundedLimit);
  const rows = [];

  for (let pageNumber = 1; rows.length < boundedLimit; pageNumber += 1) {
    const requested = Math.min(pageSize, boundedLimit - rows.length);
    try {
      const response = await axios.post(CHICAGO_311_API_URL, {
        query: 'SELECT *',
        page: { pageNumber, pageSize: requested },
        includeSynthetic: false,
      }, {
        timeout: 30_000,
        headers: {
          ...socrataHeaders(),
          'Content-Type': 'application/json',
        },
      });
      const pageRows = extractV3Rows(response.data);
      rows.push(...pageRows);
      if (pageRows.length < requested) break;
    } catch (error) {
      const status = error?.response?.status ?? null;
      const detail = error?.response?.data ?? error?.message ?? String(error);
      const serialized = typeof detail === 'string' ? detail : JSON.stringify(detail);
      throw new Error(`chicago_311_source_request_failed${status ? ` status=${status}` : ''} page=${pageNumber} detail=${serialized.slice(0,700)}`);
    }
  }

  return rows.slice(0, boundedLimit);
}

export async function ingestChicago311ServiceRequests({ limit = 1000, apiBaseUrl } = {}) {
  const rows = await fetchChicago311Rows({ limit });
  const signals = rows.map(normalizeChicago311).filter(Boolean);
  if (!signals.length) {
    return { accepted: true, ingested_count: 0, source_count: rows.length, note: 'No Chicago 311 observations returned from SODA v3' };
  }
  const result = await postSignalsToAtlas({
    sourceId: 'chicago_311',
    jurisdictionId: 'us_city_chicago',
    moduleHint: 'municipal_services',
    signals,
    apiBaseUrl,
  });
  return { ...result, source_count: rows.length };
}
