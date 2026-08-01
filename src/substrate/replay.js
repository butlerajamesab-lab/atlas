/**
 * Atlas Deterministic Historical Replay
 *
 * Replays a computation at a historical point in time using the same
 * inputs, rules, and versions that were active at that as_of.
 * Produces a receipt that can be compared to the original for drift detection.
 *
 * Platform rule: Replay with same as_of + same inputs → same output + same receipt.
 */

import { createInputManifest, createReceipt, hashManifest, verifyReceipt } from './manifest.js';
import { filterByAsOf } from './temporal.js';

const REPLAY_ENGINE_VERSION = '1.0.0';

/**
 * Replay context: everything needed to reproduce a computation at a point in time.
 */
export function createReplayContext({
  original_receipt,
  as_of,
  signals,
  rules,
  geography_version = null,
  timestamp_field = 'ingested_at',
}) {
  if (!as_of) throw new Error('replay requires explicit as_of');
  if (!Array.isArray(signals)) throw new Error('replay requires signals array');
  if (!Array.isArray(rules)) throw new Error('replay requires rules array');

  // Filter signals to only those that existed at as_of
  const bounded = filterByAsOf(signals, timestamp_field, as_of);

  return {
    original_receipt: original_receipt || null,
    as_of,
    bounded_signals: bounded,
    rules,
    geography_version,
    timestamp_field,
    total_signals: signals.length,
    bounded_count: bounded.length,
    excluded_count: signals.length - bounded.length,
  };
}

/**
 * Execute a replay and compare to original receipt.
 * The computeFn must be a pure function: (signals, rules, context) → result.
 */
export async function executeReplay({
  replayContext,
  computeFn,
  computation_type,
  engine_id,
  engine_version,
}) {
  if (!computeFn || typeof computeFn !== 'function') {
    throw new Error('replay requires a compute function');
  }

  const manifest = createInputManifest({
    computation_type: `replay:${computation_type}`,
    engine_id,
    engine_version,
    as_of: replayContext.as_of,
    geography_version: replayContext.geography_version,
    input_sources: [{
      type: 'replay_bounded_signals',
      count: replayContext.bounded_count,
      timestamp_field: replayContext.timestamp_field,
    }],
    parameters: {
      replay_engine_version: REPLAY_ENGINE_VERSION,
      original_receipt_identity: replayContext.original_receipt?.receipt_identity || null,
    },
  });

  let result;
  let status = 'completed';
  let error = null;

  try {
    result = await computeFn(
      replayContext.bounded_signals,
      replayContext.rules,
      { as_of: replayContext.as_of, geography_version: replayContext.geography_version },
    );
  } catch (err) {
    status = 'failed';
    error = err instanceof Error ? err.message : String(err);
    result = null;
  }

  const receipt = createReceipt({
    manifest,
    output_summary: result ? {
      type: computation_type,
      output_count: Array.isArray(result) ? result.length : (result?.count ?? 1),
    } : null,
    status,
    error,
    provenance_chain: replayContext.original_receipt
      ? [{ receipt_identity: replayContext.original_receipt.receipt_identity }]
      : [],
  });

  // Compare to original if available
  let drift = null;
  if (replayContext.original_receipt && status === 'completed') {
    const originalManifestHash = replayContext.original_receipt.manifest_hash;
    const replayManifestHash = hashManifest(manifest);

    drift = {
      manifest_match: originalManifestHash === replayManifestHash,
      output_match: replayContext.original_receipt.output_hash === receipt.output_hash,
      original_receipt_identity: replayContext.original_receipt.receipt_identity,
      replay_receipt_identity: receipt.receipt_identity,
    };
  }

  return {
    status,
    result,
    receipt,
    drift,
    context: {
      as_of: replayContext.as_of,
      bounded_count: replayContext.bounded_count,
      excluded_count: replayContext.excluded_count,
    },
  };
}

/**
 * Verify that a replay produces the same output as the original.
 * This is the core reproducibility check.
 */
export function verifyReplayConsistency(originalReceipt, replayReceipt) {
  const originalValid = verifyReceipt(originalReceipt);
  const replayValid = verifyReceipt(replayReceipt);

  if (!originalValid.valid) {
    return { consistent: false, reason: `original receipt invalid: ${originalValid.reason}` };
  }
  if (!replayValid.valid) {
    return { consistent: false, reason: `replay receipt invalid: ${replayValid.reason}` };
  }

  if (originalReceipt.output_hash !== replayReceipt.output_hash) {
    return {
      consistent: false,
      reason: 'output_hash mismatch — computation is not deterministic or inputs differ',
      original_output_hash: originalReceipt.output_hash,
      replay_output_hash: replayReceipt.output_hash,
    };
  }

  return { consistent: true, reason: null };
}

export { REPLAY_ENGINE_VERSION };
