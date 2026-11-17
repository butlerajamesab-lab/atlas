import { supabase } from '../lib/supabaseClient.js';
import { normalizeConfidence, validateSchema } from '../lib/validators.js';

export function toPublicSignalEvent(row) {
  return {
    stream_id: row.stream_id,
    offset: Number(row.offset),
    timestamp: row.timestamp,
    signal_type: row.signal_type,
    spacetime: row.spacetime,
    provenance: row.provenance,
    payload: row.payload,
  };
}

/**
 * Stream registry cache.
 *
 * The `streams` registry holds a few dozen rows and changes a few times a
 * month, but ingest resolution used to query it once or twice for every
 * incoming record — millions of queries against a table that is effectively
 * static while a cycle is running. The registry is now loaded whole, kept
 * in memory for a short TTL, and shared by every lookup. A lookup that
 * misses a warm cache falls back to the previous direct query, so a stream
 * registered moments ago still resolves exactly as before; operator writes
 * also invalidate the cache (see routes/operator.js).
 */
const REGISTRY_CACHE_TTL_MS = (() => {
  const parsed = Number(process.env.ATLAS_STREAM_REGISTRY_CACHE_TTL_MS);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 15 * 60 * 1000;
})();

let registryCache = { rows: null, loadedAt: 0, loading: null };

// A warm-cache miss is confirmed by direct query at most once a minute per
// key. Without this, resolving a batch by source_id would re-probe the
// database for the same absent stream_id on every record and the cache
// would save nothing on the most common ingest path.
const REGISTRY_MISS_RECHECK_MS = 60 * 1000;
const registryMissChecks = new Map();

function missRecentlyChecked(kind, key) {
  const at = registryMissChecks.get(`${kind}:${key}`);
  return at !== undefined && Date.now() - at < REGISTRY_MISS_RECHECK_MS;
}

function noteMiss(kind, key) {
  registryMissChecks.set(`${kind}:${key}`, Date.now());
}

export function invalidateStreamRegistryCache() {
  registryCache = { rows: null, loadedAt: 0, loading: null };
  registryMissChecks.clear();
}

// The three registry reads, behind one seam so tests can substitute a fake
// without a live Supabase (the CI matrix includes Node versions without
// node:test module mocking). Production behavior is the Supabase queries.
const streamDbOps = {
  async fetchRegistry() {
    const { data, error } = await supabase.from('streams').select('*').order('stream_id');
    if (error) throw error;
    return data ?? [];
  },
  async fetchStreamById(streamId) {
    const { data, error } = await supabase.from('streams').select('*').eq('stream_id', streamId).maybeSingle();
    if (error) throw error;
    return data;
  },
  async fetchStreamsBySource(sourceId) {
    const { data, error } = await supabase
      .from('streams')
      .select('*')
      .eq('source_id', sourceId)
      .order('stream_id');
    if (error) throw error;
    return data ?? [];
  },
};

const defaultStreamDbOps = { ...streamDbOps };

export function __setStreamDbOpsForTests(overrides) {
  Object.assign(streamDbOps, overrides ?? defaultStreamDbOps);
}

export async function loadStreamRegistry({ force = false } = {}) {
  const now = Date.now();
  if (!force && registryCache.rows && now - registryCache.loadedAt < REGISTRY_CACHE_TTL_MS) {
    return registryCache.rows;
  }
  if (registryCache.loading) return registryCache.loading;
  registryCache.loading = (async () => {
    registryCache.rows = await streamDbOps.fetchRegistry();
    registryCache.loadedAt = Date.now();
    registryCache.loading = null;
    return registryCache.rows;
  })();
  try {
    return await registryCache.loading;
  } catch (error) {
    registryCache.loading = null;
    throw error;
  }
}

async function directStreamById(streamId) {
  return streamDbOps.fetchStreamById(streamId);
}

export async function requireStream(streamId) {
  let rows = null;
  try {
    rows = await loadStreamRegistry();
  } catch {
    rows = null; // Registry load failed: preserve the previous direct-query path.
  }
  if (rows) {
    const cached = rows.find((row) => row.stream_id === streamId);
    if (cached) return cached;
    // Warm-cache miss: the stream may have been registered after the cache
    // loaded. One direct query (rate-limited per key above) preserves the
    // old behavior for new streams without re-probing per record.
    if (missRecentlyChecked('stream_id', streamId)) return null;
    const direct = await directStreamById(streamId);
    if (direct) {
      registryCache.rows = [...rows.filter((row) => row.stream_id !== streamId), direct]
        .sort((a, b) => String(a.stream_id).localeCompare(String(b.stream_id)));
    } else {
      noteMiss('stream_id', streamId);
    }
    return direct;
  }
  return directStreamById(streamId);
}

function uniqueCandidate(rows, predicate) {
  const matches = rows.filter(predicate);
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Resolve every ingress row against the database stream registry, which is the
 * canonical contract for source, jurisdiction, and module identity.
 *
 * Adapters created across several generations have sometimes supplied a stream
 * id in source_id or retained an older module/jurisdiction alias. That transport
 * drift must not manufacture a second stream identity. Resolution therefore:
 *   1. honors an explicit incoming stream_id;
 *   2. recognizes source_id when it is actually the registered stream_id;
 *   3. prefers an exact canonical source/jurisdiction/module tuple;
 *   4. permits only uniquely resolvable legacy tuples;
 *   5. fails closed on ambiguity.
 */
export async function findStream({ stream_id, source_id, jurisdiction_id, module_hint }) {
  if (stream_id) return requireStream(stream_id);

  if (source_id) {
    const byStreamId = await requireStream(source_id);
    if (byStreamId) return byStreamId;
  }

  let candidates = null;
  try {
    const rows = await loadStreamRegistry();
    candidates = rows.filter((row) => row.source_id === source_id);
  } catch {
    candidates = null; // Registry load failed: use the previous direct query below.
  }
  if ((!candidates || candidates.length === 0) && !missRecentlyChecked('source_id', source_id)) {
    candidates = await streamDbOps.fetchStreamsBySource(source_id);
    if (candidates.length === 0) noteMiss('source_id', source_id);
  }
  if (!candidates) candidates = [];
  if (candidates.length === 0) return null;

  const exact = uniqueCandidate(candidates, (row) =>
    row.jurisdiction_id === jurisdiction_id && row.module_hint === module_hint);
  if (exact) return exact;

  const jurisdictionMatch = uniqueCandidate(candidates, (row) => row.jurisdiction_id === jurisdiction_id);
  if (jurisdictionMatch) return jurisdictionMatch;

  const moduleMatch = uniqueCandidate(candidates, (row) => row.module_hint === module_hint);
  if (moduleMatch) return moduleMatch;

  return candidates.length === 1 ? candidates[0] : null;
}

export async function buildRowsForIngest(body) {
  const rows = [];

  // Load the stream registry once for the whole batch. findStream() then
  // resolves every record from memory instead of querying per record.
  await loadStreamRegistry().catch(() => null);

  for (const [index, incoming] of body.signals.entries()) {
    const stream = await findStream({
      stream_id: incoming.stream_id,
      source_id: body.source_id,
      jurisdiction_id: body.jurisdiction_id,
      module_hint: body.module_hint,
    });

    if (!stream) {
      throw Object.assign(new Error(
        `No uniquely registered stream found for signal index ${index} source=${body.source_id} jurisdiction=${body.jurisdiction_id} module=${body.module_hint}`,
      ), { status: 404 });
    }

    const timestamp = incoming.timestamp ?? new Date().toISOString();
    const incomingSpacetime = incoming.spacetime ?? {};
    const spacetime = {
      ...incomingSpacetime,
      region: incomingSpacetime.region ?? incomingSpacetime.jurisdiction ?? stream.jurisdiction_id,
      jurisdiction: incomingSpacetime.jurisdiction ?? stream.jurisdiction_id,
    };
    const provenance = {
      channel: incoming.provenance?.channel ?? 'external',
      confidence: normalizeConfidence(incoming.provenance?.confidence ?? incoming.payload?.confidence ?? 0.75),
      source_system: incoming.provenance?.source_system ?? stream.source_id,
      ...incoming.provenance,
    };
    provenance.confidence = normalizeConfidence(provenance.confidence);

    // Offset assignment belongs to the database identity function. The zero
    // value is used only for JSON-schema validation and is ignored by the
    // replay-safe persistence RPC.
    const normalized = {
      stream_id: stream.stream_id,
      offset: Number.isInteger(incoming.offset) ? incoming.offset : 0,
      timestamp,
      signal_type: incoming.signal_type ?? `${stream.source_id}.observation`,
      spacetime,
      provenance,
      payload: {
        ...(incoming.payload ?? {}),
        provenance_tracking: {
          source_id: stream.source_id,
          jurisdiction_id: stream.jurisdiction_id,
          module_hint: stream.module_hint,
          requested_source_id: body.source_id,
          requested_jurisdiction_id: body.jurisdiction_id,
          requested_module_hint: body.module_hint,
          stream_contract_id: stream.stream_id,
          governance_contract_id: stream.governance_contract_id ?? null,
          ingested_via: 'atlas-streaming-engine',
          received_at: new Date().toISOString(),
        },
      },
      source_id: stream.source_id,
      jurisdiction_id: stream.jurisdiction_id,
      module_hint: stream.module_hint,
    };

    const validation = validateSchema('signal_event.json', normalized);
    if (!validation.ok) {
      throw Object.assign(new Error(`Signal index ${index} failed schema validation`), { status: 400, details: validation.errors });
    }

    rows.push(normalized);
  }

  return rows;
}

export async function persistSignalRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      run_id: null,
      stream_id: null,
      records_seen: 0,
      events_inserted: 0,
      replays_suppressed: 0,
      cursor_before: null,
      cursor_after: null,
      partial_completion: false,
      receipts: [],
    };
  }

  const { data, error } = await supabase.rpc('persist_signal_event_batch_v2', {
    p_events: rows,
  });
  if (error) throw error;
  if (!data || typeof data !== 'object') {
    throw new Error('Atlas persistence RPC returned an invalid receipt');
  }
  return data;
}
