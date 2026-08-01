/**
 * Atlas Deterministic Convergence Computation
 *
 * Convergence is the mathematical observation that multiple independent
 * signals point toward the same entity, geography, or temporal pattern.
 * It is NOT interpretation, legal conclusion, or case creation.
 *
 * Convergence computation:
 * 1. Takes a set of verified signals with known fingerprints
 * 2. Groups them by declared convergence dimensions (entity, geography, time)
 * 3. Computes relationship strengths using deterministic kernels
 * 4. Produces convergence observations with immutable receipts
 *
 * Platform rule: Same signals + same rules + same as_of → same convergence output.
 */

import { createHash } from 'node:crypto';
import { computeConvergenceFingerprint, computeManifestHash } from './fingerprint.js';
import { createTemporalWindow, isWithinWindow } from './temporal.js';

const CONVERGENCE_ENGINE_VERSION = '1.0.0';

/**
 * Convergence rule definition. Each rule declares:
 * - which signal types participate
 * - which dimensions to group by
 * - minimum signal count threshold
 * - the relationship kernel to apply
 */
export function createConvergenceRule({
  rule_id,
  rule_version = '1.0.0',
  signal_types,
  group_dimensions,
  min_signals = 2,
  kernel = 'count',
  description,
}) {
  if (!rule_id) throw new Error('convergence rule requires rule_id');
  if (!Array.isArray(signal_types) || signal_types.length === 0) {
    throw new Error('convergence rule requires at least one signal_type');
  }
  if (!Array.isArray(group_dimensions) || group_dimensions.length === 0) {
    throw new Error('convergence rule requires at least one group_dimension');
  }
  if (min_signals < 2) {
    throw new Error('convergence requires min_signals >= 2');
  }

  const validKernels = ['count', 'temporal_density', 'geographic_proximity', 'entity_co_occurrence'];
  if (!validKernels.includes(kernel)) {
    throw new Error(`unsupported kernel: ${kernel}. Valid: ${validKernels.join(', ')}`);
  }

  return Object.freeze({
    rule_id,
    rule_version,
    signal_types,
    group_dimensions,
    min_signals,
    kernel,
    description: description || null,
  });
}

/**
 * Extract the grouping key from a signal based on declared dimensions.
 * Returns null if any required dimension is missing — never fills gaps.
 */
function extractGroupKey(signal, dimensions) {
  const parts = [];
  for (const dim of dimensions) {
    const value = signal[dim];
    if (value === null || value === undefined || value === '') return null;
    if (Array.isArray(value)) {
      parts.push([...value].sort().join(','));
    } else {
      parts.push(String(value));
    }
  }
  return parts.join('|');
}

/**
 * Count kernel: convergence strength = number of independent signals.
 * No weighting, no inference.
 */
function kernelCount(signals) {
  return {
    strength: signals.length,
    method: 'count',
    normalized: Math.min(1.0, signals.length / 10), // cap at 10 for normalization
  };
}

/**
 * Temporal density kernel: signals clustered in time score higher.
 * Uses the standard deviation of timestamps relative to window size.
 */
function kernelTemporalDensity(signals, window) {
  if (!window || !window.duration_ms || window.duration_ms === 0) {
    return kernelCount(signals);
  }

  const timestamps = signals
    .map((s) => s.timestamp ? new Date(s.timestamp).getTime() : null)
    .filter((t) => t !== null);

  if (timestamps.length < 2) return kernelCount(signals);

  const mean = timestamps.reduce((a, b) => a + b, 0) / timestamps.length;
  const variance = timestamps.reduce((a, t) => a + (t - mean) ** 2, 0) / timestamps.length;
  const stddev = Math.sqrt(variance);

  // Density = 1 - (stddev / window_duration), clamped to [0, 1]
  const density = Math.max(0, Math.min(1, 1 - (stddev / window.duration_ms)));

  return {
    strength: signals.length,
    method: 'temporal_density',
    normalized: density,
    stddev_ms: Math.round(stddev),
    window_ms: window.duration_ms,
  };
}

/**
 * Geographic proximity kernel: signals in same or adjacent jurisdictions.
 * Requires explicit adjacency data — never infers proximity.
 */
function kernelGeographicProximity(signals, adjacencyMap) {
  const jurisdictions = [...new Set(
    signals
      .map((s) => s.jurisdiction_id)
      .filter(Boolean),
  )];

  if (jurisdictions.length <= 1) {
    return {
      strength: signals.length,
      method: 'geographic_proximity',
      normalized: 1.0, // all same jurisdiction
      jurisdiction_count: jurisdictions.length,
    };
  }

  // Count adjacent pairs
  let adjacentPairs = 0;
  let totalPairs = 0;
  for (let i = 0; i < jurisdictions.length; i++) {
    for (let j = i + 1; j < jurisdictions.length; j++) {
      totalPairs++;
      const adj = adjacencyMap?.[jurisdictions[i]] || [];
      if (adj.includes(jurisdictions[j])) {
        adjacentPairs++;
      }
    }
  }

  const proximity = totalPairs > 0 ? adjacentPairs / totalPairs : 0;

  return {
    strength: signals.length,
    method: 'geographic_proximity',
    normalized: proximity,
    jurisdiction_count: jurisdictions.length,
    adjacent_pairs: adjacentPairs,
    total_pairs: totalPairs,
  };
}

/**
 * Entity co-occurrence kernel: signals sharing entity references.
 */
function kernelEntityCoOccurrence(signals) {
  const entityCounts = new Map();
  for (const signal of signals) {
    const entities = signal.entity_ids || [];
    for (const eid of entities) {
      entityCounts.set(eid, (entityCounts.get(eid) || 0) + 1);
    }
  }

  const coOccurring = [...entityCounts.values()].filter((c) => c >= 2).length;
  const totalEntities = entityCounts.size;

  return {
    strength: signals.length,
    method: 'entity_co_occurrence',
    normalized: totalEntities > 0 ? coOccurring / totalEntities : 0,
    co_occurring_entities: coOccurring,
    total_entities: totalEntities,
  };
}

/**
 * Apply the appropriate kernel based on rule configuration.
 */
function applyKernel(kernel, signals, context = {}) {
  switch (kernel) {
    case 'count':
      return kernelCount(signals);
    case 'temporal_density':
      return kernelTemporalDensity(signals, context.window);
    case 'geographic_proximity':
      return kernelGeographicProximity(signals, context.adjacencyMap);
    case 'entity_co_occurrence':
      return kernelEntityCoOccurrence(signals);
    default:
      return kernelCount(signals);
  }
}

/**
 * Compute convergence observations for a set of signals against a rule.
 * Returns an immutable receipt with all inputs declared.
 */
export function computeConvergence({
  signals,
  rule,
  asOf,
  window = null,
  adjacencyMap = null,
  geographyVersion = null,
}) {
  if (!asOf) throw new Error('convergence computation requires explicit as_of');
  if (!rule) throw new Error('convergence computation requires a rule');
  if (!Array.isArray(signals) || signals.length === 0) {
    return {
      status: 'empty',
      observations: [],
      receipt: null,
    };
  }

  // Filter signals by type
  const eligible = signals.filter((s) =>
    rule.signal_types.includes('*') || rule.signal_types.includes(s.signal_type),
  );

  // Filter by temporal window if provided
  const temporallyBounded = window
    ? eligible.filter((s) => isWithinWindow(s.timestamp, window))
    : eligible;

  // Group by declared dimensions
  const groups = new Map();
  for (const signal of temporallyBounded) {
    const key = extractGroupKey(signal, rule.group_dimensions);
    if (key === null) continue; // Skip signals missing required dimensions
    const group = groups.get(key) || [];
    group.push(signal);
    groups.set(key, group);
  }

  // Compute convergence for groups meeting threshold
  const observations = [];
  for (const [groupKey, groupSignals] of groups.entries()) {
    if (groupSignals.length < rule.min_signals) continue;

    const fingerprints = groupSignals.map((s) => s.fingerprint || s.event_identity_hash).filter(Boolean);
    const convergenceFingerprint = fingerprints.length >= 2
      ? computeConvergenceFingerprint(fingerprints, rule.rule_id)
      : null;

    const kernelResult = applyKernel(rule.kernel, groupSignals, {
      window,
      adjacencyMap,
    });

    observations.push({
      group_key: groupKey,
      group_dimensions: rule.group_dimensions,
      signal_count: groupSignals.length,
      convergence_fingerprint: convergenceFingerprint,
      kernel_result: kernelResult,
      signal_fingerprints: fingerprints,
      signal_types: [...new Set(groupSignals.map((s) => s.signal_type))],
      entity_ids: [...new Set(groupSignals.flatMap((s) => s.entity_ids || []))],
      jurisdiction_ids: [...new Set(groupSignals.map((s) => s.jurisdiction_id).filter(Boolean))],
      earliest_signal: groupSignals.reduce(
        (min, s) => (!min || (s.timestamp && s.timestamp < min) ? s.timestamp : min),
        null,
      ),
      latest_signal: groupSignals.reduce(
        (max, s) => (!max || (s.timestamp && s.timestamp > max) ? s.timestamp : max),
        null,
      ),
    });
  }

  // Build immutable input manifest
  const inputManifest = {
    engine_version: CONVERGENCE_ENGINE_VERSION,
    rule_id: rule.rule_id,
    rule_version: rule.rule_version,
    as_of: asOf,
    window: window || null,
    geography_version: geographyVersion,
    input_signal_count: signals.length,
    eligible_signal_count: eligible.length,
    temporally_bounded_count: temporallyBounded.length,
    groups_evaluated: groups.size,
    observations_produced: observations.length,
  };

  const manifestHash = computeManifestHash(inputManifest);

  return {
    status: 'completed',
    observations,
    receipt: {
      manifest: inputManifest,
      manifest_hash: manifestHash,
      computed_at: new Date().toISOString(),
    },
  };
}

export { CONVERGENCE_ENGINE_VERSION };
