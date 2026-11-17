import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// The streams registry is a few dozen effectively-static rows, but ingest
// resolution used to query it once or twice per incoming record. These tests
// pin the cached behavior: one full registry load serves a whole batch, warm
// lookups cost zero queries, resolution semantics are unchanged, and a
// warm-cache miss still falls back to the previous direct query.

const REGISTRY = [
  { stream_id: 'alpha_stream', source_id: 'alpha', jurisdiction_id: 'us_state_wa', module_hint: 'consumer_protection', governance_contract_id: 'gov-alpha', status: 'active' },
  { stream_id: 'beta_stream_wa', source_id: 'beta', jurisdiction_id: 'us_state_wa', module_hint: 'municipal_services', governance_contract_id: 'gov-beta-wa', status: 'active' },
  { stream_id: 'beta_stream_or', source_id: 'beta', jurisdiction_id: 'us_state_or', module_hint: 'municipal_services', governance_contract_id: 'gov-beta-or', status: 'active' },
];

const calls = { fullLoad: 0, byId: 0, bySource: 0 };
let registryRows = [...REGISTRY];
let extraById = new Map();

function makeQuery(table) {
  const state = { eqField: null, eqValue: null, single: false };
  const builder = {
    select() { return builder; },
    order() { return builder; },
    eq(field, value) { state.eqField = field; state.eqValue = value; return builder; },
    maybeSingle() { state.single = true; return builder; },
    then(resolve) {
      if (table !== 'streams') return resolve({ data: null, error: null });
      if (state.eqField === 'stream_id' && state.single) {
        calls.byId += 1;
        const row = registryRows.find((r) => r.stream_id === state.eqValue)
          ?? extraById.get(state.eqValue) ?? null;
        return resolve({ data: row, error: null });
      }
      if (state.eqField === 'source_id') {
        calls.bySource += 1;
        return resolve({ data: registryRows.filter((r) => r.source_id === state.eqValue), error: null });
      }
      calls.fullLoad += 1;
      return resolve({ data: [...registryRows].sort((a, b) => a.stream_id.localeCompare(b.stream_id)), error: null });
    },
  };
  return builder;
}

const fakeSupabase = { from: (table) => makeQuery(table), rpc: async () => ({ data: null, error: null }) };

mock.module(new URL('../src/lib/supabaseClient.js', import.meta.url).href, {
  cache: false,
  exports: { supabase: fakeSupabase, atlasProjectRef: 'test-ref' },
});

const {
  buildRowsForIngest,
  findStream,
  requireStream,
  loadStreamRegistry,
  invalidateStreamRegistryCache,
} = await import('../src/services/streamStore.js');

test.beforeEach(() => {
  calls.fullLoad = 0; calls.byId = 0; calls.bySource = 0;
  registryRows = [...REGISTRY];
  extraById = new Map();
  invalidateStreamRegistryCache();
});

test('a whole ingest batch resolves from one registry load, not per-record queries', async () => {
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
  const exact = await findStream({ source_id: 'beta', jurisdiction_id: 'us_state_wa', module_hint: 'municipal_services' });
  assert.equal(exact.stream_id, 'beta_stream_wa');
  const ambiguous = await findStream({ source_id: 'beta', jurisdiction_id: 'us_federal', module_hint: 'unknown_module' });
  assert.equal(ambiguous, null);
  const missing = await findStream({ source_id: 'no_such_source', jurisdiction_id: 'x', module_hint: 'y' });
  assert.equal(missing, null);
});

test('source_id that is itself a stream_id resolves by id first', async () => {
  const resolved = await findStream({ source_id: 'alpha_stream', jurisdiction_id: 'anything', module_hint: 'anything' });
  assert.equal(resolved.stream_id, 'alpha_stream');
});

test('warm-cache miss for a just-registered stream falls back to one direct query', async () => {
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

test('invalidation forces a reload on the next lookup', async () => {
  await loadStreamRegistry();
  await loadStreamRegistry();
  assert.equal(calls.fullLoad, 1);
  invalidateStreamRegistryCache();
  await loadStreamRegistry();
  assert.equal(calls.fullLoad, 2);
});
