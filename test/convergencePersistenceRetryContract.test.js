// Convergence persistence retry contract (rulebook audit
// 2026-11-09, Finding 3): the persist RPC answered a completed
// run's acceptance with a single attempt — one transient
// Cloudflare 520 from the database host (observed live
// 2026-11-09 10:21:25 UTC) discarded the run. The RPC is
// idempotent by contract ('created' | 'idempotent' for the same
// bundle), so persistComputation now retries transient transport
// failures with bounded backoff and fails fast on governance
// errors. Exhaustion throws an error naming the attempt count:
// a lost persistence is a labeled event, never a silent one.

import assert from 'node:assert/strict';
import test from 'node:test';

import { persistComputation } from '../src/services/convergenceRunner.js';

function minimalComputation() {
  return {
    analysis_registry_hash: 'registry-hash',
    geography_package: {
      registry_hash: 'registry-hash',
      jurisdiction: 'us_state_WA',
      source_id: 'test_source',
      source_version: '1',
      source_url: null,
      records: [],
    },
    geography_registry: [],
    configuration: {
      analysis_level: 'state',
      time_window_ms: 1000,
      temporal_bucket_ms: 100,
      geography_registry_version: 'v1',
    },
    run_key: 'run-key',
    engine_version: 'test-engine',
    as_of: '2026-11-09T00:00:00Z',
    rule_manifest_hash: 'rule-hash',
    source_population_hash: 'source-hash',
    source_population: [],
    transformed_signals: [],
    deduplicated_signals: [],
    receipts: [],
    output_hash: 'output-hash',
    complete_output: {},
  };
}

function stubSupabase(behaviors) {
  const calls = [];
  return {
    calls,
    async rpc(name, args) {
      calls.push({ name, args });
      const behavior = behaviors[Math.min(calls.length - 1, behaviors.length - 1)];
      return behavior();
    },
  };
}

const noSleep = async () => {};

const transient520 = () => ({
  data: null,
  error: new Error('Cloudflare 520: web server is down'),
});

test('a transient 520 is retried and the run persists on the third attempt', async () => {
  const supabase = stubSupabase([
    transient520,
    transient520,
    () => ({ data: { status: 'created' }, error: null }),
  ]);
  const sleeps = [];
  const result = await persistComputation(supabase, minimalComputation(), {
    attempts: 4,
    baseDelayMs: 250,
    sleepFn: async (ms) => { sleeps.push(ms); },
  });
  assert.equal(result.status, 'created');
  assert.equal(supabase.calls.length, 3);
  assert.deepEqual(sleeps, [250, 500]);
  // Every attempt sends the identical bundle to the same RPC —
  // the idempotency contract is what makes the retry safe.
  assert.ok(supabase.calls.every((call) => call.name === 'atlas_convergence_persist_run_v1'));
  assert.equal(supabase.calls[0].args.p_bundle, supabase.calls[2].args.p_bundle);
});

test('an idempotent receipt is accepted without further attempts', async () => {
  const supabase = stubSupabase([
    () => ({ data: { status: 'idempotent' }, error: null }),
  ]);
  const result = await persistComputation(supabase, minimalComputation(), { sleepFn: noSleep });
  assert.equal(result.status, 'idempotent');
  assert.equal(supabase.calls.length, 1);
});

test('a non-transient error fails fast on the first attempt', async () => {
  const supabase = stubSupabase([
    () => ({ data: null, error: new Error('function atlas_convergence_persist_run_v1 does not exist') }),
  ]);
  await assert.rejects(
    persistComputation(supabase, minimalComputation(), { attempts: 4, sleepFn: noSleep }),
    /after 1 attempt\(s\): function atlas_convergence_persist_run_v1 does not exist/,
  );
  assert.equal(supabase.calls.length, 1);
});

test('transient exhaustion throws an error naming the attempt count', async () => {
  const supabase = stubSupabase([transient520]);
  await assert.rejects(
    persistComputation(supabase, minimalComputation(), { attempts: 3, baseDelayMs: 1, sleepFn: noSleep }),
    /after 3 attempt\(s\): Cloudflare 520/,
  );
  assert.equal(supabase.calls.length, 3);
});

test('a bad receipt status is a governance failure, not retried', async () => {
  const supabase = stubSupabase([
    () => ({ data: { status: 'unexpected' }, error: null }),
  ]);
  await assert.rejects(
    persistComputation(supabase, minimalComputation(), { attempts: 4, sleepFn: noSleep }),
    /no governed receipt/,
  );
  assert.equal(supabase.calls.length, 1);
});
