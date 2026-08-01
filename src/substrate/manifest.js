/**
 * Atlas Immutable Input Manifests and Receipts
 *
 * Every Atlas computation produces a receipt that declares:
 * 1. The complete input manifest (what went in)
 * 2. The computation parameters (rules, versions, as_of)
 * 3. The output identity (deterministic hash of results)
 * 4. The provenance chain (which prior receipts fed this one)
 *
 * Platform rule: Same manifest → same output → same receipt identity.
 */

import { createHash } from 'node:crypto';

const MANIFEST_VERSION = '1.0.0';

/**
 * Create an immutable input manifest for a computation.
 * The manifest is the complete declaration of what goes into a computation.
 */
export function createInputManifest({
  computation_type,
  engine_id,
  engine_version,
  rule_id = null,
  rule_version = null,
  rule_contract_hash = null,
  as_of,
  temporal_window = null,
  geography_version = null,
  input_sources,
  parameters = {},
}) {
  if (!computation_type) throw new Error('manifest requires computation_type');
  if (!engine_id) throw new Error('manifest requires engine_id');
  if (!engine_version) throw new Error('manifest requires engine_version');
  if (!as_of) throw new Error('manifest requires explicit as_of');
  if (!Array.isArray(input_sources) || input_sources.length === 0) {
    throw new Error('manifest requires at least one input_source');
  }

  const manifest = Object.freeze({
    manifest_version: MANIFEST_VERSION,
    computation_type,
    engine_id,
    engine_version,
    rule_id,
    rule_version,
    rule_contract_hash,
    as_of,
    temporal_window,
    geography_version,
    input_sources: Object.freeze(
      input_sources.map((s) => Object.freeze({ ...s })),
    ),
    parameters: Object.freeze({ ...parameters }),
  });

  return manifest;
}

/**
 * Compute the deterministic hash of a manifest.
 * This is the identity of the computation's inputs.
 */
export function hashManifest(manifest) {
  const canonical = JSON.stringify(manifest, (key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.keys(value).sort().reduce((sorted, k) => {
        sorted[k] = value[k];
        return sorted;
      }, {});
    }
    return value;
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Create a computation receipt. The receipt is the immutable proof
 * that a computation was performed with specific inputs and produced
 * specific outputs.
 */
export function createReceipt({
  manifest,
  output_summary,
  output_hash = null,
  provenance_chain = [],
  status = 'completed',
  error = null,
}) {
  if (!manifest) throw new Error('receipt requires a manifest');

  const manifestHash = hashManifest(manifest);

  // Compute output hash if output_summary is provided
  const computedOutputHash = output_hash || (output_summary
    ? createHash('sha256')
        .update(JSON.stringify(output_summary))
        .digest('hex')
    : null);

  // Receipt identity = hash(manifest_hash + output_hash)
  const receiptIdentity = createHash('sha256')
    .update(`${manifestHash}:${computedOutputHash || 'null'}`)
    .digest('hex');

  return Object.freeze({
    receipt_version: MANIFEST_VERSION,
    receipt_identity: receiptIdentity,
    manifest_hash: manifestHash,
    manifest,
    output_hash: computedOutputHash,
    output_summary: output_summary ? Object.freeze({ ...output_summary }) : null,
    provenance_chain: Object.freeze([...provenance_chain]),
    status,
    error: error ? String(error).slice(0, 2000) : null,
    computed_at: new Date().toISOString(),
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

  const expectedIdentity = createHash('sha256')
    .update(`${receipt.manifest_hash}:${receipt.output_hash || 'null'}`)
    .digest('hex');

  if (expectedIdentity !== receipt.receipt_identity) {
    return { valid: false, reason: 'receipt_identity mismatch' };
  }

  return { valid: true, reason: null };
}

/**
 * Chain receipts together to form a provenance trail.
 * Each receipt in the chain references the previous receipt's identity.
 */
export function chainReceipts(receipts) {
  return receipts.map((r) => ({
    receipt_identity: r.receipt_identity,
    computation_type: r.manifest?.computation_type,
    engine_id: r.manifest?.engine_id,
    computed_at: r.computed_at,
  }));
}

export { MANIFEST_VERSION };
