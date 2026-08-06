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

export {
  canonicalJson,
  sha256,
  canonicalEqual,
  computeRunKey,
  ENGINE_VERSION,
} from './canonical.js';

export {
  normalizeTimestamp,
  createTemporalWindow,
  isWithinWindow,
  temporalFingerprint,
  filterByAsOf,
} from './temporal.js';

export {
  normalizeGeographyId,
  validateGeographyRecord,
  validateGeographyRegistry,
  computeRegistryHash,
  toRuntimeRegistry,
  resolveGeography,
  buildAdjacencyMap,
} from './geography.js';

export {
  loadWashingtonGeography,
  loadGeographyByJurisdiction,
  listAvailableJurisdictions,
} from './geographyLoader.js';

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

export {
  DOMAIN_SPACE_CONTRACT_VERSION,
  DOMAIN_SPACE_TYPES,
  listDomainSpaceRules,
  normalizeDomainSpaceDefinition,
  compareDomainSpaceCoordinates,
  hashDomainSpaceCoordinatePopulation,
} from '../domain-space/domainSpace.js';

export {
  FILTER_STACK_CONTRACT_VERSION,
  FILTER_REGISTRY_VERSION,
  FILTER_PERMISSION_LEVELS,
  FILTER_CATEGORIES,
  DEFAULT_HARDENED_FILTERS,
  listAtlasFilters,
  resolveAtlasFilterStack,
} from '../filters/filterStack.js';

// Structural lenses describe observed Atlas structures only. They do not own
// downstream consequence interpretation or legal/policy meaning.
export {
  STRUCTURAL_LENS_CONTRACT_VERSION,
  STRUCTURAL_LENS_REGISTRY_VERSION,
  listStructuralLenses,
  resolveStructuralLensStack,
} from '../lenses/structuralLenses.js';

export {
  createInputManifest,
  hashManifest,
  createReceipt,
  verifyReceipt,
  chainReceipts,
  MANIFEST_VERSION,
} from './manifest.js';

export {
  executeReplay,
  verifyReplayConsistency,
} from './replay.js';

export {
  jaccardSimilarity,
  signalCoOccurrence,
  computeRelationship,
  computeEntityRelationships,
} from './relationships.js';
