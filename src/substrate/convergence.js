import { sha256, ENGINE_VERSION } from './canonical.js';

export { ENGINE_VERSION };

export const NULL_MODEL_ID = 'area_weighted_poisson';
export const NULL_MODEL_ASSUMPTIONS = Object.freeze([
  'Signal generation is independent across geographies',
  'Area is the declared proxy for expected signal density',
  'Signals within the bounded window are independent observations',
  'Registry entries form the complete non-overlapping partition for the declared analysis level',
]);

export const ENGINE_EQUATIONS = Object.freeze({
  signal_fingerprint: 'h(s)=SHA256(τ||G||⌊t/Δt⌋||χ)',
  recency_factor: 'r=1-(as_of-t_max)/Δt_window',
  multiplicative_convergence: 'C2=|T|*mean(c)*ln(n+1)*(0.5+0.5r)',
  poisson_z_score: 'E[n]=(N_total/A_total)*A_geography; Z=(n_observed-E[n])/√E[n]',
  haversine_distance: 'd=R*2*atan2(√a,√(1-a)); R=6371km',
  network_adjacency_kernel: 's_g=exp(-d²/(2σ²))',
  temporal_similarity: 's_t=1-Δt/Δt_max',
  spatial_similarity_gaussian: 's_g=exp(-d²/(2σ²))',
  joint_similarity: 'S=s_t×s_g',
});

function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
function round12(value) { return Math.round(value * 1e12) / 1e12; }
function assertFinite(value, name) { if (!Number.isFinite(value)) throw new Error(`${name} must be finite`); }
function assertPositiveFinite(value, name) { if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`); }
function assertUnit(value, name) { if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be in [0,1]`); }
function validateLatitude(value) { if (!Number.isFinite(value) || value < -90 || value > 90) throw new Error('latitude must be between -90 and 90'); }
function validateLongitude(value) { if (!Number.isFinite(value) || value < -180 || value > 180) throw new Error('longitude must be between -180 and 180'); }

function validateRegistry(registry) {
  if (!registry || typeof registry.version !== 'string' || registry.version.length === 0) {
    throw new Error('geography registry version is required');
  }
  if (!Array.isArray(registry.entries) || registry.entries.length === 0) {
    throw new Error('geography registry is empty');
  }
  const ids = new Set();
  for (const entry of registry.entries) {
    if (typeof entry.id !== 'string' || entry.id.length === 0) throw new Error('geography id is required');
    if (ids.has(entry.id)) throw new Error(`duplicate geography '${entry.id}'`);
    ids.add(entry.id);
    assertPositiveFinite(entry.area_sq_km, `area_sq_km for ${entry.id}`);
    if (entry.centroid_lat !== null) validateLatitude(entry.centroid_lat);
    if (entry.centroid_lon !== null) validateLongitude(entry.centroid_lon);
  }
}

function validateSignal(signal, requireId = true) {
  if (!signal || typeof signal !== 'object') throw new Error('signal is required');
  if (requireId && (typeof signal.id !== 'string' || signal.id.length === 0)) throw new Error('signal id is required');
  if (typeof signal.signal_type !== 'string' || signal.signal_type.length === 0) throw new Error(`signal ${signal.id} signal_type is required`);
  if (typeof signal.spatial_coordinate !== 'string' || signal.spatial_coordinate.length === 0) throw new Error(`signal ${signal.id} spatial_coordinate is required`);
  assertFinite(signal.temporal_coordinate, `signal ${signal.id} temporal_coordinate`);
  if (signal.confidence !== null && signal.confidence !== undefined) assertUnit(signal.confidence, `signal ${signal.id} confidence`);
}

export function signalFingerprint(signal, temporal_bucket_ms = 86_400_000) {
  assertPositiveFinite(temporal_bucket_ms, 'temporal_bucket_ms');
  validateSignal(signal, false);
  return sha256({
    signal_type: signal.signal_type,
    spatial_coordinate: signal.spatial_coordinate,
    temporal_bucket: Math.floor(signal.temporal_coordinate / temporal_bucket_ms),
    characteristics: signal.characteristics ?? {},
  });
}

export function deduplicateSignals(signals, temporal_bucket_ms = 86_400_000) {
  if (!Array.isArray(signals)) throw new Error('signals must be an array');
  const ordered = [...signals].sort((left, right) => left.id.localeCompare(right.id));
  const seen = new Map();
  for (const signal of ordered) {
    const fingerprint = signalFingerprint(signal, temporal_bucket_ms);
    const existing = seen.get(fingerprint);
    if (!existing || compareSignalPreference(signal, existing) < 0) seen.set(fingerprint, signal);
  }
  return [...seen.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function compareSignalPreference(left, right) {
  const leftConfidence = left.confidence ?? -1;
  const rightConfidence = right.confidence ?? -1;
  if (leftConfidence !== rightConfidence) return rightConfidence - leftConfidence;
  return left.id.localeCompare(right.id);
}

export function detectConvergence(input) {
  assertFinite(input.as_of, 'as_of');
  assertPositiveFinite(input.time_window_ms, 'time_window_ms');
  assertPositiveFinite(input.temporal_bucket_ms, 'temporal_bucket_ms');
  if (!Number.isInteger(input.total_signals_all_geographies) || input.total_signals_all_geographies < 0) {
    throw new Error('total_signals_all_geographies must be a non-negative integer');
  }
  validateRegistry(input.geography_registry);
  if (!Array.isArray(input.raw_signals)) throw new Error('raw_signals must be an array');
  for (const signal of input.raw_signals) {
    validateSignal(signal);
    if (signal.temporal_coordinate > input.as_of) throw new Error(`signal ${signal.id} occurs after as_of`);
    if (signal.temporal_coordinate < input.as_of - input.time_window_ms) throw new Error(`signal ${signal.id} occurs before the governed window`);
    if (signal.spatial_coordinate !== input.geography) throw new Error(`signal ${signal.id} does not belong to geography ${input.geography}`);
  }

  const raw = [...input.raw_signals].sort((left, right) => left.id.localeCompare(right.id));
  const signals = deduplicateSignals(raw, input.temporal_bucket_ms);
  const typeCounts = new Map();
  for (const signal of raw) typeCounts.set(signal.signal_type, (typeCounts.get(signal.signal_type) ?? 0) + 1);
  const dominantType = [...typeCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? 'none';
  const confidences = signals
    .filter((signal) => signal.confidence !== null && signal.confidence !== undefined)
    .map((signal) => signal.confidence);
  const meanConfidence = confidences.length
    ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
    : null;
  const latest = signals.length ? Math.max(...signals.map((signal) => signal.temporal_coordinate)) : input.as_of;
  const recency = signals.length ? clamp(1 - (input.as_of - latest) / input.time_window_ms, 0, 1) : 0;
  const multiplicative = meanConfidence === null
    ? null
    : typeCounts.size * meanConfidence * Math.log(signals.length + 1) * (0.5 + 0.5 * recency);

  const geography = input.geography_registry.entries.find((entry) => entry.id === input.geography);
  const totalArea = input.geography_registry.entries.reduce((sum, entry) => sum + entry.area_sq_km, 0);
  let poisson;
  if (!geography) {
    poisson = {
      status: 'unresolved',
      expected_count: null,
      observed_count: signals.length,
      z_score: null,
      reason_unresolved: `Geography '${input.geography}' is absent from registry '${input.geography_registry.version}'`,
    };
  } else if (input.total_signals_all_geographies === 0) {
    poisson = {
      status: 'unresolved',
      expected_count: 0,
      observed_count: 0,
      z_score: null,
      reason_unresolved: 'The governed analysis population contains zero signals',
    };
  } else {
    const expected = (input.total_signals_all_geographies / totalArea) * geography.area_sq_km;
    poisson = {
      status: 'resolved',
      expected_count: round12(expected),
      observed_count: signals.length,
      z_score: round12((signals.length - expected) / Math.sqrt(expected)),
    };
  }

  return {
    geography: input.geography,
    raw_signal_count: raw.length,
    signal_count: signals.length,
    distinct_types: typeCounts.size,
    mean_confidence: meanConfidence === null ? null : round12(meanConfidence),
    recency_factor: round12(recency),
    multiplicative_score: multiplicative === null ? null : round12(multiplicative),
    dominant_type: dominantType,
    poisson,
    source_signal_ids: raw.map((signal) => signal.id),
    deduplicated_signal_ids: signals.map((signal) => signal.id),
    null_model: {
      model_id: NULL_MODEL_ID,
      assumptions: NULL_MODEL_ASSUMPTIONS,
      geography_registry_version: input.geography_registry.version,
      analysis_level: input.geography_registry.analysis_level ?? null,
      total_area_sq_km: round12(totalArea),
      geography_area_sq_km: geography ? round12(geography.area_sq_km) : null,
      total_signals: input.total_signals_all_geographies,
    },
  };
}

export function generateProvenanceReceipt(params) {
  const sourcePopulation = [...(params.source_population ?? [])];
  const rawPopulation = [...params.raw_population].sort((left, right) => left.id.localeCompare(right.id));
  const deduplicatedPopulation = [...params.deduplicated_population].sort((left, right) => left.id.localeCompare(right.id));
  const registry = {
    version: params.geography_registry.version,
    analysis_level: params.geography_registry.analysis_level ?? null,
    entries: [...params.geography_registry.entries].sort((left, right) => left.id.localeCompare(right.id)),
  };
  const inputPayload = {
    run_key: params.run_key,
    geography_id: params.geography_id,
    equation_id: params.equation_id,
    source_population: sourcePopulation,
    raw_population: rawPopulation,
    deduplicated_population: deduplicatedPopulation,
    geography_registry: registry,
    null_model: { id: NULL_MODEL_ID, assumptions: NULL_MODEL_ASSUMPTIONS },
    configuration: params.config,
  };
  const inputHash = sha256(inputPayload);
  const outputHash = sha256(params.computed_outputs);
  const ruleManifestHash = sha256(ENGINE_EQUATIONS);
  const receiptIdentity = sha256({
    engine_version: ENGINE_VERSION,
    rule_manifest_hash: ruleManifestHash,
    run_key: params.run_key,
    geography_id: params.geography_id,
    equation_id: params.equation_id,
    input_hash: inputHash,
    output_hash: outputHash,
  });
  return {
    receipt_identity: receiptIdentity,
    run_key: params.run_key,
    geography_id: params.geography_id,
    equation_id: params.equation_id,
    engine_version: ENGINE_VERSION,
    rule_manifest_hash: ruleManifestHash,
    as_of: params.as_of,
    configuration_hash: sha256(params.config),
    source_population_hash: sha256(sourcePopulation),
    input_hash: inputHash,
    output_hash: outputHash,
    source_signal_ids: [...(params.geography_signal_ids ?? [])].sort(),
    geography_registry_version: params.geography_registry.version,
    expected_count: params.expected_count,
    observed_count: params.observed_count,
    computed_outputs: params.computed_outputs,
    timestamp_computed: params.as_of,
  };
}

const EARTH_RADIUS_KM = 6371;

export function haversineDistance(lat1, lon1, lat2, lon2) {
  validateLatitude(lat1); validateLatitude(lat2);
  validateLongitude(lon1); validateLongitude(lon2);
  const radians = (degrees) => degrees * Math.PI / 180;
  const latitudeDistance = radians(lat2 - lat1);
  const longitudeDistance = radians(lon2 - lon1);
  const a = Math.sin(latitudeDistance / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(longitudeDistance / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function spatialSimilarityHaversine(leftId, rightId, registry, sigma_km) {
  assertPositiveFinite(sigma_km, 'sigma_km');
  if (leftId === rightId) return 1;
  const left = registry.entries.find((entry) => entry.id === leftId);
  const right = registry.entries.find((entry) => entry.id === rightId);
  if (!left || !right || left.centroid_lat === null || left.centroid_lon === null
      || right.centroid_lat === null || right.centroid_lon === null) return null;
  const distance = haversineDistance(left.centroid_lat, left.centroid_lon, right.centroid_lat, right.centroid_lon);
  return Math.exp(-(distance * distance) / (2 * sigma_km * sigma_km));
}

export function networkAdjacencyKernel(leftId, rightId, registry, sigma_hops) {
  assertPositiveFinite(sigma_hops, 'sigma_hops');
  if (leftId === rightId) return 1;
  const visited = new Set([leftId]);
  let frontier = [leftId];
  let depth = 0;
  while (frontier.length && depth < registry.entries.length + 1) {
    depth += 1;
    const next = [];
    for (const node of frontier) {
      const entry = registry.entries.find((candidate) => candidate.id === node);
      for (const neighbor of entry?.adjacency ?? []) {
        if (neighbor === rightId) return Math.exp(-(depth ** 2) / (2 * sigma_hops ** 2));
        if (!visited.has(neighbor)) { visited.add(neighbor); next.push(neighbor); }
      }
    }
    frontier = next;
  }
  return null;
}

export function temporalSimilarity(leftTime, rightTime, maxDistance) {
  assertPositiveFinite(maxDistance, 'max_temporal_distance_ms');
  return clamp(1 - Math.abs(rightTime - leftTime) / maxDistance, 0, 1);
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
    temporal: round12(temporal),
    spatial: spatial === null ? null : round12(spatial),
    joint: spatial === null ? null : round12(temporal * spatial),
  };
}
