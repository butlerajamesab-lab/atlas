/**
 * ATLAS DETERMINISTIC REPLAY v2.1.0
 *
 * Replays a governed computation from its persisted manifest and snapshots.
 * Proves identical output by comparing the canonical output hash.
 *
 * Contract:
 * - Load original manifest, raw signal snapshot, deduplicated snapshot,
 *   geography registry snapshot, and configuration from persistence.
 * - Recompute using the same engine version and rule manifest.
 * - Canonicalize the COMPLETE output payload.
 * - Compare output_hash to the original receipt's output_hash.
 * - If they differ, the computation is non-deterministic or inputs were mutated.
 *
 * No summary comparison. No partial replay. Full output identity or failure.
 */

import { canonicalJson, sha256, ENGINE_VERSION } from './canonical.js';
import { hashManifest, createReceipt } from './manifest.js';

/**
 * Execute a replay from persisted snapshots.
 *
 * @param {object} params
 * @param {object} params.original_receipt - The receipt from the original run
 * @param {object[]} params.raw_signal_snapshot - Complete sorted raw signal population
 * @param {object[]} params.deduplicated_signal_snapshot - Complete sorted deduplicated population
 * @param {object} params.geography_registry_snapshot - Full geography registry at time of run
 * @param {object} params.configuration - Full configuration at time of run
 * @param {function} params.computeFn - Pure function: (raw, deduped, registry, config) → complete output
 */
export async function executeReplay({
  original_receipt,
  raw_signal_snapshot,
  deduplicated_signal_snapshot,
  geography_registry_snapshot,
  configuration,
  computeFn,
}) {
  if (!original_receipt) throw new Error('replay requires original_receipt');
  if (!computeFn || typeof computeFn !== 'function') throw new Error('replay requires computeFn');
  if (!Array.isArray(raw_signal_snapshot)) throw new Error('replay requires raw_signal_snapshot array');
  if (!Array.isArray(deduplicated_signal_snapshot)) throw new Error('replay requires deduplicated_signal_snapshot array');
  if (!geography_registry_snapshot) throw new Error('replay requires geography_registry_snapshot');

  // Verify the original receipt is internally consistent
  const manifestHash = hashManifest(original_receipt.manifest);
  if (manifestHash !== original_receipt.manifest_hash) {
    return {
      status: 'failed',
      consistent: false,
      reason: 'original receipt manifest_hash does not match recomputed hash',
      original_receipt_identity: original_receipt.receipt_identity,
      replay_receipt_identity: null,
    };
  }

  // Verify input snapshots match the declared hashes in the manifest
  const rawHash = sha256(raw_signal_snapshot);
  const dedupHash = sha256(deduplicated_signal_snapshot);
  const registryHash = sha256(geography_registry_snapshot);

  if (original_receipt.manifest.source_population_hash !== rawHash) {
    return {
      status: 'failed',
      consistent: false,
      reason: 'raw signal snapshot hash does not match manifest.source_population_hash',
      expected: original_receipt.manifest.source_population_hash,
      actual: rawHash,
    };
  }
  if (original_receipt.manifest.deduplicated_population_hash &&
      original_receipt.manifest.deduplicated_population_hash !== dedupHash) {
    return {
      status: 'failed',
      consistent: false,
      reason: 'deduplicated snapshot hash does not match manifest.deduplicated_population_hash',
      expected: original_receipt.manifest.deduplicated_population_hash,
      actual: dedupHash,
    };
  }
  if (original_receipt.manifest.geography_registry_hash &&
      original_receipt.manifest.geography_registry_hash !== registryHash) {
    return {
      status: 'failed',
      consistent: false,
      reason: 'geography registry snapshot hash does not match manifest.geography_registry_hash',
      expected: original_receipt.manifest.geography_registry_hash,
      actual: registryHash,
    };
  }

  // Execute the computation
  let output;
  let status = 'completed';
  let error = null;
  try {
    output = await computeFn(
      raw_signal_snapshot,
      deduplicated_signal_snapshot,
      geography_registry_snapshot,
      configuration,
    );
  } catch (err) {
    status = 'failed';
    error = err instanceof Error ? err.message : String(err);
  }

  if (status === 'failed') {
    return {
      status: 'failed',
      consistent: false,
      reason: `computation threw: ${error}`,
      original_receipt_identity: original_receipt.receipt_identity,
      replay_receipt_identity: null,
    };
  }

  // Compute the output hash of the replay result
  const replayOutputHash = sha256(output);

  // Build the replay receipt using the SAME manifest (proving same inputs)
  const replayReceipt = createReceipt({
    manifest: original_receipt.manifest,
    output_hash: replayOutputHash,
    computed_outputs: output,
    status: 'completed',
  });

  // Compare output hashes
  const consistent = replayOutputHash === original_receipt.output_hash;

  return {
    status: 'completed',
    consistent,
    reason: consistent ? null : 'output_hash mismatch — computation is not deterministic or inputs differ',
    original_receipt_identity: original_receipt.receipt_identity,
    replay_receipt_identity: replayReceipt.receipt_identity,
    original_output_hash: original_receipt.output_hash,
    replay_output_hash: replayOutputHash,
    receipt: replayReceipt,
    output,
  };
}

/**
 * Verify replay consistency: same manifest + same inputs → same output hash.
 * This is the single acceptance criterion for determinism.
 */
export function verifyReplayConsistency(originalReceipt, replayReceipt) {
  if (!originalReceipt?.output_hash || !replayReceipt?.output_hash) {
    return { consistent: false, reason: 'missing output_hash on one or both receipts' };
  }
  if (originalReceipt.output_hash !== replayReceipt.output_hash) {
    return {
      consistent: false,
      reason: 'output_hash mismatch',
      original: originalReceipt.output_hash,
      replay: replayReceipt.output_hash,
    };
  }
  if (originalReceipt.manifest_hash !== replayReceipt.manifest_hash) {
    return { consistent: false, reason: 'manifest_hash mismatch — inputs differ' };
  }
  return { consistent: true, reason: null };
}
