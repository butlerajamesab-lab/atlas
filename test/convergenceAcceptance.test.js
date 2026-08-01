import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveConvergenceAcceptanceConfiguration,
  runConvergenceAcceptanceFromEnvironment,
} from '../src/services/convergenceAcceptance.js';

const env = {
  ATLAS_CONVERGENCE_ACCEPTANCE_ENABLED: 'true',
  ATLAS_CONVERGENCE_ACCEPTANCE_AS_OF: '1785542400000',
  ATLAS_CONVERGENCE_ACCEPTANCE_TIME_WINDOW_MS: '31536000000',
  ATLAS_CONVERGENCE_ACCEPTANCE_TEMPORAL_BUCKET_MS: '86400000',
  ATLAS_CONVERGENCE_ACCEPTANCE_ANALYSIS_LEVEL: 'state',
  ATLAS_CONVERGENCE_ACCEPTANCE_MIN_SIGNALS: '1',
  ATLAS_CONVERGENCE_ACCEPTANCE_Z_THRESHOLD: '2',
  ATLAS_CONVERGENCE_ACCEPTANCE_TARGET_GEOGRAPHIES: 'US_WA',
};

test('acceptance runner is inert unless explicitly enabled', () => {
  assert.equal(resolveConvergenceAcceptanceConfiguration({}), null);
});

test('acceptance configuration is fully explicit and immutable', () => {
  const config = resolveConvergenceAcceptanceConfiguration(env);
  assert.equal(config.as_of, 1785542400000);
  assert.equal(config.time_window_ms, 31536000000);
  assert.equal(config.temporal_bucket_ms, 86400000);
  assert.equal(config.analysis_level, 'state');
  assert.deepEqual(config.target_geographies, ['US_WA']);
  assert.equal(config.persist, true);
  assert.match(config.geography_registry_version, /^[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(config), true);
});

test('acceptance requires persistence and exact replay receipts', async () => {
  const supabase = {};
  const result = await runConvergenceAcceptanceFromEnvironment(env, {
    supabase,
    executeConvergenceRun: async (input) => {
      assert.equal(input.supabase, supabase);
      assert.equal(input.as_of, 1785542400000);
      return {
        run_key: 'a'.repeat(64),
        engine_version: '2.1.0',
        as_of: input.as_of,
        output_hash: 'b'.repeat(64),
        source_population_hash: 'c'.repeat(64),
        total_source_rows: 34,
        total_signals_raw: 34,
        total_signals_deduplicated: 34,
        receipts: [{ receipt_identity: 'd'.repeat(64) }],
        persistence: { status: 'created' },
      };
    },
    replayConvergenceRun: async (client, runKey) => {
      assert.equal(client, supabase);
      assert.equal(runKey, 'a'.repeat(64));
      return {
        consistent: true,
        replay_output_hash: 'b'.repeat(64),
        replay_receipt_manifest_hash: 'e'.repeat(64),
      };
    },
  });
  assert.equal(result.replay_consistent, true);
  assert.equal(result.persistence_status, 'created');
  assert.deepEqual(result.receipt_identities, ['d'.repeat(64)]);
});

test('acceptance fails closed on replay mismatch', async () => {
  await assert.rejects(
    () => runConvergenceAcceptanceFromEnvironment(env, {
      supabase: {},
      executeConvergenceRun: async () => ({
        run_key: 'a'.repeat(64), engine_version: '2.1.0', as_of: 1785542400000,
        output_hash: 'b'.repeat(64), source_population_hash: 'c'.repeat(64),
        total_source_rows: 0, total_signals_raw: 0, total_signals_deduplicated: 0,
        receipts: [{ receipt_identity: 'd'.repeat(64) }],
        persistence: { status: 'idempotent' },
      }),
      replayConvergenceRun: async () => ({ consistent: false, reason: 'output mismatch' }),
    }),
    /replay failed/,
  );
});
