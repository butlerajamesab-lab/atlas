// Atlas reservoir viewer (Lane B, phase 2): the operator surface over
// signal_events. Read-only. Every registered stream is counted
// EXACTLY against the reservoir, every record is openable to its
// full stored form. No blind spots: if it is in the pool, it is
// listed here with its count, and it can be opened.
//
// Mounted only behind the Atlas control token (see routes/reservoir.js
// and server.js). Raw payloads from complaint/benefit/enforcement
// streams never cross the public-safe frontend boundary.

// The shared supabase client throws at import time when env is
// absent; resolve it lazily so this module stays importable (and
// testable with an injected fake client) anywhere.
async function defaultClient() {
  const { supabase } = await import('../lib/supabaseClient.js');
  return supabase;
}

export const RESERVOIR_CENSUS_CACHE_TTL_MS = 60_000;
// Census fan-out discipline (2026-11-09): the original census fired
// every stream's count + latest-row queries at once (76 requests for
// 38 streams) with no retry — one transient door failure (the 500
// bursts the ingest door throws under load) failed the whole census
// and locked the operator out of the viewer. Counts now run in
// bounded batches and each stream's pair of queries retries with
// backoff, the same treatment the bulk loader got in PR #113.
export const RESERVOIR_CENSUS_BATCH_SIZE = 6;
export const RESERVOIR_CENSUS_MAX_ATTEMPTS = 4;
export const RESERVOIR_CENSUS_BASE_DELAY_MS = 400;

const censusSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withCensusRetry(work, { maxAttempts, baseDelayMs, sleep }) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await sleep(baseDelayMs * 2 ** (attempt - 1));
      }
    }
  }
  throw lastError;
}
export const RESERVOIR_DEFAULT_LIMIT = 50;
export const RESERVOIR_MAX_LIMIT = 100;

export function clampLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return RESERVOIR_DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(parsed), 1), RESERVOIR_MAX_LIMIT);
}

export function parseNonNegativeInt(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.trunc(parsed);
}

export function shapeStreamCensus(stream, count, latest) {
  return {
    stream_id: stream.stream_id,
    source_id: stream.source_id ?? null,
    jurisdiction_id: stream.jurisdiction_id ?? null,
    module_hint: stream.module_hint ?? null,
    status: stream.status ?? null,
    record_count: count,
    latest_offset: latest ? Number(latest.offset) : null,
    latest_event_at: latest?.timestamp ?? null,
    latest_ingested_at: latest?.ingested_at ?? null,
  };
}

export function shapeRecordSummary(row) {
  return {
    stream_id: row.stream_id,
    offset: Number(row.offset),
    timestamp: row.timestamp ?? null,
    signal_type: row.signal_type ?? null,
    source_id: row.source_id ?? null,
    jurisdiction_id: row.jurisdiction_id ?? null,
    ingested_at: row.ingested_at ?? null,
    event_identity_hash: row.event_identity_hash ?? null,
  };
}

export function shapeRecordDetail(row) {
  return {
    stream_id: row.stream_id,
    offset: Number(row.offset),
    timestamp: row.timestamp ?? null,
    signal_type: row.signal_type ?? null,
    spacetime: row.spacetime ?? null,
    provenance: row.provenance ?? null,
    payload: row.payload ?? null,
    source_id: row.source_id ?? null,
    jurisdiction_id: row.jurisdiction_id ?? null,
    module_hint: row.module_hint ?? null,
    ingested_at: row.ingested_at ?? null,
    event_identity_hash: row.event_identity_hash ?? null,
    reference: {
      stream_id: row.stream_id,
      offset: Number(row.offset),
      event_identity_hash: row.event_identity_hash ?? null,
    },
  };
}

async function streamExists(client, streamId) {
  const { data, error } = await client
    .from('streams')
    .select('stream_id')
    .eq('stream_id', streamId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function censusOneStream(client, stream) {
  const { count, error: countError } = await client
    .from('signal_events')
    .select('offset', { count: 'exact', head: true })
    .eq('stream_id', stream.stream_id);
  if (countError) throw countError;

  const { data: latestRows, error: latestError } = await client
    .from('signal_events')
    .select('offset, timestamp, ingested_at')
    .eq('stream_id', stream.stream_id)
    .order('offset', { ascending: false })
    .limit(1);
  if (latestError) throw latestError;

  return shapeStreamCensus(stream, count ?? 0, latestRows?.[0] ?? null);
}

export async function listReservoirStreams(injectedClient, options = {}) {
  const client = injectedClient ?? (await defaultClient());
  const retry = {
    maxAttempts: options.maxAttempts ?? RESERVOIR_CENSUS_MAX_ATTEMPTS,
    baseDelayMs: options.baseDelayMs ?? RESERVOIR_CENSUS_BASE_DELAY_MS,
    sleep: options.sleep ?? censusSleep,
  };
  const batchSize = options.batchSize ?? RESERVOIR_CENSUS_BATCH_SIZE;

  const { data: streams, error } = await withCensusRetry(async () => {
    const result = await client
      .from('streams')
      .select('stream_id, source_id, jurisdiction_id, module_hint, status')
      .order('stream_id', { ascending: true });
    if (result.error) throw result.error;
    return result;
  }, retry);
  const streamList = streams ?? [];

  const census = [];
  for (let start = 0; start < streamList.length; start += batchSize) {
    const batch = streamList.slice(start, start + batchSize);
    const rows = await Promise.all(
      batch.map((stream) => withCensusRetry(() => censusOneStream(client, stream), retry)),
    );
    census.push(...rows);
  }

  const totalRecords = census.reduce((sum, row) => sum + row.record_count, 0);
  return { streams: census, total_records: totalRecords, stream_count: census.length };
}

export async function listReservoirRecords(
  injectedClient,
  streamId,
  { limit = RESERVOIR_DEFAULT_LIMIT, beforeOffset = null } = {},
) {
  const client = injectedClient ?? (await defaultClient());
  if (!(await streamExists(client, streamId))) return null;

  const pageLimit = clampLimit(limit);
  // Rows come from the SQL page function: PostgREST claims the
  // `offset` query parameter for its own pagination, so client-side
  // filters on the offset column never reach the WHERE clause
  // (proven in production 2026-11-08 — see the schema file
  // 20261108_reservoir_viewer_rpc.sql). The exact total still comes
  // from a head count on stream_id only, which is unaffected.
  const { data, error } = await client.rpc('atlas_reservoir_records_page', {
    p_stream_id: streamId,
    p_limit: pageLimit,
    p_before_offset: parseNonNegativeInt(beforeOffset),
  });
  if (error) throw error;

  const { count, error: countError } = await client
    .from('signal_events')
    .select('offset', { count: 'exact', head: true })
    .eq('stream_id', streamId);
  if (countError) throw countError;

  const records = (data ?? []).map(shapeRecordSummary);
  return {
    stream_id: streamId,
    total_records: count ?? records.length,
    records,
    next_before_offset: records.length ? records[records.length - 1].offset : null,
    has_more: records.length === pageLimit,
  };
}

export async function getReservoirRecord(injectedClient, streamId, offset) {
  const client = injectedClient ?? (await defaultClient());
  const parsedOffset = parseNonNegativeInt(offset);
  if (parsedOffset === null) return null;

  // SQL function, not a PostgREST filter — see listReservoirRecords.
  const { data, error } = await client.rpc('atlas_reservoir_record', {
    p_stream_id: streamId,
    p_offset: parsedOffset,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row ? shapeRecordDetail(row) : null;
}
