/**
 * ATLAS MATHEMATICAL SUBSTRATE v2.1 CONFORMANCE TESTS
 *
 * These tests prove Atlas implements Math Engine v2.1 correctly.
 * They are the acceptance criteria — if these pass, Atlas is the canonical authority.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalJson,
  sha256,
  canonicalEqual,
  computeRunKey,
  ENGINE_VERSION,
} from '../src/substrate/canonical.js';

import {
  normalizeTimestamp,
  createTemporalWindow,
  isWithinWindow,
  filterByAsOf,
} from '../src/substrate/temporal.js';

import {
  normalizeGeographyId,
  validateGeographyRecord,
  validateGeographyRegistry,
  computeRegistryHash,
  toRuntimeRegistry,
  resolveGeography,
  buildAdjacencyMap,
} from '../src/substrate/geography.js';

import {
  signalFingerprint,
  deduplicateSignals,
  detectConvergence,
  generateProvenanceReceipt,
  ENGINE_EQUATIONS,
  NULL_MODEL_ID,
  haversineDistance,
  temporalSimilarity,
  jointSimilarity,
} from '../src/substrate/convergence.js';

import {
  createInputManifest,
  hashManifest,
  createReceipt,
  verifyReceipt,
  chainReceipts,
} from '../src/substrate/manifest.js';

import {
  executeReplay,
  verifyReplayConsistency,
} from '../src/substrate/replay.js';

import {
  jaccardSimilarity,
  signalCoOccurrence,
  computeRelationship,
  computeEntityRelationships,
} from '../src/substrate/relationships.js';

// ═══════════════════════════════════════════════════════════════
// CANONICAL SERIALIZATION
// ═══════════════════════════════════════════════════════════════

test('canonicalJson is key-order independent', () => {
  const a = { z: 1, a: 2, m: { b: 3, a: 4 } };
  const b = { a: 2, m: { a: 4, b: 3 }, z: 1 };
  assert.equal(canonicalJson(a), canonicalJson(b));
});

test('canonicalJson handles null, arrays, nested objects', () => {
  assert.equal(canonicalJson(null), 'null');
  assert.equal(canonicalJson([1, 2, 3]), '[1,2,3]');
  assert.equal(canonicalJson({ b: [1], a: null }), '{"a":null,"b":[1]}');
});

test('sha256 produces 64-char hex', () => {
  const h = sha256({ test: true });
  assert.match(h, /^[0-9a-f]{64}$/);
});

test('sha256 is deterministic', () => {
  const a = sha256({ x: 1, y: [2, 3] });
  const b = sha256({ y: [2, 3], x: 1 });
  assert.equal(a, b);
});

test('canonicalEqual detects identical objects with different key order', () => {
  assert.equal(canonicalEqual({ a: 1, b: 2 }, { b: 2, a: 1 }), true);
  assert.equal(canonicalEqual({ a: 1 }, { a: 2 }), false);
});

test('ENGINE_VERSION is 2.1.0', () => {
  assert.equal(ENGINE_VERSION, '2.1.0');
});

// ═══════════════════════════════════════════════════════════════
// TEMPORAL
// ═══════════════════════════════════════════════════════════════

test('normalizeTimestamp returns ISO UTC', () => {
  assert.equal(normalizeTimestamp('2026-01-15T10:00:00Z'), '2026-01-15T10:00:00.000Z');
  assert.equal(normalizeTimestamp(null), null);
  assert.equal(normalizeTimestamp('invalid'), null);
});

test('createTemporalWindow validates bounds', () => {
  const w = createTemporalWindow('2026-01-01T00:00:00Z', '2026-01-31T23:59:59Z', '2026-02-01T00:00:00Z');
  assert.equal(w.from, '2026-01-01T00:00:00.000Z');
  assert.ok(w.duration_ms > 0);
});

test('createTemporalWindow rejects invalid bounds', () => {
  assert.throws(() => createTemporalWindow(null, '2026-01-31', '2026-02-01'), /requires explicit "from"/);
  assert.throws(() => createTemporalWindow('2026-02-01', '2026-01-01', '2026-03-01'), /must not exceed "to"/);
});

test('filterByAsOf excludes records after as_of', () => {
  const records = [
    { ts: '2026-01-01T00:00:00Z' },
    { ts: '2026-01-15T00:00:00Z' },
    { ts: '2026-02-01T00:00:00Z' },
  ];
  const filtered = filterByAsOf(records, 'ts', '2026-01-20T00:00:00Z');
  assert.equal(filtered.length, 2);
});

// ═══════════════════════════════════════════════════════════════
// GEOGRAPHY
// ═══════════════════════════════════════════════════════════════

test('normalizeGeographyId uppercases and trims', () => {
  assert.equal(normalizeGeographyId('us_wa'), 'US_WA');
  assert.equal(normalizeGeographyId(' WA '), 'WA');
  assert.equal(normalizeGeographyId(null), null);
});

test('validateGeographyRecord accepts valid records', () => {
  const result = validateGeographyRecord({
    jurisdiction_id: 'us_wa', source_id: 'census', source_record_id: 'x',
    name: 'Washington', level: 'state', effective_from: '2024-01-01',
    area_sq_km: 184827, centroid_lat: 47.38, centroid_lon: -120.45,
  });
  assert.equal(result.valid, true);
});

test('validateGeographyRecord rejects zero area', () => {
  const result = validateGeographyRecord({
    jurisdiction_id: 'us_wa', source_id: 'census', source_record_id: 'x',
    name: 'Washington', level: 'state', effective_from: '2024-01-01',
    area_sq_km: 0,
  });
  assert.equal(result.valid, false);
});

test('validateGeographyRegistry detects duplicates', () => {
  const records = [
    { jurisdiction_id: 'us_wa', source_id: 'c', source_record_id: 'a', name: 'WA', level: 'state', effective_from: '2024-01-01' },
    { jurisdiction_id: 'us_wa', source_id: 'c', source_record_id: 'b', name: 'WA2', level: 'state', effective_from: '2024-01-01' },
  ];
  const result = validateGeographyRegistry(records);
  assert.equal(result.valid, false);
});

test('computeRegistryHash is deterministic and order-independent', () => {
  const records = [
    { jurisdiction_id: 'us_wa_king', source_id: 'c', source_record_id: 'a', name: 'King', level: 'county', effective_from: '2024-01-01', adjacent_to: ['us_wa_pierce'] },
    { jurisdiction_id: 'us_wa', source_id: 'c', source_record_id: 'b', name: 'WA', level: 'state', effective_from: '2024-01-01', adjacent_to: [] },
  ];
  const hash1 = computeRegistryHash(records);
  const hash2 = computeRegistryHash([...records].reverse());
  assert.equal(hash1, hash2);
  assert.match(hash1, /^[0-9a-f]{64}$/);
});

test('computeRegistryHash includes adjacency in hash', () => {
  const base = [
    { jurisdiction_id: 'us_wa', source_id: 'c', source_record_id: 'a', name: 'WA', level: 'state', effective_from: '2024-01-01', adjacent_to: [] },
  ];
  const withAdj = [
    { jurisdiction_id: 'us_wa', source_id: 'c', source_record_id: 'a', name: 'WA', level: 'state', effective_from: '2024-01-01', adjacent_to: ['us_or'] },
  ];
  assert.notEqual(computeRegistryHash(base), computeRegistryHash(withAdj));
});

test('toRuntimeRegistry produces v2.1 format', () => {
  const records = [
    { jurisdiction_id: 'us_wa', area_sq_km: 184827, centroid_lat: 47.38, centroid_lon: -120.45, adjacent_to: ['us_or'] },
  ];
  const runtime = toRuntimeRegistry(records, 'test_version');
  assert.equal(runtime.version, 'test_version');
  assert.equal(runtime.entries[0].id, 'US_WA');
  assert.equal(runtime.entries[0].area_sq_km, 184827);
  assert.deepEqual(runtime.entries[0].adjacency, ['US_OR']);
});

test('resolveGeography matches by id, name, and fips', () => {
  const records = [
    { jurisdiction_id: 'us_wa', name: 'Washington', fips_code: '53', level: 'state' },
    { jurisdiction_id: 'us_wa_king', name: 'King County', fips_code: '53033', level: 'county' },
  ];
  assert.equal(resolveGeography('us_wa', records), 'US_WA');
  assert.equal(resolveGeography('Washington', records), 'US_WA');
  assert.equal(resolveGeography('53', records), 'US_WA');
  assert.equal(resolveGeography('Oregon', records), null);
});

// ═══════════════════════════════════════════════════════════════
// SIGNAL FINGERPRINTING (Math Engine v2.1)
// ═══════════════════════════════════════════════════════════════

test('signalFingerprint uses temporal bucket', () => {
  const signal = { signal_type: 'complaint', spatial_coordinate: 'WA', temporal_coordinate: 86_400_000 * 5 + 1000, characteristics: { product: 'mortgage' } };
  const fp = signalFingerprint(signal, 86_400_000);
  assert.match(fp, /^[0-9a-f]{64}$/);
  // Same bucket → same fingerprint
  const signal2 = { ...signal, temporal_coordinate: 86_400_000 * 5 + 50000 };
  assert.equal(signalFingerprint(signal2, 86_400_000), fp);
  // Different bucket → different fingerprint
  const signal3 = { ...signal, temporal_coordinate: 86_400_000 * 6 + 1000 };
  assert.notEqual(signalFingerprint(signal3, 86_400_000), fp);
});

test('signalFingerprint throws on zero bucket', () => {
  const signal = { signal_type: 'x', spatial_coordinate: 'WA', temporal_coordinate: 1000, characteristics: {} };
  assert.throws(() => signalFingerprint(signal, 0), /must be positive/);
});

test('deduplicateSignals is deterministic: keeps highest confidence, then smallest id', () => {
  const signals = [
    { id: 'b', signal_type: 'x', spatial_coordinate: 'WA', temporal_coordinate: 1000, confidence: 0.9, characteristics: {} },
    { id: 'a', signal_type: 'x', spatial_coordinate: 'WA', temporal_coordinate: 1000, confidence: 0.8, characteristics: {} },
    { id: 'c', signal_type: 'x', spatial_coordinate: 'WA', temporal_coordinate: 1000, confidence: 0.9, characteristics: {} },
  ];
  const deduped = deduplicateSignals(signals, 86_400_000);
  // All same bucket+type+spatial+characteristics → one survivor: highest confidence (0.9), then smallest id ('b')
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].id, 'b');
});

test('deduplicateSignals preserves signals in different buckets', () => {
  const signals = [
    { id: 'a', signal_type: 'x', spatial_coordinate: 'WA', temporal_coordinate: 0, confidence: 0.5, characteristics: {} },
    { id: 'b', signal_type: 'x', spatial_coordinate: 'WA', temporal_coordinate: 86_400_000, confidence: 0.5, characteristics: {} },
  ];
  const deduped = deduplicateSignals(signals, 86_400_000);
  assert.equal(deduped.length, 2);
});

// ═══════════════════════════════════════════════════════════════
// CONVERGENCE DETECTION (Math Engine v2.1)
// ═══════════════════════════════════════════════════════════════

const TEST_REGISTRY = Object.freeze({
  version: '2026.08.01',
  entries: [
    { id: 'OR', area_sq_km: 254799, centroid_lat: 43.8041, centroid_lon: -120.5542, adjacency: ['WA'] },
    { id: 'WA', area_sq_km: 184827, centroid_lat: 47.3826, centroid_lon: -120.4472, adjacency: ['OR'] },
  ],
});

const TEST_CONFIG = Object.freeze({
  as_of: 1_700_100_000_000,
  time_window_ms: 7 * 86_400_000,
  temporal_bucket_ms: 86_400_000,
  geography_registry_version: '2026.08.01',
  min_signals_for_analysis: 1,
  z_score_threshold: 2,
});

test('detectConvergence computes Poisson Z-score correctly', () => {
  const signals = [
    { id: 's1', signal_type: 'complaint', spatial_coordinate: 'WA', temporal_coordinate: 1_700_000_000_000, confidence: 0.8, characteristics: { product: 'mortgage' } },
    { id: 's2', signal_type: 'complaint', spatial_coordinate: 'WA', temporal_coordinate: 1_700_050_000_000, confidence: 0.7, characteristics: { product: 'credit' } },
    { id: 's3', signal_type: 'alert', spatial_coordinate: 'WA', temporal_coordinate: 1_700_080_000_000, confidence: 0.9, characteristics: { severity: 'high' } },
  ];

  const result = detectConvergence({
    geography: 'WA',
    raw_signals: signals,
    as_of: TEST_CONFIG.as_of,
    time_window_ms: TEST_CONFIG.time_window_ms,
    temporal_bucket_ms: TEST_CONFIG.temporal_bucket_ms,
    total_signals_all_geographies: 10,
    geography_registry: TEST_REGISTRY,
  });

  assert.equal(result.geography, 'WA');
  assert.equal(result.raw_signal_count, 3);
  assert.equal(result.signal_count, 3); // all different fingerprints
  assert.equal(result.distinct_types, 2);
  assert.ok(result.mean_confidence > 0);
  assert.ok(result.recency_factor >= 0 && result.recency_factor <= 1);
  assert.equal(result.poisson.status, 'resolved');
  // E[n] = (10 / (254799 + 184827)) * 184827 ≈ 4.2
  // Z = (3 - 4.2) / sqrt(4.2) ≈ -0.59
  assert.ok(result.poisson.z_score < 0); // fewer than expected
  assert.equal(result.null_model.model_id, 'area_weighted_poisson');
});

test('detectConvergence rejects signals after as_of', () => {
  const signals = [
    { id: 's1', signal_type: 'x', spatial_coordinate: 'WA', temporal_coordinate: 1_700_200_000_000, confidence: 0.5, characteristics: {} },
  ];
  assert.throws(() => detectConvergence({
    geography: 'WA',
    raw_signals: signals,
    as_of: 1_700_100_000_000,
    time_window_ms: 7 * 86_400_000,
    temporal_bucket_ms: 86_400_000,
    total_signals_all_geographies: 10,
    geography_registry: TEST_REGISTRY,
  }), /after as_of/);
});

test('detectConvergence handles null confidence (propagates null)', () => {
  const signals = [
    { id: 's1', signal_type: 'x', spatial_coordinate: 'WA', temporal_coordinate: 1_700_000_000_000, confidence: null, characteristics: {} },
    { id: 's2', signal_type: 'y', spatial_coordinate: 'WA', temporal_coordinate: 1_700_050_000_000, confidence: null, characteristics: {} },
  ];
  const result = detectConvergence({
    geography: 'WA',
    raw_signals: signals,
    as_of: TEST_CONFIG.as_of,
    time_window_ms: TEST_CONFIG.time_window_ms,
    temporal_bucket_ms: TEST_CONFIG.temporal_bucket_ms,
    total_signals_all_geographies: 10,
    geography_registry: TEST_REGISTRY,
  });
  assert.equal(result.mean_confidence, null);
  assert.equal(result.multiplicative_score, null);
});

test('detectConvergence marks geography absent from registry as unresolved', () => {
  const signals = [
    { id: 's1', signal_type: 'x', spatial_coordinate: 'CA', temporal_coordinate: 1_700_000_000_000, confidence: 0.5, characteristics: {} },
  ];
  const result = detectConvergence({
    geography: 'CA',
    raw_signals: signals,
    as_of: TEST_CONFIG.as_of,
    time_window_ms: TEST_CONFIG.time_window_ms,
    temporal_bucket_ms: TEST_CONFIG.temporal_bucket_ms,
    total_signals_all_geographies: 10,
    geography_registry: TEST_REGISTRY,
  });
  assert.equal(result.poisson.status, 'unresolved');
  assert.ok(result.poisson.reason_unresolved.includes('absent'));
});

test('detectConvergence dominant_type from raw frequency', () => {
  const signals = [
    { id: 's1', signal_type: 'complaint', spatial_coordinate: 'WA', temporal_coordinate: 1_700_000_000_000, confidence: 0.5, characteristics: {} },
    { id: 's2', signal_type: 'complaint', spatial_coordinate: 'WA', temporal_coordinate: 1_700_050_000_000, confidence: 0.5, characteristics: {} },
    { id: 's3', signal_type: 'alert', spatial_coordinate: 'WA', temporal_coordinate: 1_700_080_000_000, confidence: 0.5, characteristics: {} },
  ];
  const result = detectConvergence({
    geography: 'WA',
    raw_signals: signals,
    as_of: TEST_CONFIG.as_of,
    time_window_ms: TEST_CONFIG.time_window_ms,
    temporal_bucket_ms: TEST_CONFIG.temporal_bucket_ms,
    total_signals_all_geographies: 10,
    geography_registry: TEST_REGISTRY,
  });
  assert.equal(result.dominant_type, 'complaint');
});

// ═══════════════════════════════════════════════════════════════
// PROVENANCE RECEIPT
// ═══════════════════════════════════════════════════════════════

test('generateProvenanceReceipt produces deterministic receipt', () => {
  const raw = [
    { id: 's1', signal_type: 'x', spatial_coordinate: 'WA', temporal_coordinate: 1000, confidence: 0.5, characteristics: {} },
  ];
  const receipt = generateProvenanceReceipt({
    run_key: 'test_run',
    geography_id: 'WA',
    equation_id: 'poisson_z_score',
    as_of: 1_700_100_000_000,
    config: TEST_CONFIG,
    raw_population: raw,
    deduplicated_population: raw,
    geography_registry: TEST_REGISTRY,
    expected_count: 4.2,
    observed_count: 1,
    computed_outputs: { z_score: -1.56 },
  });

  assert.equal(receipt.run_key, 'test_run');
  assert.equal(receipt.engine_version, ENGINE_VERSION);
  assert.equal(receipt.rule_manifest_hash, sha256(ENGINE_EQUATIONS));
  assert.equal(receipt.timestamp_computed, 1_700_100_000_000); // === as_of, NOT wall clock
  assert.match(receipt.input_hash, /^[0-9a-f]{64}$/);
  assert.match(receipt.configuration_hash, /^[0-9a-f]{64}$/);
});

test('input_hash changes when full population changes', () => {
  const raw1 = [{ id: 's1', signal_type: 'x', spatial_coordinate: 'WA', temporal_coordinate: 1000, confidence: 0.5, characteristics: {} }];
  const raw2 = [...raw1, { id: 's2', signal_type: 'y', spatial_coordinate: 'OR', temporal_coordinate: 2000, confidence: 0.6, characteristics: {} }];

  const r1 = generateProvenanceReceipt({
    run_key: 'r1', geography_id: 'WA', equation_id: 'poisson', as_of: 1000, config: {},
    raw_population: raw1, deduplicated_population: raw1, geography_registry: TEST_REGISTRY,
    expected_count: 1, observed_count: 1, computed_outputs: {},
  });
  const r2 = generateProvenanceReceipt({
    run_key: 'r2', geography_id: 'WA', equation_id: 'poisson', as_of: 1000, config: {},
    raw_population: raw2, deduplicated_population: raw2, geography_registry: TEST_REGISTRY,
    expected_count: 1, observed_count: 1, computed_outputs: {},
  });
  assert.notEqual(r1.input_hash, r2.input_hash);
});

test('input_hash changes when registry geometry changes', () => {
  const raw = [{ id: 's1', signal_type: 'x', spatial_coordinate: 'WA', temporal_coordinate: 1000, confidence: 0.5, characteristics: {} }];
  const registry2 = { version: '2026.08.01', entries: [{ id: 'WA', area_sq_km: 200000, centroid_lat: 47.0, centroid_lon: -120.0, adjacency: [] }] };

  const r1 = generateProvenanceReceipt({
    run_key: 'r1', geography_id: 'WA', equation_id: 'poisson', as_of: 1000, config: {},
    raw_population: raw, deduplicated_population: raw, geography_registry: TEST_REGISTRY,
    expected_count: 1, observed_count: 1, computed_outputs: {},
  });
  const r2 = generateProvenanceReceipt({
    run_key: 'r2', geography_id: 'WA', equation_id: 'poisson', as_of: 1000, config: {},
    raw_population: raw, deduplicated_population: raw, geography_registry: registry2,
    expected_count: 1, observed_count: 1, computed_outputs: {},
  });
  assert.notEqual(r1.input_hash, r2.input_hash);
});

// ═══════════════════════════════════════════════════════════════
// MANIFEST & RECEIPT
// ═══════════════════════════════════════════════════════════════

test('createInputManifest validates required fields', () => {
  assert.throws(() => createInputManifest({}), /requires computation_type/);
  assert.throws(() => createInputManifest({ computation_type: 'x' }), /requires explicit as_of/);
});

test('hashManifest is deterministic', () => {
  const manifest = createInputManifest({
    computation_type: 'convergence',
    rule_manifest_hash: sha256(ENGINE_EQUATIONS),
    as_of: 1_700_100_000_000,
    source_population_hash: sha256([]),
    signal_count: 0,
  });
  assert.equal(hashManifest(manifest), hashManifest(manifest));
});

test('createReceipt requires output_hash for completed status', () => {
  const manifest = createInputManifest({
    computation_type: 'test',
    rule_manifest_hash: 'abc',
    as_of: 1000,
    source_population_hash: 'def',
    signal_count: 0,
  });
  assert.throws(() => createReceipt({ manifest, status: 'completed' }), /requires output_hash/);
});

test('createReceipt produces verifiable receipt', () => {
  const manifest = createInputManifest({
    computation_type: 'test',
    rule_manifest_hash: 'abc',
    as_of: 1000,
    source_population_hash: 'def',
    signal_count: 5,
  });
  const receipt = createReceipt({
    manifest,
    output_hash: sha256({ result: 42 }),
  });
  assert.ok(receipt.receipt_identity);
  assert.equal(receipt.timestamp_computed, 1000); // === as_of
  const v = verifyReceipt(receipt);
  assert.equal(v.valid, true);
});

test('verifyReceipt detects tampered manifest', () => {
  const manifest = createInputManifest({
    computation_type: 'test',
    rule_manifest_hash: 'abc',
    as_of: 1000,
    source_population_hash: 'def',
    signal_count: 5,
  });
  const receipt = createReceipt({ manifest, output_hash: sha256({}) });
  const tampered = { ...receipt, manifest_hash: 'deadbeef'.repeat(8) };
  assert.equal(verifyReceipt(tampered).valid, false);
});

// ═══════════════════════════════════════════════════════════════
// REPLAY
// ═══════════════════════════════════════════════════════════════

test('executeReplay proves determinism with exact output hash', async () => {
  const raw = [{ id: 's1', value: 10 }, { id: 's2', value: 20 }];
  const deduped = raw;
  const registry = TEST_REGISTRY;
  const config = { multiplier: 2 };

  const computeFn = (r, d, reg, cfg) => {
    const sum = d.reduce((a, s) => a + s.value, 0);
    return { total: sum * cfg.multiplier };
  };

  // First run
  const output = await computeFn(raw, deduped, registry, config);
  const outputHash = sha256(output);
  const manifest = createInputManifest({
    computation_type: 'test',
    rule_manifest_hash: sha256({}),
    as_of: 1000,
    source_population_hash: sha256(raw),
    deduplicated_population_hash: sha256(deduped),
    geography_registry_hash: sha256(registry),
    signal_count: raw.length,
    deduplicated_count: deduped.length,
    configuration: config,
  });
  const originalReceipt = createReceipt({ manifest, output_hash: outputHash });

  // Replay
  const replay = await executeReplay({
    original_receipt: originalReceipt,
    raw_signal_snapshot: raw,
    deduplicated_signal_snapshot: deduped,
    geography_registry_snapshot: registry,
    configuration: config,
    computeFn,
  });

  assert.equal(replay.status, 'completed');
  assert.equal(replay.consistent, true);
  assert.equal(replay.original_output_hash, replay.replay_output_hash);
});

test('executeReplay detects non-deterministic computation', async () => {
  const raw = [{ id: 's1', value: 10 }];
  const computeFn = () => ({ total: 10 });

  const manifest = createInputManifest({
    computation_type: 'test',
    rule_manifest_hash: sha256({}),
    as_of: 1000,
    source_population_hash: sha256(raw),
    signal_count: 1,
  });
  // Fake a different output hash
  const originalReceipt = createReceipt({ manifest, output_hash: sha256({ total: 999 }) });

  const replay = await executeReplay({
    original_receipt: originalReceipt,
    raw_signal_snapshot: raw,
    deduplicated_signal_snapshot: raw,
    geography_registry_snapshot: TEST_REGISTRY,
    configuration: {},
    computeFn,
  });

  assert.equal(replay.consistent, false);
  assert.ok(replay.reason.includes('mismatch'));
});

test('executeReplay detects snapshot hash mismatch', async () => {
  const raw = [{ id: 's1', value: 10 }];
  const manifest = createInputManifest({
    computation_type: 'test',
    rule_manifest_hash: sha256({}),
    as_of: 1000,
    source_population_hash: sha256([{ id: 's1', value: 999 }]), // different from actual
    signal_count: 1,
  });
  const originalReceipt = createReceipt({ manifest, output_hash: sha256({}) });

  const replay = await executeReplay({
    original_receipt: originalReceipt,
    raw_signal_snapshot: raw,
    deduplicated_signal_snapshot: raw,
    geography_registry_snapshot: TEST_REGISTRY,
    configuration: {},
    computeFn: () => ({}),
  });

  assert.equal(replay.status, 'failed');
  assert.equal(replay.consistent, false);
  assert.ok(replay.reason.includes('raw signal snapshot'));
});

// ═══════════════════════════════════════════════════════════════
// RELATIONSHIPS
// ═══════════════════════════════════════════════════════════════

test('jaccardSimilarity computes correctly', () => {
  assert.equal(jaccardSimilarity(new Set([1, 2, 3]), new Set([2, 3, 4])), 2 / 4);
  assert.equal(jaccardSimilarity(new Set([1, 2]), new Set([1, 2])), 1);
  assert.equal(jaccardSimilarity(new Set(), new Set([1])), 0);
});

test('computeRelationship rejects same entity', () => {
  assert.throws(() => computeRelationship('e1', 'e1', []), /two distinct entities/);
});

test('computeEntityRelationships only returns pairs with evidence', () => {
  const signals = [
    { id: 'x1', entity_ids: ['e1', 'e2'], stream_id: 's1', timestamp: '2026-01-01' },
    { id: 'x2', entity_ids: ['e1'], stream_id: 's1', timestamp: '2026-01-02' },
    { id: 'x3', entity_ids: ['e3'], stream_id: 's2', timestamp: '2026-01-01' },
  ];
  const result = computeEntityRelationships(['e1', 'e2', 'e3'], signals);
  assert.equal(result.relationships_with_evidence, 1); // only e1-e2 co-occur
});

// ═══════════════════════════════════════════════════════════════
// DETERMINISM PROOF (100 iterations)
// ═══════════════════════════════════════════════════════════════

test('detectConvergence produces identical output across 100 runs', () => {
  const signals = [
    { id: 's1', signal_type: 'complaint', spatial_coordinate: 'WA', temporal_coordinate: 1_700_000_000_000, confidence: 0.8, characteristics: { product: 'mortgage' } },
    { id: 's2', signal_type: 'alert', spatial_coordinate: 'WA', temporal_coordinate: 1_700_050_000_000, confidence: 0.7, characteristics: { severity: 'high' } },
  ];
  const input = {
    geography: 'WA',
    raw_signals: signals,
    as_of: TEST_CONFIG.as_of,
    time_window_ms: TEST_CONFIG.time_window_ms,
    temporal_bucket_ms: TEST_CONFIG.temporal_bucket_ms,
    total_signals_all_geographies: 10,
    geography_registry: TEST_REGISTRY,
  };

  const firstHash = sha256(detectConvergence(input));
  for (let i = 0; i < 100; i++) {
    const hash = sha256(detectConvergence(input));
    assert.equal(hash, firstHash, `Run ${i} produced different output`);
  }
});
