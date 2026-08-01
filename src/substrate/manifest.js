/**
 * ATLAS IMMUTABLE MANIFESTS AND RECEIPTS v2.1.0
 *
 * Every governed Atlas computation produces:
 * 1. An input manifest declaring the complete inputs
 * 2. A receipt proving the computation was performed
 *
 * All hashing uses the single canonical.js serializer.
 * Receipt identity = sha256(manifest_hash + output_hash).
 * Same manifest + same output → same receipt identity.
 *
 * Conforms to Math Engine v2.1 provenance contract.
 */

import { canonicalJson, sha256, ENGINE_VERSION } from './canonical.js';

const MANIFEST_VERSION = '2.1.0';

/**
 * Create an immutable input manifest for a governed computation.
 * All fields are explicit — no defaults, no wall-clock injection.
 */
export function createInputManifest({
  computation_type,
  engine_version = ENGINE_VERSION,
  rule_manifest_hash,
  as_of,
  time_window_ms = null,
  temporal_bucket_ms = null,
  geography_registry_version = null,
  configuration = {},
  source_population_hash,
  deduplicated_population_hash = null,
  geography_registry_hash = null,
  signal_count,
  deduplicated_count = null,
}) {
  if (!computation_type) throw new Error('manifest requires computation_type');
  if (!as_of && as_of !== 0) throw new Error('manifest requires explicit as_of');
  if (!rule_manifest_hash) throw new Error('manifest requires rule_manifest_hash');
  if (!source_population_hash) throw new Error('manifest requires source_population_hash');
  if (!Number.isInteger(signal_count) || signal_count < 0) {
    throw new Error('manifest requires non-negative integer signal_count');
  }

  return Object.freeze({
    manifest_version: MANIFEST_VERSION,
    computation_type,
    engine_version,
    rule_manifest_hash,
    as_of,
    time_window_ms,
    temporal_bucket_ms,
    geography_registry_version,
    configuration: Object.freeze({ ...configuration }),
    source_population_hash,
    deduplicated_population_hash,
    geography_registry_hash,
    signal_count,
    deduplicated_count,
  });
}

/**
 * Compute the deterministic hash of a manifest using canonical serialization.
 */
export function hashManifest(manifest) {
  return sha256(manifest);
}

/**
 * Create a computation receipt.
 * output_hash is the sha256 of the COMPLETE canonicalized output payload.
 * timestamp_computed === as_of (NOT wall clock).
 */
export function createReceipt({
  manifest,
  output_hash,
  computed_outputs = null,
  status = 'completed',
  error = null,
}) {
  if (!manifest) throw new Error('receipt requires a manifest');
  if (status === 'completed' && !output_hash) {
    throw new Error('completed receipt requires output_hash');
  }

  const manifestHash = hashManifest(manifest);

  // Receipt identity = sha256(manifest_hash + output_hash)
  const receiptIdentity = sha256({
    manifest_hash: manifestHash,
    output_hash: output_hash || null,
  });

  return Object.freeze({
    receipt_version: MANIFEST_VERSION,
    receipt_identity: receiptIdentity,
    manifest_hash: manifestHash,
    manifest,
    output_hash: output_hash || null,
    computed_outputs: computed_outputs ? Object.freeze(computed_outputs) : null,
    status,
    error: error ? String(error).slice(0, 2000) : null,
    timestamp_computed: manifest.as_of,
  });
}

/**
 * Verify that a receipt's identity matches its declared content.
 * Returns { valid, reason }.
 */
export function verifyReceipt(receipt) {
  if (!receipt || !receipt.manifest) {
    return { valid: false, reason: 'missing manifest' };
  }

  const expectedManifestHash = hashManifest(receipt.manifest);
  if (expectedManifestHash !== receipt.manifest_hash) {
    return { valid: false, reason: 'manifest_hash mismatch' };
  }

  const expectedIdentity = sha256({
    manifest_hash: receipt.manifest_hash,
    output_hash: receipt.output_hash,
  });

  if (expectedIdentity !== receipt.receipt_identity) {
    return { valid: false, reason: 'receipt_identity mismatch' };
  }

  return { valid: true, reason: null };
}

/**
 * Chain receipts into a provenance trail.
 */
export function chainReceipts(receipts) {
  return receipts.map((r) => ({
    receipt_identity: r.receipt_identity,
    computation_type: r.manifest?.computation_type,
    as_of: r.manifest?.as_of,
  }));
}

export { MANIFEST_VERSION };
