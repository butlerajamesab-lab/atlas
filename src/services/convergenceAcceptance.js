import { createClient } from '@supabase/supabase-js';
import { executeConvergenceRun, replayConvergenceRun } from './convergenceRunner.js';
import { loadWashingtonGeography } from '../substrate/geographyLoader.js';

function required(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required for convergence acceptance`);
  }
  return value.trim();
}

function finiteNumber(env, name) {
  const value = Number(required(env, name));
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
  return value;
}

function nonNegativeInteger(env, name) {
  const value = finiteNumber(env, name);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
}

export function resolveConvergenceAcceptanceConfiguration(env = process.env) {
  if (env.ATLAS_CONVERGENCE_ACCEPTANCE_ENABLED !== 'true') return null;
  const geography = loadWashingtonGeography();
  const targets = required(env, 'ATLAS_CONVERGENCE_ACCEPTANCE_TARGET_GEOGRAPHIES')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (targets.length === 0) throw new Error('ATLAS_CONVERGENCE_ACCEPTANCE_TARGET_GEOGRAPHIES is empty');

  return Object.freeze({
    as_of: finiteNumber(env, 'ATLAS_CONVERGENCE_ACCEPTANCE_AS_OF'),
    time_window_ms: finiteNumber(env, 'ATLAS_CONVERGENCE_ACCEPTANCE_TIME_WINDOW_MS'),
    temporal_bucket_ms: finiteNumber(env, 'ATLAS_CONVERGENCE_ACCEPTANCE_TEMPORAL_BUCKET_MS'),
    geography_registry_version: geography.registry_hash,
    analysis_level: required(env, 'ATLAS_CONVERGENCE_ACCEPTANCE_ANALYSIS_LEVEL'),
    min_signals_for_analysis: nonNegativeInteger(env, 'ATLAS_CONVERGENCE_ACCEPTANCE_MIN_SIGNALS'),
    z_score_threshold: finiteNumber(env, 'ATLAS_CONVERGENCE_ACCEPTANCE_Z_THRESHOLD'),
    target_geographies: Object.freeze(targets),
    persist: true,
  });
}

function createServiceClient(env) {
  const url = required(env, 'SUPABASE_URL');
  const key = required(env, 'SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function runConvergenceAcceptanceFromEnvironment(
  env = process.env,
  dependencies = {},
) {
  const configuration = resolveConvergenceAcceptanceConfiguration(env);
  if (!configuration) return null;
  const supabase = dependencies.supabase ?? createServiceClient(env);
  const execute = dependencies.executeConvergenceRun ?? executeConvergenceRun;
  const replay = dependencies.replayConvergenceRun ?? replayConvergenceRun;

  const run = await execute({ supabase, ...configuration });
  if (!run.persistence || !['created', 'idempotent'].includes(run.persistence.status)) {
    throw new Error('convergence acceptance produced no immutable persistence receipt');
  }
  const replayResult = await replay(supabase, run.run_key);
  if (!replayResult.consistent) {
    throw new Error(`convergence acceptance replay failed: ${replayResult.reason ?? 'unknown mismatch'}`);
  }

  return Object.freeze({
    run_key: run.run_key,
    engine_version: run.engine_version,
    as_of: run.as_of,
    output_hash: run.output_hash,
    source_population_hash: run.source_population_hash,
    total_source_rows: run.total_source_rows,
    total_signals_raw: run.total_signals_raw,
    total_signals_deduplicated: run.total_signals_deduplicated,
    receipt_count: run.receipts.length,
    receipt_identities: Object.freeze(
      run.receipts.map((receipt) => receipt.receipt_identity).sort(),
    ),
    persistence_status: run.persistence.status,
    replay_output_hash: replayResult.replay_output_hash,
    replay_receipt_manifest_hash: replayResult.replay_receipt_manifest_hash,
    replay_consistent: replayResult.consistent,
  });
}
