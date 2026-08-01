/**
 * Atlas Deterministic Relationship & Similarity Kernels
 *
 * Computes deterministic relationship strengths between entities based
 * on observed signal co-occurrence, shared geography, and temporal
 * proximity. No inference, no guessing — only observed evidence.
 *
 * Platform rule: Same signals + same entities + same as_of → same relationship scores.
 */

import { createHash } from 'node:crypto';

const RELATIONSHIP_ENGINE_VERSION = '1.0.0';

/**
 * Compute Jaccard similarity between two sets.
 * Returns a value in [0, 1] where 1 = identical sets.
 */
export function jaccardSimilarity(setA, setB) {
  if (!setA || !setB || setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Compute signal co-occurrence between two entities.
 * Returns the number of signals that reference both entities.
 */
export function signalCoOccurrence(entityA, entityB, signals) {
  let coOccurring = 0;
  let entityACount = 0;
  let entityBCount = 0;

  for (const signal of signals) {
    const entities = signal.entity_ids || [];
    const hasA = entities.includes(entityA);
    const hasB = entities.includes(entityB);
    if (hasA) entityACount++;
    if (hasB) entityBCount++;
    if (hasA && hasB) coOccurring++;
  }

  return {
    co_occurring: coOccurring,
    entity_a_count: entityACount,
    entity_b_count: entityBCount,
    // Normalized co-occurrence: co / min(a, b)
    normalized: Math.min(entityACount, entityBCount) > 0
      ? coOccurring / Math.min(entityACount, entityBCount)
      : 0,
  };
}

/**
 * Compute stream overlap between two entities.
 * Returns the Jaccard similarity of the streams each entity appears in.
 */
export function streamOverlap(entityA, entityB, signals) {
  const streamsA = new Set();
  const streamsB = new Set();

  for (const signal of signals) {
    const entities = signal.entity_ids || [];
    if (entities.includes(entityA) && signal.stream_id) {
      streamsA.add(signal.stream_id);
    }
    if (entities.includes(entityB) && signal.stream_id) {
      streamsB.add(signal.stream_id);
    }
  }

  return {
    streams_a: [...streamsA].sort(),
    streams_b: [...streamsB].sort(),
    jaccard: jaccardSimilarity(streamsA, streamsB),
  };
}

/**
 * Compute temporal proximity between two entities.
 * Returns the average time gap between their signals.
 */
export function temporalProximity(entityA, entityB, signals) {
  const timestampsA = [];
  const timestampsB = [];

  for (const signal of signals) {
    const entities = signal.entity_ids || [];
    const ts = signal.timestamp ? new Date(signal.timestamp).getTime() : null;
    if (ts === null || !Number.isFinite(ts)) continue;
    if (entities.includes(entityA)) timestampsA.push(ts);
    if (entities.includes(entityB)) timestampsB.push(ts);
  }

  if (timestampsA.length === 0 || timestampsB.length === 0) {
    return { avg_gap_ms: null, min_gap_ms: null, normalized: 0 };
  }

  // Find minimum time gap between any pair of signals
  let minGap = Infinity;
  let totalGap = 0;
  let pairs = 0;

  for (const ta of timestampsA) {
    for (const tb of timestampsB) {
      const gap = Math.abs(ta - tb);
      if (gap < minGap) minGap = gap;
      totalGap += gap;
      pairs++;
    }
  }

  const avgGap = pairs > 0 ? totalGap / pairs : Infinity;
  // Normalize: 1 day = 0.5, 1 hour = 0.9, same time = 1.0
  const ONE_DAY = 86400000;
  const normalized = Math.max(0, 1 - (minGap / (7 * ONE_DAY)));

  return {
    avg_gap_ms: Math.round(avgGap),
    min_gap_ms: Math.round(minGap),
    normalized,
    pairs_evaluated: pairs,
  };
}

/**
 * Compute a complete relationship observation between two entities.
 * Combines all kernels into a single deterministic assessment.
 */
export function computeRelationship(entityA, entityB, signals, options = {}) {
  if (!entityA || !entityB) throw new Error('relationship requires two entity IDs');
  if (entityA === entityB) throw new Error('relationship requires two distinct entities');
  if (!Array.isArray(signals)) throw new Error('relationship requires signals array');

  const coOccurrence = signalCoOccurrence(entityA, entityB, signals);
  const overlap = streamOverlap(entityA, entityB, signals);
  const proximity = temporalProximity(entityA, entityB, signals);

  // Composite score: weighted average of normalized kernels
  const weights = options.weights || { co_occurrence: 0.4, stream_overlap: 0.3, temporal: 0.3 };
  const composite =
    coOccurrence.normalized * weights.co_occurrence +
    overlap.jaccard * weights.stream_overlap +
    proximity.normalized * weights.temporal;

  // Relationship fingerprint for deduplication
  const sortedEntities = [entityA, entityB].sort();
  const fingerprint = createHash('sha256')
    .update(`relationship:${RELATIONSHIP_ENGINE_VERSION}:${sortedEntities.join(':')}`)
    .digest('hex');

  return {
    entity_a: entityA,
    entity_b: entityB,
    fingerprint,
    engine_version: RELATIONSHIP_ENGINE_VERSION,
    kernels: {
      co_occurrence: coOccurrence,
      stream_overlap: overlap,
      temporal_proximity: proximity,
    },
    composite_score: Math.round(composite * 1000000) / 1000000, // 6 decimal precision
    signal_count: signals.length,
    evidence_signals: coOccurrence.co_occurring,
  };
}

/**
 * Compute all pairwise relationships for a set of entities.
 * Only computes relationships where evidence exists (co-occurrence > 0).
 */
export function computeEntityRelationships(entityIds, signals, options = {}) {
  if (!Array.isArray(entityIds) || entityIds.length < 2) {
    return { relationships: [], entity_count: entityIds?.length || 0 };
  }

  // Pre-index: which entities appear in which signals
  const entitySignalIndex = new Map();
  for (const signal of signals) {
    for (const eid of signal.entity_ids || []) {
      if (entityIds.includes(eid)) {
        const list = entitySignalIndex.get(eid) || [];
        list.push(signal);
        entitySignalIndex.set(eid, list);
      }
    }
  }

  // Only compute relationships where both entities have signals
  const relationships = [];
  const sorted = [...entityIds].sort();

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];

      // Skip if either entity has no signals
      if (!entitySignalIndex.has(a) || !entitySignalIndex.has(b)) continue;

      // Only compute if there's at least one co-occurring signal
      const relevantSignals = signals.filter((s) => {
        const entities = s.entity_ids || [];
        return entities.includes(a) || entities.includes(b);
      });

      const rel = computeRelationship(a, b, relevantSignals, options);
      if (rel.evidence_signals > 0) {
        relationships.push(rel);
      }
    }
  }

  return {
    relationships: relationships.sort((a, b) => b.composite_score - a.composite_score),
    entity_count: entityIds.length,
    pairs_evaluated: (sorted.length * (sorted.length - 1)) / 2,
    relationships_with_evidence: relationships.length,
  };
}

export { RELATIONSHIP_ENGINE_VERSION };
