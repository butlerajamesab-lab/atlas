/**
 * ATLAS MATHEMATICAL SUBSTRATE v2.1.0
 *
 * Canonical exports for the Atlas deterministic computation substrate.
 * Atlas owns the production implementation of Math Engine v2.1.
 * Lighthouse consumes Atlas receipts — it is not a competing calculation authority.
 *
 * Atlas must NOT: interpret law, replace Rosetta, perform Prism verification,
 * create legal conclusions, create cases or governed findings, silently promote
 * candidates, use LLMs, use probabilistic or semantic guessing, invent missing
 * values, assign placeholder scores, or hide unresolved state.
 */

// Canonical serialization and hashing (the single source of truth for all identity)
export {
  canonicalJson,
  sha256,
  canonicalEqual,
  computeRunKey,
  ENGINE_VERSION,
} from './canonical.js';

// Temporal operations (explicit as_of, bounded windows)
export {
  normalizeTimestamp,
  createTemporalWindow,
  isWithinWindow,
  temporalFingerprint,
  filterByAsOf,
} from './temporal.js';

// Geography authority (versioned, source-identified, immutable)
export {
  normalizeGeographyId,
  validateGeographyRecord,
  validateGeographyRegistry,
  computeRegistryHash,
  toRuntimeRegistry,
  resolveGeography,
  buildAdjacencyMap,
} from './geography.js';

// Geography loader (file → provenance + runtime formats)
export {
  loadWashingtonGeography,
  loadGeographyByJurisdiction,
  listAvailableJurisdictions,
} from './geographyLoader.js';

// Convergence engine (Math Engine v2.1 equations)
export {
  ENGINE_EQUATIONS,
  NULL_MODEL_ID,
  NULL_MODEL_ASSUMPTIONS,
  signalFingerprint,
  deduplicateSignals,
  detectConvergence,
  generateProvenanceReceipt,
  haversineDistance,
  spatialSimilarityHaversine,
  networkAdjacencyKernel,
  temporalSimilarity,
  jointSimilarity,
} from './convergence.js';

// Immutable manifests and receipts
export {
  createInputManifest,
  hashManifest,
  createReceipt,
  verifyReceipt,
  chainReceipts,
  MANIFEST_VERSION,
} from './manifest.js';

// Deterministic replay
export {
  executeReplay,
  verifyReplayConsistency,
} from './replay.js';

// Relationship computation
export {
  jaccardSimilarity,
  signalCoOccurrence,
  computeRelationship,
  computeEntityRelationships,
} from './relationships.js';
