import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import {
  executeConvergenceRun,
  replayConvergenceRun,
  getConvergenceRunStatus,
  transformSignalEventDetailed,
  loadSourcePopulation,
} from '../src/services/convergenceRunner.js';
import { sha256, ENGINE_VERSION } from '../src/substrate/canonical.js';
import { ENGINE_EQUATIONS } from '../src/substrate/convergence.js';
import { loadWashingtonGeography } from '../src/substrate/geographyLoader.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const HAS_DB = Boolean(SUPABASE_URL && SUPABASE_KEY);
const AS_OF = Date.parse('2026-08-01T00:00:00Z');
const WINDOW_MS = 365 * 86400000;
const BUCKET_MS = 86400000;

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function parameters(persist) {
  const geography = loadWashingtonGeography();
  return {
    as_of: AS_OF,
    time_window_ms: WINDOW_MS,
    temporal_bucket_ms: BUCKET_MS,
    geography_registry_version: geography.registry_hash,
    analysis_level: 'state',
    min_signals_for_analysis: 1,
    z_score_threshold: 2,
    target_geographies: ['US_WA'],
    persist,
  };
}

test('Washington registry is source-bound and state alias is exact', () => {
  const geography = loadWashingtonGeography();
  assert.equal(geography.record_count, 40);
  assert.match(geography.registry_hash, /^[a-f0-9]{64}$/);
  const row = {
    stream_id: 'test', offset: '1', timestamp: '2026-07-01T00:00:00Z',
    signal_type: 'test', payload: {}, provenance: {}, spacetime: {},
    source_id: 'test', jurisdiction_id: 'WA', module_hint: null,
    event_identity_hash: 'b'.repeat(64),
  };
  const transformed = transformSignalEventDetailed(row, geography.records, 'state');
  assert.equal(transformed.signal.spatial_coordinate, 'US_WA');
});

test('rule manifest is versioned and deterministic', () => {
  assert.equal(ENGINE_VERSION, '2.1.0');
  assert.equal(sha256(ENGINE_EQUATIONS), sha256({ ...ENGINE_EQUATIONS }));
});

test('real source loader requires canonical identity RPC', async () => {
  const fake = {
    async rpc(name) {
      assert.equal(name, 'atlas_convergence_source_population_page_v1');
      return { data: [], error: null };
    },
  };
  const result = await loadSourcePopulation(fake, { as_of: AS_OF, time_window_ms: WINDOW_MS });
  assert.equal(result.total_count, 0);
});

test('county analysis remains explicit and does not infer from city names', () => {
  const geography = loadWashingtonGeography();
  const row = {
    stream_id: 'test', offset: '1', timestamp: '2026-07-01T00:00:00Z',
    signal_type: 'test', payload: { city: 'Seattle' }, provenance: {}, spacetime: {},
    source_id: 'test', jurisdiction_id: 'Seattle', module_hint: null,
    event_identity_hash: 'c'.repeat(64),
  };
  const transformed = transformSignalEventDetailed(row, geography.records, 'county');
  assert.equal(transformed.signal, null);
  assert.equal(transformed.reason, 'unresolved_geography');
});

test('production canonical population is readable and identity-bound', { skip: !HAS_DB }, async () => {
  const loaded = await loadSourcePopulation(getSupabase(), { as_of: AS_OF, time_window_ms: WINDOW_MS });
  assert.ok(loaded.total_count >= 0);
  assert.ok(loaded.rows.every((row) => row.event_identity_hash));
  assert.equal(new Set(loaded.rows.map((row) => `${row.stream_id}:${row.offset}`)).size, loaded.rows.length);
});

test('real Washington dry run is deterministic at fixed as_of', { skip: !HAS_DB }, async () => {
  const first = await executeConvergenceRun({ supabase: getSupabase(), ...parameters(false) });
  const second = await executeConvergenceRun({ supabase: getSupabase(), ...parameters(false) });
  assert.equal(first.run_key, second.run_key);
  assert.equal(first.output_hash, second.output_hash);
  assert.equal(first.source_population_hash, second.source_population_hash);
  assert.deepEqual(
    first.receipts.map((receipt) => receipt.receipt_identity),
    second.receipts.map((receipt) => receipt.receipt_identity),
  );
});

test('real Washington run persists atomically and replays exactly', { skip: !HAS_DB }, async () => {
  const run = await executeConvergenceRun({ supabase: getSupabase(), ...parameters(true) });
  assert.ok(['created', 'idempotent'].includes(run.persistence.status));
  const replay = await replayConvergenceRun(getSupabase(), run.run_key);
  assert.equal(replay.consistent, true, replay.reason);
  assert.equal(replay.original_output_hash, replay.replay_output_hash);
  assert.equal(replay.original_receipt_manifest_hash, replay.replay_receipt_manifest_hash);
});

test('persisted Washington status returns immutable manifest and receipts', { skip: !HAS_DB }, async () => {
  const run = await executeConvergenceRun({ supabase: getSupabase(), ...parameters(true) });
  const status = await getConvergenceRunStatus(getSupabase(), run.run_key);
  assert.equal(status.manifest.run_key, run.run_key);
  assert.equal(status.result.output_hash, run.output_hash);
  assert.equal(status.receipts.length, run.receipts.length);
});
