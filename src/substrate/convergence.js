/**
 * ATLAS CONVERGENCE ENGINE v2.1.0
 *
 * Production implementation of Math Engine v2.1 convergence detection.
 * Atlas owns this computation. Lighthouse consumes Atlas receipts.
 *
 * Equations implemented (from ENGINE_EQUATIONS):
 * - signal_fingerprint: h(s)=SHA256(τ||G||⌊t/Δt⌋||χ)
 * - multiplicative_convergence: C2=|T|*mean(c)*ln(n+1)*(0.5+0.5r)
 * - poisson_z_score: E[n]=(N_total/A_total)*A_geography; Z=(n_observed-E[n])/√E[n]
 * - recency_factor: r=1-(as_of-t_max)/Δt_window
 *
 * Null model: area_weighted_poisson
 * All computations are deterministic, explicit, and replay-safe.
 */

import { canonicalJson, sha256, ENGINE_VERSION } from './canonical.js';

export { ENGINE_VERSION };

export const NULL_MODEL_ID = 'area_weighted_poisson';
export const NULL_MODEL_ASSUMPTIONS = Object.freeze([
  'Signal generation is independent across geographies',
  'Area is a valid proxy for expected signal density',
  'Signals within the time window are independent observations',
  'The geography registry snapshot is complete for the analysis domain',
]);

export const ENGINE_EQUATIONS = Object.freeze({
  signal_fingerprint: 'h(s)=SHA256(τ||G||⌊t/Δt⌋||χ)',
  jaccard_similarity: 'J(A,B)=|A∩B|/|A∪B|',
  cosine_similarity: 'cos(θ)=(a·b)/(||a||||b||)',
  precedence_confidence: 'Score_n=P0*(1+(C-N)*λ_n); λ_n=1/√(C+N+1)',
  weighted_confidence: 'W=0.7c+0.3Score',
  recency_factor: 'r=1-(as_of-t_max)/Δt_window',
  multiplicative_convergence: 'C2=|T|*mean(c)*ln(n+1)*(0.5+0.5r)',
  poisson_z_score: 'E[n]=(N_total/A_total)*A_geography; Z=(n_observed-E[n])/√E[n]',
  haversine_distance: 'd=R*2*atan2(√a,√(1-a)); R=6371km',
  network_adjacency_kernel: 's_g=exp(-d²/(2σ²))',
  temporal_similarity: 's_t=1-Δt/Δt_max',
  spatial_similarity_gaussian: 's_g=exp(-d²/(2σ²))',
  joint_similarity: 'S=s_t×s_g',
  area_weighted_allocation: 'w(s→t)=A(s∩t)/A(s); normalized: w/Σw',
  signal_translation: "c'_t=c_s×w(s→t)",
  weighted_priority: 'Priority=10×(0.4u+0.3e+0.2f+0.1c)',
});

// --- Utility functions ---

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function round4(v) { return Math.round(v * 10000) / 10000; }
function assertFinite(v, name) { if (!Number.isFinite(v)) throw new Error(`${name} must be finite`); }
function assertPositiveFinite(v, name) { if (!Number.isFinite(v) || v <= 0) throw new Error(`${name} must be positive`); }
function assertUnit(v, name) { if (!Number.isFinite(v) || v < 0 || v > 1) throw new Error(`${name} must be in [0,1]`); }
function validateLatitude(v) { if (!Number.isFinite(v) || v < -90 || v > 90) throw new Error('latitude must be between -90 and 90'); }
function validateLongitude(v) { if (!Number.isFinite(v) || v < -180 || v > 180) throw new Error('longitude must be between -180 and 180'); }

function validateRegistry(registry) {
  if (!registry.version || !registry.version.trim()) throw new Error('geography registry version is required');
  if (!registry.entries || !registry.entries.length) throw new Error('geography registry is empty');
  const ids = new Set();
  for (const e of registry.entries) {
    if (ids.has(e.id)) throw new Error(`duplicate geography '${e.id}'`);
    ids.add(e.id);
    assertPositiveFinite(e.area_sq_km, `area_sq_km for ${e.id}`);
    if (e.centroid_lat !== null) validateLatitude(e.centroid_lat);
    if (e.centroid_lon !== null) validateLongitude(e.centroid_lon);
  }
}

// --- Signal fingerprinting (Math Engine v2.1 contract) ---

/**
 * h(s) = SHA256(τ || G || ⌊t/Δt⌋ || χ)
 * Fingerprint uses signal_type, spatial_coordinate, temporal bucket, and characteristics.
 */
export function signalFingerprint(signal, temporal_bucket_ms = 86_400_000) {
  assertPositiveFinite(temporal_bucket_ms, 'temporal_bucket_ms');
  const payload = {
    signal_type: signal.signal_type,
    spatial_coordinate: signal.spatial_coordinate,
    temporal_bucket: Math.floor(signal.temporal_coordinate / temporal_bucket_ms),
    characteristics: signal.characteristics,
  };
  return sha256(payload);
}

/**
 * Deduplicate signals by fingerprint. Deterministic: sort by id first,
 * keep highest confidence, then smallest id on tie.
 */
export function deduplicateSignals(signals, temporal_bucket_ms = 86_400_000) {
  const ordered = [...signals].sort((a, b) => a.id.localeCompare(b.id));
  const seen = new Map();
  for (const signal of ordered) {
    const fp = signalFingerprint(signal, temporal_bucket_ms);
    const existing = seen.get(fp);
    if (!existing || compareSignalPreference(signal, existing) < 0) {
      seen.set(fp, signal);
    }
  }
  return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function compareSignalPreference(a, b) {
  const ac = a.confidence ?? -1;
  const bc = b.confidence ?? -1;
  if (ac !== bc) return bc - ac;
  return a.id.localeCompare(b.id);
}

// --- Convergence detection (Math Engine v2.1 contract) ---

/**
 * detectConvergence: Area-weighted Poisson Z-score convergence.
 *
 * Input contract:
 * - geography: string (the target geography ID)
 * - raw_signals: Signal[] (all signals for this geography, sorted by id)
 * - as_of: number (epoch ms, explicit)
 * - time_window_ms: number (positive)
 * - temporal_bucket_ms: number (positive, for dedup)
 * - total_signals_all_geographies: number (non-negative integer, full population count after dedup)
 * - geography_registry: { version: string, entries: GeographyEntry[] }
 *
 * Output: ConvergenceResult with full provenance fields.
 */
export function detectConvergence(input) {
  assertFinite(input.as_of, 'as_of');
  assertPositiveFinite(input.time_window_ms, 'time_window_ms');
  assertPositiveFinite(input.temporal_bucket_ms, 'temporal_bucket_ms');
  if (!Number.isInteger(input.total_signals_all_geographies) || input.total_signals_all_geographies < 0) {
    throw new Error('total_signals_all_geographies must be a non-negative integer');
  }
  validateRegistry(input.geography_registry);
  for (const s of input.raw_signals) {
    if (s.temporal_coordinate > input.as_of) throw new Error(`signal ${s.id} occurs after as_of`);
    if (s.confidence !== null && s.confidence !== undefined) assertUnit(s.confidence, `signal ${s.id} confidence`);
  }

  const raw = [...input.raw_signals].sort((a, b) => a.id.localeCompare(b.id));
  const signals = deduplicateSignals(raw, input.temporal_bucket_ms);

  // Dominant type from raw frequency
  const counts = new Map();
  for (const s of raw) counts.set(s.signal_type, (counts.get(s.signal_type) || 0) + 1);
  const dominant = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || 'none';

  // Mean confidence (null propagation)
  const confidences = signals.flatMap(s => s.confidence === null || s.confidence === undefined ? [] : [s.confidence]);
  const mean = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : null;

  // Recency factor: r = 1 - (as_of - t_max) / Δt_window
  const tMax = signals.length ? Math.max(...signals.map(s => s.temporal_coordinate)) : input.as_of;
  const recency = signals.length ? clamp(1 - (input.as_of - tMax) / input.time_window_ms, 0, 1) : 0;

  // Multiplicative convergence: C2 = |T| * mean(c) * ln(n+1) * (0.5 + 0.5r)
  const multiplicative = mean === null
    ? null
    : counts.size * mean * Math.log(signals.length + 1) * (0.5 + 0.5 * recency);

  // Poisson Z-score: E[n] = (N_total / A_total) * A_geography
  const totalArea = input.geography_registry.entries.reduce((s, e) => s + e.area_sq_km, 0);
  const geo = input.geography_registry.entries.find(e => e.id === input.geography);
  let poisson;
  if (!signals.length) {
    poisson = { status: 'unresolved', expected_count: null, observed_count: 0, z_score: null, reason_unresolved: 'No signals' };
  } else if (!geo) {
    poisson = { status: 'unresolved', expected_count: null, observed_count: signals.length, z_score: null, reason_unresolved: `Geography '${input.geography}' absent from registry '${input.geography_registry.version}'` };
  } else {
    const expected = (input.total_signals_all_geographies / totalArea) * geo.area_sq_km;
    poisson = expected > 0
      ? { status: 'resolved', expected_count: round4(expected), observed_count: signals.length, z_score: round4((signals.length - expected) / Math.sqrt(expected)) }
      : { status: 'unresolved', expected_count: 0, observed_count: signals.length, z_score: null, reason_unresolved: 'Expected count is zero' };
  }

  return {
    geography: input.geography,
    raw_signal_count: raw.length,
    signal_count: signals.length,
    distinct_types: counts.size,
    mean_confidence: mean === null ? null : round4(mean),
    recency_factor: round4(recency),
    multiplicative_score: multiplicative === null ? null : round4(multiplicative),
    dominant_type: dominant,
    poisson,
    source_signal_ids: raw.map(s => s.id),
    deduplicated_signal_ids: signals.map(s => s.id),
    null_model: {
      model_id: NULL_MODEL_ID,
      assumptions: NULL_MODEL_ASSUMPTIONS,
      geography_registry_version: input.geography_registry.version,
      total_area_sq_km: round4(totalArea),
      geography_area_sq_km: geo ? round4(geo.area_sq_km) : null,
      total_signals: input.total_signals_all_geographies,
    },
  };
}

// --- Provenance receipt generation (Math Engine v2.1 contract) ---

/**
 * Generate an immutable provenance receipt for a convergence computation.
 * The input_hash covers the COMPLETE sorted raw population, deduplicated population,
 * full geography registry snapshot, null model identity, and configuration.
 */
export function generateProvenanceReceipt(params) {
  const inputPayload = {
    raw_population: [...params.raw_population].sort((a, b) => a.id.localeCompare(b.id)),
    deduplicated_population: [...params.deduplicated_population].sort((a, b) => a.id.localeCompare(b.id)),
    geography_registry: {
      version: params.geography_registry.version,
      entries: [...params.geography_registry.entries].sort((a, b) => a.id.localeCompare(b.id)),
    },
    null_model: { id: NULL_MODEL_ID, assumptions: NULL_MODEL_ASSUMPTIONS },
    configuration: params.config,
  };
  return {
    run_key: params.run_key,
    geography_id: params.geography_id,
    equation_id: params.equation_id,
    engine_version: ENGINE_VERSION,
    rule_manifest_hash: sha256(ENGINE_EQUATIONS),
    as_of: params.as_of,
    configuration_hash: sha256(params.config),
    input_hash: sha256(inputPayload),
    source_signal_ids: params.raw_population.map(s => s.id).sort(),
    geography_registry_version: params.geography_registry.version,
    expected_count: params.expected_count,
    observed_count: params.observed_count,
    computed_outputs: params.computed_outputs,
    timestamp_computed: params.as_of,
  };
}

// --- Spatial utilities ---

const EARTH_RADIUS_KM = 6371;

export function haversineDistance(lat1, lon1, lat2, lon2) {
  validateLatitude(lat1); validateLatitude(lat2);
  validateLongitude(lon1); validateLongitude(lon2);
  const rad = (d) => d * Math.PI / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function spatialSimilarityHaversine(a, b, registry, sigma_km) {
  assertPositiveFinite(sigma_km, 'sigma_km');
  if (a === b) return 1;
  const A = registry.entries.find(e => e.id === a);
  const B = registry.entries.find(e => e.id === b);
  if (!A || !B || A.centroid_lat === null || A.centroid_lon === null || B.centroid_lat === null || B.centroid_lon === null) return null;
  const d = haversineDistance(A.centroid_lat, A.centroid_lon, B.centroid_lat, B.centroid_lon);
  return Math.exp(-(d * d) / (2 * sigma_km * sigma_km));
}

export function networkAdjacencyKernel(a, b, registry, sigma_hops) {
  assertPositiveFinite(sigma_hops, 'sigma_hops');
  if (a === b) return 1;
  const visited = new Set([a]);
  let frontier = [a];
  let depth = 0;
  while (frontier.length && depth < registry.entries.length + 1) {
    depth++;
    const next = [];
    for (const node of frontier) {
      const entry = registry.entries.find(e => e.id === node);
      for (const neighbor of entry?.adjacency ?? []) {
        if (neighbor === b) return Math.exp(-(depth ** 2) / (2 * sigma_hops ** 2));
        if (!visited.has(neighbor)) { visited.add(neighbor); next.push(neighbor); }
      }
    }
    frontier = next;
  }
  return null;
}

export function temporalSimilarity(t1, t2, maxDistance) {
  assertPositiveFinite(maxDistance, 'max_temporal_distance_ms');
  return clamp(1 - Math.abs(t2 - t1) / maxDistance, 0, 1);
}

export function jointSimilarity(params) {
  const temporal = temporalSimilarity(
    params.signal_a.temporal_coordinate,
    params.signal_b.temporal_coordinate,
    params.max_temporal_distance_ms,
  );
  const spatial = spatialSimilarityHaversine(
    params.signal_a.spatial_coordinate,
    params.signal_b.spatial_coordinate,
    params.geography_registry,
    params.spatial_sigma_km,
  );
  return {
    temporal: round4(temporal),
    spatial: spatial === null ? null : round4(spatial),
    joint: spatial === null ? null : round4(temporal * spatial),
  };
}
