import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

export const ATLAS_API_BASE_URL = process.env.ATLAS_API_BASE_URL || `http://localhost:${process.env.PORT || 8787}`;
const DEFAULT_INGEST_BATCH_SIZE = 100;
const MAX_INGEST_BATCH_SIZE = 500;
const DEFAULT_INGEST_TIMEOUT_MS = 60_000;
const MAX_INGEST_TIMEOUT_MS = 180_000;

export function sourceUrlFrom(...values) {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0) || null;
}

export function toIsoTimestamp(...values) {
  const value = values.find((candidate) => candidate !== undefined && candidate !== null && candidate !== '');
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

export function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function boundedBatchSize(value) {
  const parsed = Number.parseInt(String(value ?? DEFAULT_INGEST_BATCH_SIZE), 10);
  if (!Number.isSafeInteger(parsed)) return DEFAULT_INGEST_BATCH_SIZE;
  return Math.min(MAX_INGEST_BATCH_SIZE, Math.max(1, parsed));
}

function boundedTimeoutMs(value) {
  const parsed = Number.parseInt(String(value ?? DEFAULT_INGEST_TIMEOUT_MS), 10);
  if (!Number.isSafeInteger(parsed)) return DEFAULT_INGEST_TIMEOUT_MS;
  return Math.min(MAX_INGEST_TIMEOUT_MS, Math.max(5_000, parsed));
}

function atlasIngestError(error, batchIndex) {
  const status = error?.response?.status ?? null;
  const payload = error?.response?.data;
  const detail = payload?.details || payload?.error || payload?.message || error?.message || String(error);
  const serialized = typeof detail === 'string' ? detail : JSON.stringify(detail);
  const wrapped = new Error(
    `atlas_ingest_failed batch=${batchIndex}${status ? ` status=${status}` : ''} detail=${serialized.slice(0, 700)}`,
  );
  wrapped.status = status;
  wrapped.cause = error;
  return wrapped;
}

async function postBatch({ sourceId, jurisdictionId, moduleHint, signals, apiBaseUrl, ingestToken, batchIndex, timeoutMs }) {
  try {
    const response = await axios.post(`${apiBaseUrl}/v1/ingest/signals`, {
      source_id: sourceId,
      jurisdiction_id: jurisdictionId,
      module_hint: moduleHint,
      signals,
    }, {
      timeout: timeoutMs,
      headers: {
        Authorization: `Bearer ${ingestToken}`,
        'Content-Type': 'application/json',
      },
    });
    return response.data;
  } catch (error) {
    throw atlasIngestError(error, batchIndex);
  }
}

export async function postSignalsToAtlas({
  sourceId,
  jurisdictionId,
  moduleHint,
  signals,
  apiBaseUrl = ATLAS_API_BASE_URL,
  batchSize = process.env.ATLAS_INGEST_BATCH_SIZE,
  timeoutMs = process.env.ATLAS_INGEST_TIMEOUT_MS,
}) {
  const ingestToken = process.env.ATLAS_INGEST_TOKEN;
  if (!ingestToken) {
    throw new Error('ATLAS_INGEST_TOKEN is required for adapter ingestion');
  }

  const rows = Array.isArray(signals) ? signals : [];
  if (rows.length === 0) {
    return {
      accepted: true,
      status: 'completed',
      ingested_count: 0,
      replayed_count: 0,
      records_seen: 0,
      records_failed: 0,
      partial_completion: false,
      receipts: [],
      batches: 0,
    };
  }

  const size = boundedBatchSize(batchSize);
  const timeout = boundedTimeoutMs(timeoutMs);
  const aggregate = {
    accepted: true,
    status: 'completed',
    ingested_count: 0,
    replayed_count: 0,
    records_seen: 0,
    records_failed: 0,
    partial_completion: false,
    receipts: [],
    batches: 0,
    run_ids: [],
    batch_size: size,
    timeout_ms: timeout,
  };

  for (let start = 0, batchIndex = 0; start < rows.length; start += size, batchIndex += 1) {
    const batch = rows.slice(start, start + size);
    const receipt = await postBatch({
      sourceId,
      jurisdictionId,
      moduleHint,
      signals: batch,
      apiBaseUrl,
      ingestToken,
      batchIndex,
      timeoutMs: timeout,
    });
    aggregate.batches += 1;
    aggregate.ingested_count += Number(receipt?.ingested_count ?? 0);
    aggregate.replayed_count += Number(receipt?.replayed_count ?? 0);
    aggregate.records_seen += Number(receipt?.records_seen ?? batch.length);
    aggregate.records_failed += Number(receipt?.records_failed ?? 0);
    aggregate.partial_completion = aggregate.partial_completion || Boolean(receipt?.partial_completion);
    aggregate.receipts.push(...(Array.isArray(receipt?.receipts) ? receipt.receipts : []));
    if (receipt?.run_id) aggregate.run_ids.push(receipt.run_id);
    if (receipt?.accepted === false || receipt?.status === 'failed') {
      aggregate.accepted = false;
      aggregate.status = 'failed';
      throw new Error(`atlas_ingest_batch_failed batch=${batchIndex} run_id=${receipt?.run_id ?? 'unknown'}`);
    }
    if (receipt?.status === 'partial') aggregate.status = 'partial';
  }

  return aggregate;
}
