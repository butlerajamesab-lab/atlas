/**
 * ATLAS RELATIONSHIP COMPUTATION v2.1.0
 *
 * Computes deterministic relationship strengths between entities based on
 * observed signal co-occurrence. No inference, no guessing — only observed evidence.
 *
 * All weights and thresholds are passed in as rule-manifest parameters.
 * No hard-coded normalization caps, proximity windows, or relationship weights.
 *
 * Platform rule: Same signals + same entities + same parameters + same as_of → same output.
 */

import { sha256 } from './canonical.js';

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
    jaccard: jaccardSimilarity(
      new Set(signals.filter(s => (s.entity_ids || []).includes(entityA)).map(s => s.id || s.fingerprint)),
      new Set(signals.filter(s => (s.entity_ids || []).includes(entityB)).map(s => s.id || s.fingerprint)),
    ),
  };
}

/**
 * Compute a relationship between two entities.
 * All weights come from the rule_params — nothing is hard-coded.
 *
 * @param {string} entityA
 * @param {string} entityB
 * @param {object[]} signals - Signals with entity_ids, stream_id, timestamp
 * @param {object} rule_params - { co_occurrence_weight, temporal_weight, stream_weight }
 */
export function computeRelationship(entityA, entityB, signals, rule_params = {}) {
  if (entityA === entityB) throw new Error('computeRelationship requires two distinct entities');

  const coOcc = signalCoOccurrence(entityA, entityB, signals);

  // Weights from rule manifest (no defaults — caller must provide or accept 0)
  const coWeight = rule_params.co_occurrence_weight ?? 0;
  const temporalWeight = rule_params.temporal_weight ?? 0;
  const streamWeight = rule_params.stream_weight ?? 0;

  // Temporal proximity: fraction of co-occurring signals within the same temporal bucket
  let temporalScore = 0;
  if (coOcc.co_occurring > 0 && rule_params.temporal_bucket_ms) {
    const coSignals = signals.filter(s => {
      const entities = s.entity_ids || [];
      return entities.includes(entityA) && entities.includes(entityB);
    });
    const buckets = new Set(coSignals.map(s => Math.floor(new Date(s.timestamp).getTime() / rule_params.temporal_bucket_ms)));
    temporalScore = buckets.size > 0 ? coSignals.length / buckets.size / coSignals.length : 0;
  }

  // Stream diversity: fraction of distinct streams in co-occurring signals
  let streamScore = 0;
  if (coOcc.co_occurring > 0) {
    const coSignals = signals.filter(s => {
      const entities = s.entity_ids || [];
      return entities.includes(entityA) && entities.includes(entityB);
    });
    const streams = new Set(coSignals.map(s => s.stream_id));
    streamScore = streams.size / Math.max(1, coSignals.length);
  }

  const strength = coWeight * coOcc.jaccard + temporalWeight * temporalScore + streamWeight * streamScore;

  return {
    entity_a: entityA,
    entity_b: entityB,
    co_occurrence: coOcc,
    temporal_score: temporalScore,
    stream_score: streamScore,
    strength,
    evidence_hash: sha256({ entityA, entityB, co_occurring: coOcc.co_occurring, jaccard: coOcc.jaccard }),
  };
}

/**
 * Compute all pairwise relationships for a set of entities.
 * Only returns pairs with evidence (co_occurring > 0).
 */
export function computeEntityRelationships(entityIds, signals, rule_params = {}) {
  const pairs = [];
  const sorted = [...entityIds].sort();

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const rel = computeRelationship(sorted[i], sorted[j], signals, rule_params);
      if (rel.co_occurrence.co_occurring > 0) {
        pairs.push(rel);
      }
    }
  }

  return {
    entity_count: entityIds.length,
    pairs_evaluated: (sorted.length * (sorted.length - 1)) / 2,
    relationships_with_evidence: pairs.length,
    relationships: pairs,
  };
}
