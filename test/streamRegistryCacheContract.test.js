import test from 'node:test';
import assert from 'node:assert/strict';

// The streams registry is a few dozen effectively-static rows, but ingest
// resolution used to query it once or twice per incoming record. These tests
// pin the cached behavior: one full registry load serves a whole batch, warm
// lookups cost zero queries, resolution semantics are unchanged, and a
// warm-cache miss still falls back to the previous direct query.
//
// streamStore builds its Supabase client at import time; give it inert
// values, then substitute the registry reads through its test seam.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
// @supabase/supabase-js >= 2.86 refuses to construct a client on Node < 22
// without a WebSocket global. No realtime connection is ever opened here
// (every registry read goes through the test seam), so an inert stand-in
// is enough to let the import succeed on the 18/20 CI legs.
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class InertWebSocket {
    addEventListener() {}
    removeEventListener() {}
    send() {}
    close() {}
  };
}

const {
  buildRowsForIngest,
  findStream,
  requireStream,
  loadStreamRegistry,
  invalidateStreamRegistryCache,
  __setStreamDbOpsForTests,
} = await import('../src/services/streamStore.js');

const REGISTRY = [
  { stream_id: 'alpha_stream', source_id: 'alpha', jurisdiction_id: 'us_state_wa', module_hint: 'consumer_protection', governance_contract_id: 'gov-alpha', status: 'active' },
  { stream_id: 'beta_stream_wa', source_id: 'beta', jurisdiction_id: 'us_state_wa', module_hint: 'municipal_services', governance_contract_id: 'gov-beta-wa', status: 'active' },
  { stream_id: 'beta_stream_or', source_id: 'beta', jurisdiction_id: 'us_state_or', module_hint: 'municipal_services', governance_contract_id: 'gov-beta-or', status: 'active' },
];

const calls = { fullLoad: 0, byId: 0, bySource: 0 };
let extraById = new Map();
let fetchRegistryImpl = null;

__setStreamDbOpsForTests({
  async fetchRegistry() {
    calls.fullLoad += 1;
    if (fetchRegistryImpl) return fetchRegistryImpl();
    return [...REGISTRY].sort((a, b) => a.stream_id.localeCompare(b.stream_id));
  },
  async fetchStreamById(streamId) {
    calls.byId += 1;
    return REGISTRY.find((row) => row.stream_id === streamId) ?? extraById.get(streamId) ?? null;
  },
  async fetchStreamsBySource(sourceId) {
    calls.bySource += 1;
    return REGISTRY.filter((row) => row.source_id === sourceId);
  },
});

// NOTE: no test.beforeEach hook — test.beforeEach does not exist on the
// Node 18 leg of the CI matrix. Each test resets explicitly instead.
function resetState() {
  calls.fullLoad = 0; calls.byId = 0; calls.bySource = 0;
  extraById = new Map();
  fetchRegistryImpl = null;
  invalidateStreamRegistryCache();
}

test('a whole ingest batch resolves from one registry load, not per-record queries', async () => {
  resetState();
  const signals = Array.from({ length: 50 }, () => ({}));
  const rows = await buildRowsForIngest({
    source_id: 'alpha', jurisdiction_id: 'us_state_wa', module_hint: 'consumer_protection', signals,
  });
  assert.equal(rows.length, 50);
  assert.ok(rows.every((row) => row.stream_id === 'alpha_stream'));
  assert.equal(calls.fullLoad, 1);
  // One bounded miss-probe: the first record checks whether the source_id
  // 'alpha' is itself a stream_id; the answer is miss-cached for the batch.
  assert.equal(calls.byId, 1);
  assert.equal(calls.bySource, 0);
});

test('warm-cache hits cost zero queries; a source resolution costs at most one bounded probe', async () => {
  resetState();
  await loadStreamRegistry();
  assert.equal(calls.fullLoad, 1);
  const byId = await requireStream('beta_stream_or');
  assert.equal(byId.governance_contract_id, 'gov-beta-or');
  assert.equal(calls.byId, 0);
  const resolved = await findStream({ source_id: 'beta', jurisdiction_id: 'us_state_or', module_hint: 'municipal_services' });
  assert.equal(resolved.stream_id, 'beta_stream_or');
  // 'beta' is not a stream_id, so the first resolution pays one direct
  // miss-probe; the miss is then cached and repeats are free.
  assert.equal(calls.byId, 1);
  const again = await findStream({ source_id: 'beta', jurisdiction_id: 'us_state_wa', module_hint: 'municipal_services' });
  assert.equal(again.stream_id, 'beta_stream_wa');
  assert.equal(calls.fullLoad, 1);
  assert.equal(calls.byId, 1);
  assert.equal(calls.bySource, 0);
});

test('resolution semantics are preserved: exact tuple wins, ambiguity fails closed', async () => {
  resetState();
  const exact = await findStream({ source_id: 'beta', jurisdiction_id: 'us_state_wa', module_hint: 'municipal_services' });
  assert.equal(exact.stream_id, 'beta_stream_wa');
  const ambiguous = await findStream({ source_id: 'beta', jurisdiction_id: 'us_federal', module_hint: 'unknown_module' });
  assert.equal(ambiguous, null);
  const missing = await findStream({ source_id: 'no_such_source', jurisdiction_id: 'x', module_hint: 'y' });
  assert.equal(missing, null);
});

test('source_id that is itself a stream_id resolves by id first', async () => {
  resetState();
  const resolved = await findStream({ source_id: 'alpha_stream', jurisdiction_id: 'anything', module_hint: 'anything' });
  assert.equal(resolved.stream_id, 'alpha_stream');
});

test('warm-cache miss for a just-registered stream falls back to one direct query', async () => {
  resetState();
  await loadStreamRegistry();
  assert.equal(calls.fullLoad, 1);
  extraById.set('new_stream', { stream_id: 'new_stream', source_id: 'new', jurisdiction_id: 'us_state_wa', module_hint: 'm', governance_contract_id: 'gov-new', status: 'active' });
  const found = await requireStream('new_stream');
  assert.equal(found.stream_id, 'new_stream');
  assert.equal(calls.byId, 1);
  // And the merged row is cached for the next lookup.
  const again = await requireStream('new_stream');
  assert.equal(again.stream_id, 'new_stream');
  assert.equal(calls.byId, 1);
});

test('a load in flight during invalidation cannot publish its stale snapshot', async () => {
  resetState();
  let releaseFirstLoad;
  const firstLoadGate = new Promise((resolve) => { releaseFirstLoad = resolve; });
  let implCalls = 0;
  fetchRegistryImpl = async () => {
    implCalls += 1;
    if (implCalls === 1) {
      await firstLoadGate;
      // The pre-update snapshot: alpha_stream not yet present.
      return REGISTRY.filter((row) => row.stream_id !== 'alpha_stream');
    }
    return [...REGISTRY].sort((a, b) => a.stream_id.localeCompare(b.stream_id));
  };
  const pending = loadStreamRegistry();
  // Operator writes a stream and invalidates while the first load is out.
  invalidateStreamRegistryCache();
  releaseFirstLoad();
  const rows = await pending;
  // The stale snapshot was discarded and a fresh load served the caller.
  assert.equal(implCalls, 2);
  assert.ok(rows.some((row) => row.stream_id === 'alpha_stream'));
  const cached = await requireStream('alpha_stream');
  assert.equal(cached.stream_id, 'alpha_stream');
});

test('invalidation forces a reload on the next lookup', async () => {
  resetState();
  await loadStreamRegistry();
  await loadStreamRegistry();
  assert.equal(calls.fullLoad, 1);
  invalidateStreamRegistryCache();
  await loadStreamRegistry();
  assert.equal(calls.fullLoad, 2);
});
