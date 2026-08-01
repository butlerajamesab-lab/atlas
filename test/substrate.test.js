import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeTimestamp,
  createTemporalWindow,
  isWithinWindow,
  temporalFingerprint,
  filterByAsOf,
} from '../src/substrate/temporal.js';

import {
  validateGeographyRecord,
  validateGeographyRegistry,
  computeRegistryHash,
  normalizeGeography,
  createGeographyRegistry,
  buildAdjacencyMap,
} from '../src/substrate/geography.js';

import {
  computeFingerprint,
  computeEventFingerprint,
  computeCandidateFingerprint,
  computeConvergenceFingerprint,
  deduplicateByFingerprint,
  computeManifestHash,
} from '../src/substrate/fingerprint.js';

import {
  createConvergenceRule,
  computeConvergence,
} from '../src/substrate/convergence.js';

import {
  jaccardSimilarity,
  signalCoOccurrence,
  computeRelationship,
  computeEntityRelationships,
} from '../src/substrate/relationships.js';

import {
  createInputManifest,
  createReceipt,
  verifyReceipt,
  hashManifest,
  chainReceipts,
} from '../src/substrate/manifest.js';

import {
  createReplayContext,
  executeReplay,
  verifyReplayConsistency,
} from '../src/substrate/replay.js';

// ═══════════════════════════════════════════════════════════════
// TEMPORAL
// ═══════════════════════════════════════════════════════════════

test('normalizeTimestamp returns ISO UTC for valid inputs', () => {
  assert.equal(normalizeTimestamp('2026-01-15T10:00:00Z'), '2026-01-15T10:00:00.000Z');
  assert.equal(normalizeTimestamp(1737000000000), '2025-01-16T04:00:00.000Z');
});

test('normalizeTimestamp returns null for invalid inputs', () => {
  assert.equal(normalizeTimestamp(null), null);
  assert.equal(normalizeTimestamp(''), null);
  assert.equal(normalizeTimestamp('not-a-date'), null);
  assert.equal(normalizeTimestamp(undefined), null);
});

test('createTemporalWindow validates bounds', () => {
  const w = createTemporalWindow('2026-01-01T00:00:00Z', '2026-01-31T23:59:59Z', '2026-02-01T00:00:00Z');
  assert.equal(w.from, '2026-01-01T00:00:00.000Z');
  assert.equal(w.to, '2026-01-31T23:59:59.000Z');
  assert.equal(w.as_of, '2026-02-01T00:00:00.000Z');
  assert.ok(w.duration_ms > 0);
});

test('createTemporalWindow rejects invalid bounds', () => {
  assert.throws(() => createTemporalWindow(null, '2026-01-31', '2026-02-01'), /requires explicit "from"/);
  assert.throws(() => createTemporalWindow('2026-02-01', '2026-01-01', '2026-03-01'), /must not exceed "to"/);
  assert.throws(() => createTemporalWindow('2026-01-01', '2026-03-01', '2026-02-01'), /must not exceed "as_of"/);
});

test('isWithinWindow correctly classifies timestamps', () => {
  const w = createTemporalWindow('2026-01-01T00:00:00Z', '2026-01-31T23:59:59Z', '2026-02-01T00:00:00Z');
  assert.equal(isWithinWindow('2026-01-15T12:00:00Z', w), true);
  assert.equal(isWithinWindow('2025-12-31T23:59:59Z', w), false);
  assert.equal(isWithinWindow('2026-02-01T00:00:00Z', w), false);
  assert.equal(isWithinWindow(null, w), null);
});

test('filterByAsOf excludes records after as_of', () => {
  const records = [
    { id: 1, ts: '2026-01-01T00:00:00Z' },
    { id: 2, ts: '2026-01-15T00:00:00Z' },
    { id: 3, ts: '2026-02-01T00:00:00Z' },
  ];
  const filtered = filterByAsOf(records, 'ts', '2026-01-20T00:00:00Z');
  assert.equal(filtered.length, 2);
  assert.equal(filtered[0].id, 1);
  assert.equal(filtered[1].id, 2);
});

// ═══════════════════════════════════════════════════════════════
// GEOGRAPHY
// ═══════════════════════════════════════════════════════════════

test('validateGeographyRecord accepts valid records', () => {
  const result = validateGeographyRecord({
    jurisdiction_id: 'us_wa',
    source_id: 'census_tiger_2024',
    source_record_id: 'STATEFP:53',
    name: 'Washington',
    level: 'state',
    fips_code: '53',
    effective_from: '2024-01-01',
    area_sq_km: 184827,
    centroid_lat: 47.3826,
    centroid_lon: -120.4472,
  });
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test('validateGeographyRecord rejects negative area', () => {
  const result = validateGeographyRecord({
    jurisdiction_id: 'us_wa',
    source_id: 'census',
    source_record_id: 'x',
    name: 'Washington',
    level: 'state',
    effective_from: '2024-01-01',
    area_sq_km: -100,
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('non-negative')));
});

test('validateGeographyRecord rejects zero area', () => {
  const result = validateGeographyRecord({
    jurisdiction_id: 'us_wa',
    source_id: 'census',
    source_record_id: 'x',
    name: 'Washington',
    level: 'state',
    effective_from: '2024-01-01',
    area_sq_km: 0,
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('zero')));
});

test('validateGeographyRegistry detects duplicates', () => {
  const records = [
    { jurisdiction_id: 'us_wa', source_id: 'census', source_record_id: 'a', name: 'WA', level: 'state', effective_from: '2024-01-01' },
    { jurisdiction_id: 'us_wa', source_id: 'census', source_record_id: 'b', name: 'WA dup', level: 'state', effective_from: '2024-01-01' },
  ];
  const result = validateGeographyRegistry(records);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.errors.includes('duplicate jurisdiction_id')));
});

test('computeRegistryHash is deterministic', () => {
  const records = [
    { jurisdiction_id: 'us_wa_king', source_id: 'census', source_record_id: 'a', name: 'King', level: 'county', effective_from: '2024-01-01' },
    { jurisdiction_id: 'us_wa', source_id: 'census', source_record_id: 'b', name: 'Washington', level: 'state', effective_from: '2024-01-01' },
  ];
  const hash1 = computeRegistryHash(records);
  const hash2 = computeRegistryHash([...records].reverse());
  assert.equal(hash1.hash, hash2.hash); // order-independent
});

test('normalizeGeography matches by id, name, and fips', () => {
  const registry = [
    { jurisdiction_id: 'us_wa', name: 'Washington', fips_code: '53', level: 'state' },
    { jurisdiction_id: 'us_wa_king', name: 'King County', fips_code: '53033', level: 'county' },
  ];
  assert.equal(normalizeGeography('us_wa', registry), 'us_wa');
  assert.equal(normalizeGeography('Washington', registry), 'us_wa');
  assert.equal(normalizeGeography('53', registry), 'us_wa');
  assert.equal(normalizeGeography('Oregon', registry), null);
});

// ═══════════════════════════════════════════════════════════════
// FINGERPRINT
// ═══════════════════════════════════════════════════════════════

test('computeFingerprint is deterministic', () => {
  const fp1 = computeFingerprint(['stream_a', 'type_b', 'key_c']);
  const fp2 = computeFingerprint(['stream_a', 'type_b', 'key_c']);
  assert.equal(fp1, fp2);
});

test('computeFingerprint distinguishes null from empty string', () => {
  const fp1 = computeFingerprint(['a', null, 'c']);
  const fp2 = computeFingerprint(['a', '', 'c']);
  assert.notEqual(fp1, fp2);
});

test('computeEventFingerprint requires stream_id and signal_type', () => {
  assert.throws(() => computeEventFingerprint({}), /requires stream_id/);
  assert.throws(() => computeEventFingerprint({ stream_id: 'x' }), /requires signal_type/);
});

test('computeConvergenceFingerprint requires at least 2 fingerprints', () => {
  assert.throws(() => computeConvergenceFingerprint(['single'], 'rule'), /at least 2/);
});

test('computeConvergenceFingerprint is order-independent', () => {
  const fp1 = computeConvergenceFingerprint(['aaa', 'bbb', 'ccc'], 'rule1');
  const fp2 = computeConvergenceFingerprint(['ccc', 'aaa', 'bbb'], 'rule1');
  assert.equal(fp1, fp2);
});

test('deduplicateByFingerprint identifies duplicates', () => {
  const records = [
    { stream_id: 'a', signal_type: 'x', payload: { v: 1 } },
    { stream_id: 'b', signal_type: 'y', payload: { v: 2 } },
    { stream_id: 'a', signal_type: 'x', payload: { v: 1 } }, // duplicate
  ];
  const result = deduplicateByFingerprint(records, computeEventFingerprint);
  assert.equal(result.unique_count, 2);
  assert.equal(result.duplicate_count, 1);
});

// ═══════════════════════════════════════════════════════════════
// CONVERGENCE
// ═══════════════════════════════════════════════════════════════

test('createConvergenceRule validates inputs', () => {
  assert.throws(() => createConvergenceRule({}), /requires rule_id/);
  const rule = createConvergenceRule({
    rule_id: 'test_rule',
    signal_types: ['type_a', 'type_b'],
    group_dimensions: ['entity_ids', 'jurisdiction_id'],
    min_signals: 3,
    kernel: 'count',
  });
  assert.equal(rule.rule_id, 'test_rule');
  assert.equal(rule.min_signals, 3);
});

test('computeConvergence groups signals and applies kernel', () => {
  const signals = [
    { signal_type: 'type_a', entity_ids: ['e1'], jurisdiction_id: 'us_wa', timestamp: '2026-01-01', fingerprint: 'fp1' },
    { signal_type: 'type_b', entity_ids: ['e1'], jurisdiction_id: 'us_wa', timestamp: '2026-01-02', fingerprint: 'fp2' },
    { signal_type: 'type_a', entity_ids: ['e1'], jurisdiction_id: 'us_wa', timestamp: '2026-01-03', fingerprint: 'fp3' },
    { signal_type: 'type_a', entity_ids: ['e2'], jurisdiction_id: 'us_or', timestamp: '2026-01-01', fingerprint: 'fp4' },
  ];
  const rule = createConvergenceRule({
    rule_id: 'test',
    signal_types: ['type_a', 'type_b'],
    group_dimensions: ['jurisdiction_id'],
    min_signals: 2,
    kernel: 'count',
  });
  const result = computeConvergence({
    signals,
    rule,
    asOf: '2026-02-01T00:00:00Z',
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.observations.length, 1); // only us_wa meets threshold
  assert.equal(result.observations[0].signal_count, 3);
});

test('computeConvergence requires explicit as_of', () => {
  assert.throws(() => computeConvergence({ signals: [], rule: {}, asOf: null }), /requires explicit as_of/);
});

// ═══════════════════════════════════════════════════════════════
// RELATIONSHIPS
// ═══════════════════════════════════════════════════════════════

test('jaccardSimilarity computes correctly', () => {
  assert.equal(jaccardSimilarity(new Set([1, 2, 3]), new Set([2, 3, 4])), 2 / 4);
  assert.equal(jaccardSimilarity(new Set([1, 2]), new Set([1, 2])), 1);
  assert.equal(jaccardSimilarity(new Set([1]), new Set([2])), 0);
  assert.equal(jaccardSimilarity(new Set(), new Set([1])), 0);
});

test('signalCoOccurrence counts correctly', () => {
  const signals = [
    { entity_ids: ['e1', 'e2'] },
    { entity_ids: ['e1'] },
    { entity_ids: ['e2', 'e3'] },
    { entity_ids: ['e1', 'e2'] },
  ];
  const result = signalCoOccurrence('e1', 'e2', signals);
  assert.equal(result.co_occurring, 2);
  assert.equal(result.entity_a_count, 3);
  assert.equal(result.entity_b_count, 3);
});

test('computeRelationship rejects same entity', () => {
  assert.throws(() => computeRelationship('e1', 'e1', []), /two distinct entities/);
});

test('computeEntityRelationships only returns pairs with evidence', () => {
  const signals = [
    { entity_ids: ['e1', 'e2'], stream_id: 's1', timestamp: '2026-01-01' },
    { entity_ids: ['e1'], stream_id: 's1', timestamp: '2026-01-02' },
    { entity_ids: ['e3'], stream_id: 's2', timestamp: '2026-01-01' },
  ];
  const result = computeEntityRelationships(['e1', 'e2', 'e3'], signals);
  assert.equal(result.relationships_with_evidence, 1); // only e1-e2 co-occur
});

// ═══════════════════════════════════════════════════════════════
// MANIFEST & RECEIPT
// ═══════════════════════════════════════════════════════════════

test('createInputManifest validates required fields', () => {
  assert.throws(() => createInputManifest({}), /requires computation_type/);
  const manifest = createInputManifest({
    computation_type: 'convergence',
    engine_id: 'atlas.convergence',
    engine_version: '1.0.0',
    as_of: '2026-01-01T00:00:00Z',
    input_sources: [{ type: 'signal_events', count: 100 }],
  });
  assert.equal(manifest.computation_type, 'convergence');
  assert.equal(manifest.as_of, '2026-01-01T00:00:00Z');
});

test('hashManifest is deterministic', () => {
  const manifest = createInputManifest({
    computation_type: 'test',
    engine_id: 'test',
    engine_version: '1.0.0',
    as_of: '2026-01-01T00:00:00Z',
    input_sources: [{ type: 'x', count: 1 }],
  });
  assert.equal(hashManifest(manifest), hashManifest(manifest));
});

test('createReceipt produces verifiable receipt', () => {
  const manifest = createInputManifest({
    computation_type: 'test',
    engine_id: 'test',
    engine_version: '1.0.0',
    as_of: '2026-01-01T00:00:00Z',
    input_sources: [{ type: 'x', count: 1 }],
  });
  const receipt = createReceipt({
    manifest,
    output_summary: { count: 5 },
  });
  assert.ok(receipt.receipt_identity);
  assert.ok(receipt.manifest_hash);
  const verification = verifyReceipt(receipt);
  assert.equal(verification.valid, true);
});

test('verifyReceipt detects tampered manifest', () => {
  const manifest = createInputManifest({
    computation_type: 'test',
    engine_id: 'test',
    engine_version: '1.0.0',
    as_of: '2026-01-01T00:00:00Z',
    input_sources: [{ type: 'x', count: 1 }],
  });
  const receipt = createReceipt({ manifest, output_summary: { count: 5 } });
  // Tamper with manifest hash
  const tampered = { ...receipt, manifest_hash: 'deadbeef' };
  const verification = verifyReceipt(tampered);
  assert.equal(verification.valid, false);
});

// ═══════════════════════════════════════════════════════════════
// REPLAY
// ═══════════════════════════════════════════════════════════════

test('createReplayContext filters by as_of', () => {
  const signals = [
    { id: 1, ingested_at: '2026-01-01T00:00:00Z' },
    { id: 2, ingested_at: '2026-01-15T00:00:00Z' },
    { id: 3, ingested_at: '2026-02-01T00:00:00Z' },
  ];
  const ctx = createReplayContext({
    as_of: '2026-01-20T00:00:00Z',
    signals,
    rules: [],
  });
  assert.equal(ctx.bounded_count, 2);
  assert.equal(ctx.excluded_count, 1);
});

test('executeReplay produces receipt and detects drift', async () => {
  const signals = [
    { id: 1, ingested_at: '2026-01-01T00:00:00Z', value: 10 },
    { id: 2, ingested_at: '2026-01-15T00:00:00Z', value: 20 },
  ];

  const computeFn = (sigs) => ({ sum: sigs.reduce((a, s) => a + s.value, 0) });

  const ctx = createReplayContext({
    as_of: '2026-02-01T00:00:00Z',
    signals,
    rules: [],
  });

  const result = await executeReplay({
    replayContext: ctx,
    computeFn,
    computation_type: 'sum',
    engine_id: 'test',
    engine_version: '1.0.0',
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.result.sum, 30);
  assert.ok(result.receipt.receipt_identity);
});

test('verifyReplayConsistency detects matching outputs', () => {
  const manifest = createInputManifest({
    computation_type: 'test',
    engine_id: 'test',
    engine_version: '1.0.0',
    as_of: '2026-01-01T00:00:00Z',
    input_sources: [{ type: 'x', count: 1 }],
  });
  const receipt1 = createReceipt({ manifest, output_summary: { count: 5 } });
  const receipt2 = createReceipt({ manifest, output_summary: { count: 5 } });
  const result = verifyReplayConsistency(receipt1, receipt2);
  assert.equal(result.consistent, true);
});
