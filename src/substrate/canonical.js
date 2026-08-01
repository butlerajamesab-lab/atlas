/**
 * ATLAS CANONICAL SERIALIZATION v2.1.0
 *
 * Single recursive canonical JSON serializer used for ALL identity hashing
 * in the Atlas mathematical substrate. Conforms to Math Engine v2.1 contract.
 *
 * Properties:
 * - Key-order independent (objects sorted by key)
 * - Deterministic across invocations
 * - No hidden state (no Date.now(), no Math.random())
 * - Handles null, arrays, nested objects recursively
 *
 * Used for: signal fingerprints, rule manifests, registry hashes,
 * configuration hashes, complete output hashes, receipt identities,
 * provenance input hashes, replay identity comparison.
 */

import { createHash } from 'node:crypto';

/**
 * Recursive canonical JSON serializer.
 * Objects have keys sorted lexicographically at every nesting level.
 * Arrays preserve order. Primitives serialize via JSON.stringify.
 *
 * Matches Lighthouse Math Engine v2.1 `canonicalJson` exactly.
 */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value;
  return `{${Object.keys(obj).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

/**
 * SHA-256 hash of the canonical JSON representation of any value.
 * This is the single hashing function for the entire substrate.
 */
export function sha256(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

/**
 * Validate that two values produce identical canonical representations.
 * Used for replay proof and idempotency verification.
 */
export function canonicalEqual(a, b) {
  return canonicalJson(a) === canonicalJson(b);
}

/**
 * Compute a run key from explicit parameters.
 * Matches Math Engine v2.1 `computeRunKey`.
 */
export function computeRunKey({ as_of, config, geography_registry_version, engine_version }) {
  return sha256({
    engine_version: engine_version || ENGINE_VERSION,
    as_of,
    config,
    geography_registry_version,
  });
}

export const ENGINE_VERSION = '2.1.0';
