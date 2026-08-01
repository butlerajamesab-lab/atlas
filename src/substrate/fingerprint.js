/**
 * Atlas Deterministic Signal Fingerprint & Deduplication
 *
 * Computes stable, reproducible identity hashes for signal events and
 * candidates. The fingerprint is a function of declared content fields
 * only — never of ingestion time, adapter replay order, or system state.
 *
 * Platform rule: Same content fields + same version → same fingerprint.
 */

import { createHash } from 'node:crypto';

const FINGERPRINT_VERSION = '1.0.0';
const FIELD_SEPARATOR = '\u001f';

/**
 * Compute a deterministic SHA-256 fingerprint from an ordered set of
 * canonical field values. Null/undefined fields are represented as
 * the literal string "∅" to distinguish from empty string.
 */
export function computeFingerprint(fields, version = FINGERPRINT_VERSION) {
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new Error('fingerprint requires at least one field');
  }

  const canonical = fields.map((f) => {
    if (f === null || f === undefined) return '\u2205'; // ∅
    if (typeof f === 'object') return JSON.stringify(f, Object.keys(f).sort());
    return String(f);
  });

  const input = `v${version}${FIELD_SEPARATOR}${canonical.join(FIELD_SEPARATOR)}`;
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Compute the signal event identity fingerprint.
 * Uses: stream_id, signal_type, source_record_key, payload content hash.
 */
export function computeEventFingerprint(event) {
  if (!event.stream_id) throw new Error('event fingerprint requires stream_id');
  if (!event.signal_type) throw new Error('event fingerprint requires signal_type');

  const payloadHash = event.payload
    ? createHash('sha256')
        .update(JSON.stringify(event.payload, Object.keys(event.payload).sort()))
        .digest('hex')
    : null;

  return computeFingerprint([
    event.stream_id,
    event.signal_type,
    event.source_record_key || null,
    payloadHash,
  ]);
}

/**
 * Compute the candidate identity fingerprint.
 * Uses: domain, version, signal_type, entity_id, source_input_hash, rule_hash.
 */
export function computeCandidateFingerprint(candidate) {
  return computeFingerprint([
    'live_data',
    candidate.candidate_identity_version || '1.1.0',
    candidate.signal_type,
    candidate.entity_id,
    candidate.source_input_hash,
    candidate.rule_contract_hash,
  ]);
}

/**
 * Compute a convergence fingerprint from multiple signal fingerprints.
 * The input fingerprints are sorted to ensure order-independence.
 */
export function computeConvergenceFingerprint(signalFingerprints, convergenceRule) {
  if (!Array.isArray(signalFingerprints) || signalFingerprints.length < 2) {
    throw new Error('convergence requires at least 2 signal fingerprints');
  }
  if (!convergenceRule) {
    throw new Error('convergence requires an explicit rule identifier');
  }

  const sorted = [...signalFingerprints].sort();
  return computeFingerprint([
    'convergence',
    convergenceRule,
    ...sorted,
  ]);
}

/**
 * Deduplicate a set of records by fingerprint.
 * Returns { unique, duplicates } where duplicates includes the
 * duplicate indices and their matching original index.
 */
export function deduplicateByFingerprint(records, fingerprintFn) {
  const seen = new Map(); // fingerprint → first index
  const unique = [];
  const duplicates = [];

  for (let i = 0; i < records.length; i++) {
    const fp = fingerprintFn(records[i]);
    if (seen.has(fp)) {
      duplicates.push({
        index: i,
        fingerprint: fp,
        original_index: seen.get(fp),
      });
    } else {
      seen.set(fp, i);
      unique.push(records[i]);
    }
  }

  return {
    unique,
    duplicates,
    total: records.length,
    unique_count: unique.length,
    duplicate_count: duplicates.length,
  };
}

/**
 * Compute a manifest hash for an immutable input set.
 * This is the identity of the complete input to a computation.
 */
export function computeManifestHash(manifest) {
  const canonical = JSON.stringify(manifest, Object.keys(manifest).sort());
  return createHash('sha256').update(canonical).digest('hex');
}

export { FINGERPRINT_VERSION };
