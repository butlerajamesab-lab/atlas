import axios from 'axios';
import { postSignalsToAtlas, toIsoTimestamp } from './ingestClient.js';

function cleanText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

export function firstValue(record, keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

export function stableExternalId(prefix, record, idKeys, fallbackParts = []) {
  const direct = firstValue(record, idKeys);
  if (direct !== null) return `${prefix}_${String(direct)}`;
  const material = fallbackParts
    .map((value) => cleanText(value))
    .filter(Boolean)
    .join('|');
  if (!material) throw new Error(`${prefix}_stable_external_id_unavailable`);
  return `${prefix}_${Buffer.from(material).toString('base64url').slice(0, 96)}`;
}

export function socrataHeaders(appToken = process.env.SOCRATA_APP_TOKEN || '') {
  return appToken
    ? { 'X-App-Token': appToken, Accept: 'application/json' }
    : { Accept: 'application/json' };
}

export async function fetchSocrataRows({ apiUrl, limit = 1000, where = null, order = null, select = null }) {
  const params = { '$limit': Math.min(Math.max(Number(limit) || 1000, 1), 50000) };
  if (where) params.$where = where;
  if (order) params.$order = order;
  if (select) params.$select = select;
  const response = await axios.get(apiUrl, {
    params,
    headers: socrataHeaders(),
    timeout: 30000,
  });
  return Array.isArray(response.data) ? response.data : [];
}

export async function ingestSocrataObservations({
  apiUrl,
  sourceId,
  jurisdictionId,
  moduleHint,
  normalize,
  limit = 1000,
  where = null,
  order = null,
  apiBaseUrl,
}) {
  const rows = await fetchSocrataRows({ apiUrl, limit, where, order });
  const signals = rows.map((row) => normalize(row)).filter(Boolean);
  if (!signals.length) {
    return {
      accepted: true,
      ingested_count: 0,
      source_count: rows.length,
      note: 'No public-data observations returned',
    };
  }
  const result = await postSignalsToAtlas({ sourceId, jurisdictionId, moduleHint, signals, apiBaseUrl });
  return {
    ...result,
    source_count: rows.length,
  };
}

export function observationEnvelope({
  signalType,
  timestamp,
  jurisdiction,
  region = jurisdiction,
  channel,
  sourceSystem,
  sourceUrl,
  payload,
  geography = {},
}) {
  return {
    signal_type: signalType,
    timestamp: toIsoTimestamp(timestamp),
    spacetime: {
      region,
      jurisdiction,
      ...geography,
    },
    provenance: {
      channel,
      source_system: sourceSystem,
      confidence: 1.0,
      source_url: sourceUrl,
    },
    payload,
  };
}
