import { sha256 } from '../substrate/canonical.js';

export const SOURCE_HEALTH_RECEIPT_VERSION = '1.0.0';

async function defaultClient() {
  const { supabase } = await import('../lib/supabaseClient.js');
  return supabase;
}

function asNonNegativeInteger(value, fallback = 0) {
  const numeric = Number(value ?? fallback);
  if (!Number.isSafeInteger(numeric) || numeric < 0) return fallback;
  return numeric;
}

function boundedRate(numerator, denominator) {
  const n = asNonNegativeInteger(numerator);
  const d = asNonNegativeInteger(denominator);
  if (d <= 0) return null;
  return Math.max(0, Math.min(1, n / d));
}

function elapsedMs(startedAt, completedAt) {
  if (!startedAt || !completedAt) return null;
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return end - start;
}

export function deriveSourceHealthFromIngestJob(job) {
  if (!job || typeof job !== 'object') throw new Error('source_health_ingest_job_required');
  if (typeof job.id !== 'string' || job.id.length === 0) throw new Error('source_health_ingest_job_id_required');
  if (typeof job.connector_id !== 'string' || job.connector_id.length === 0) {
    throw new Error('source_health_connector_id_required');
  }

  const status = String(job.status ?? '').toLowerCase();
  const fetched = asNonNegativeInteger(job.records_fetched);
  const failed = asNonNegativeInteger(job.records_failed);
  const deduplicated = asNonNegativeInteger(job.records_deduplicated);
  const observedAt = job.completed_at ?? job.started_at;
  if (!observedAt || !Number.isFinite(Date.parse(observedAt))) {
    throw new Error('source_health_observed_at_required');
  }

  let healthStatus;
  if (status === 'completed') {
    healthStatus = failed > 0 ? 'degraded' : 'healthy';
  } else if (status === 'partial') {
    healthStatus = 'degraded';
  } else if (status === 'failed') {
    healthStatus = 'failing';
  } else if (status === 'paused') {
    healthStatus = 'paused';
  } else {
    healthStatus = 'unknown';
  }

  const payload = {
    receipt_version: SOURCE_HEALTH_RECEIPT_VERSION,
    receipt_basis: 'canonical_ingest_job',
    ingest_job_id: job.id,
    connector_id: job.connector_id,
    schema_id: job.schema_id ?? null,
    observed_at: new Date(observedAt).toISOString(),
    health_status: healthStatus,
    // Historical ingest_job does not prove freshness or schema stability.
    freshness_status: 'unknown',
    schema_status: 'unknown',
    latency_ms: elapsedMs(job.started_at, job.completed_at),
    error_rate: boundedRate(failed, fetched),
    duplicate_rate: boundedRate(deduplicated, fetched),
    missing_required_field_rate: null,
    records_observed: fetched,
    run_status: status || 'unknown',
    records_inserted: asNonNegativeInteger(job.records_inserted),
    records_updated: asNonNegativeInteger(job.records_updated),
    records_failed: failed,
    records_deduplicated: deduplicated,
    next_cursor: job.next_cursor ?? null,
    error_log_hash: sha256(job.error_log ?? {}),
    metadata_hash: sha256(job.metadata ?? {}),
  };

  return Object.freeze({
    ...payload,
    source_state_hash: sha256(payload),
  });
}

export function buildSourceHealthInsert(receipt) {
  if (!receipt || typeof receipt !== 'object') throw new Error('source_health_receipt_required');
  return Object.freeze({
    connector_id: receipt.connector_id,
    schema_id: receipt.schema_id,
    observed_at: receipt.observed_at,
    health_status: receipt.health_status,
    freshness_status: receipt.freshness_status,
    schema_status: receipt.schema_status,
    latency_ms: receipt.latency_ms,
    error_rate: receipt.error_rate,
    duplicate_rate: receipt.duplicate_rate,
    missing_required_field_rate: receipt.missing_required_field_rate,
    records_observed: receipt.records_observed,
    source_state_hash: receipt.source_state_hash,
    details: receipt,
  });
}

export async function recordSourceHealthReceipt(receipt, client = null) {
  const db = client ?? await defaultClient();
  const row = buildSourceHealthInsert(receipt);
  const { data, error } = await db
    .from('atlas_source_health_event')
    .upsert(row, {
      onConflict: 'connector_id,observed_at,source_state_hash',
      ignoreDuplicates: true,
    })
    .select('health_event_id,connector_id,observed_at,source_state_hash')
    .maybeSingle();

  if (error) throw new Error(`source_health_receipt_persist_failed:${error.message}`);
  return Object.freeze({
    persisted: Boolean(data),
    health_event_id: data?.health_event_id ?? null,
    connector_id: receipt.connector_id,
    observed_at: receipt.observed_at,
    source_state_hash: receipt.source_state_hash,
  });
}

export async function recordIngestJobSourceHealth(job, client = null) {
  const receipt = deriveSourceHealthFromIngestJob(job);
  const persistence = await recordSourceHealthReceipt(receipt, client);
  return Object.freeze({ receipt, persistence });
}

export async function reconcileIngestJobSourceHealth({ limit = 1000, after_id = null, client = null } = {}) {
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 10000) {
    throw new Error('source_health_reconcile_limit_invalid');
  }
  if (after_id !== null && (typeof after_id !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(after_id))) {
    throw new Error('source_health_reconcile_cursor_invalid');
  }
  const db = client ?? await defaultClient();

  const results = [];
  let cursor = after_id;
  let exhausted = false;
  while (results.length < limit) {
    // UUID identity is immutable and unique; no mutable timestamp or offset
    // pagination means previously receipted rows cannot hide later jobs.
    // PostgREST installations commonly cap responses at 1,000 rows.
    const pageLimit = Math.min(1000, limit - results.length);
    let query = db.from('ingest_jobs')
      .select('id,connector_id,schema_id,status,started_at,completed_at,records_fetched,records_inserted,records_updated,records_failed,records_deduplicated,next_cursor,error_log,metadata')
      .not('connector_id', 'is', null)
      .order('id', { ascending: true })
      .limit(pageLimit);
    if (cursor !== null) query = query.gt('id', cursor);
    const { data, error } = await query;
    if (error) throw new Error(`source_health_ingest_job_read_failed:${error.message}`);

    const page = data ?? [];
    if (page.length > pageLimit) throw new Error('source_health_reconcile_unbounded_page');
    for (const job of page) {
      if (typeof job.id !== 'string' || (cursor !== null && job.id <= cursor)) {
        throw new Error('source_health_reconcile_cursor_did_not_advance');
      }
      results.push(await recordIngestJobSourceHealth(job, db));
      cursor = job.id;
    }
    if (page.length < pageLimit) {
      exhausted = true;
      break;
    }
  }

  return Object.freeze({
    jobs_seen: results.length,
    receipts_processed: results.length,
    persisted_count: results.filter((entry) => entry.persistence.persisted).length,
    idempotent_count: results.filter((entry) => !entry.persistence.persisted).length,
    next_cursor: exhausted ? null : cursor,
    results: Object.freeze(results),
  });
}
