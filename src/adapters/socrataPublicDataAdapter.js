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
  const material = fallbackParts.map(cleanText).filter(Boolean).join('|');
  if (!material) throw new Error(`${prefix}_stable_external_id_unavailable`);
  return `${prefix}_${Buffer.from(material).toString('base64url').slice(0, 96)}`;
}

export function socrataHeaders(appToken = process.env.SOCRATA_APP_TOKEN || '') {
  return appToken ? { 'X-App-Token': appToken, Accept: 'application/json' } : { Accept: 'application/json' };
}

function socrataError(error, apiUrl) {
  const status = error?.response?.status ?? null;
  const body = error?.response?.data;
  const detail = typeof body === 'string' ? body : body?.message || body?.errorCode || null;
  const suffix = [status ? `status=${status}` : null, detail ? `detail=${String(detail).slice(0, 240)}` : null].filter(Boolean).join(' ');
  const wrapped = new Error(`socrata_request_failed url=${apiUrl}${suffix ? ` ${suffix}` : ''}`);
  wrapped.cause = error;
  return wrapped;
}

export async function fetchSocrataRows({ apiUrl, limit = 1000, where = null, order = null, pageSize = 1000 }) {
  const requested = Math.min(Math.max(Number(limit) || 1000, 1), 50000);
  const boundedPageSize = Math.min(Math.max(Number(pageSize) || 1000, 1), 5000);
  const rows = [];

  for (let offset = 0; offset < requested; offset += boundedPageSize) {
    const batchLimit = Math.min(boundedPageSize, requested - offset);
    const params = { '$limit': batchLimit, '$offset': offset };
    if (where) params.$where = where;
    if (order) params.$order = order;
    try {
      const response = await axios.get(apiUrl, { params, headers: socrataHeaders(), timeout: 30000 });
      const batch = Array.isArray(response.data) ? response.data : [];
      rows.push(...batch);
      if (batch.length < batchLimit) break;
    } catch (error) {
      throw socrataError(error, apiUrl);
    }
  }
  return rows;
}

export async function ingestSocrataObservations({ apiUrl, sourceId, jurisdictionId, moduleHint, normalize, limit = 1000, where = null, order = null, pageSize = 1000, apiBaseUrl }) {
  const rows = await fetchSocrataRows({ apiUrl, limit, where, order, pageSize });
  const signals = rows.map((row) => normalize(row)).filter(Boolean);
  if (!signals.length) return { accepted: true, ingested_count: 0, source_count: rows.length, note: 'No public-data observations returned' };
  const result = await postSignalsToAtlas({ sourceId, jurisdictionId, moduleHint, signals, apiBaseUrl });
  return { ...result, source_count: rows.length };
}

export function observationEnvelope({ signalType, timestamp, jurisdiction, region = jurisdiction, channel, sourceSystem, sourceUrl, payload, geography = {} }) {
  return {
    signal_type: signalType,
    timestamp: toIsoTimestamp(timestamp),
    spacetime: { region, jurisdiction, ...geography },
    provenance: { channel, source_system: sourceSystem, confidence: 1.0, source_url: sourceUrl },
    payload,
  };
}
