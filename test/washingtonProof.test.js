import assert from 'node:assert/strict';
import test from 'node:test';

import { loadWashingtonGeography, listAvailableJurisdictions } from '../src/substrate/geographyLoader.js';
import { normalizeGeography, computeRegistryHash, buildAdjacencyMap } from '../src/substrate/geography.js';
import { createTemporalWindow, filterByAsOf } from '../src/substrate/temporal.js';
import { computeEventFingerprint, deduplicateByFingerprint } from '../src/substrate/fingerprint.js';
import { createConvergenceRule, computeConvergence } from '../src/substrate/convergence.js';
import { computeEntityRelationships } from '../src/substrate/relationships.js';
import { createInputManifest, createReceipt, verifyReceipt } from '../src/substrate/manifest.js';
import { createReplayContext, executeReplay } from '../src/substrate/replay.js';

// ═══════════════════════════════════════════════════════════════
// PHASE C: BOUNDED WASHINGTON PROOF
// ═══════════════════════════════════════════════════════════════

test('Washington geography loads with 40 records (1 state + 39 counties)', () => {
  const registry = loadWashingtonGeography();
  assert.equal(registry.status, 'valid');
  assert.equal(registry.record_count, 40);
  assert.equal(registry.jurisdiction, 'us_wa');
  assert.equal(registry.source_id, 'census_tiger_2024');
  assert.ok(registry.hash);
});

test('Washington geography has no negative, zero, or missing areas', () => {
  const registry = loadWashingtonGeography();
  for (const record of registry.records) {
    assert.ok(record.area_sq_km > 0, `${record.name} has invalid area: ${record.area_sq_km}`);
    assert.ok(record.centroid_lat !== null, `${record.name} missing centroid_lat`);
    assert.ok(record.centroid_lon !== null, `${record.name} missing centroid_lon`);
  }
});

test('Washington geography has no duplicate jurisdiction_ids', () => {
  const registry = loadWashingtonGeography();
  const ids = registry.records.map((r) => r.jurisdiction_id);
  assert.equal(ids.length, new Set(ids).size);
});

test('Washington geography has no duplicate source_record_ids', () => {
  const registry = loadWashingtonGeography();
  const ids = registry.records.map((r) => r.source_record_id);
  assert.equal(ids.length, new Set(ids).size);
});

test('Washington geography has valid FIPS codes', () => {
  const registry = loadWashingtonGeography();
  const state = registry.records.find((r) => r.level === 'state');
  assert.equal(state.fips_code, '53');
  const counties = registry.records.filter((r) => r.level === 'county');
  assert.equal(counties.length, 39);
  for (const county of counties) {
    assert.ok(/^53\d{3}$/.test(county.fips_code), `Invalid FIPS: ${county.fips_code}`);
  }
});

test('Washington geography has complete source identity', () => {
  const registry = loadWashingtonGeography();
  for (const record of registry.records) {
    assert.ok(record.source_id, `${record.name} missing source_id`);
    assert.ok(record.source_record_id, `${record.name} missing source_record_id`);
    assert.ok(record.effective_from, `${record.name} missing effective_from`);
  }
});

test('Washington geography adjacency is symmetric', () => {
  const registry = loadWashingtonGeography();
  const adj = registry.adjacency;
  for (const [id, neighbors] of Object.entries(adj)) {
    for (const neighbor of neighbors) {
      const neighborAdj = adj[neighbor] || [];
      assert.ok(
        neighborAdj.includes(id),
        `Adjacency not symmetric: ${id} -> ${neighbor} but not reverse`,
      );
    }
  }
});

test('Washington geography registry hash is deterministic', () => {
  const registry1 = loadWashingtonGeography();
  const registry2 = loadWashingtonGeography();
  assert.equal(registry1.hash, registry2.hash);
});

test('normalizeGeography resolves Washington counties', () => {
  const registry = loadWashingtonGeography();
  assert.equal(normalizeGeography('King County', registry.records), 'us_wa_king');
  assert.equal(normalizeGeography('us_wa_pierce', registry.records), 'us_wa_pierce');
  assert.equal(normalizeGeography('53033', registry.records), 'us_wa_king');
  assert.equal(normalizeGeography('Oregon', registry.records), null);
});

test('listAvailableJurisdictions includes Washington', () => {
  const list = listAvailableJurisdictions();
  assert.ok(list.length >= 1);
  assert.ok(list.some((j) => j.jurisdiction_id === 'us_wa'));
});

// ═══════════════════════════════════════════════════════════════
// BOUNDED END-TO-END PROOF: Run synthetic Washington signals
// through the complete substrate path
// ═══════════════════════════════════════════════════════════════

test('End-to-end bounded proof: Washington signals through complete path', async () => {
  // 1. Load geography
  const geography = loadWashingtonGeography();
  assert.equal(geography.status, 'valid');

  // 2. Create temporal window
  const window = createTemporalWindow(
    '2026-01-01T00:00:00Z',
    '2026-07-31T23:59:59Z',
    '2026-08-01T00:00:00Z',
  );

  // 3. Simulate signal events (as if from real Atlas signal_events)
  const signals = [
    { stream_id: 'propublica_complaints', signal_type: 'cfpb_complaint', source_record_key: 'rec_001', entity_ids: ['entity_bank_a'], jurisdiction_id: 'us_wa_king', timestamp: '2026-02-15T10:00:00Z', payload: { product: 'mortgage', issue: 'closing' } },
    { stream_id: 'propublica_complaints', signal_type: 'cfpb_complaint', source_record_key: 'rec_002', entity_ids: ['entity_bank_a'], jurisdiction_id: 'us_wa_king', timestamp: '2026-02-20T14:00:00Z', payload: { product: 'mortgage', issue: 'servicing' } },
    { stream_id: 'propublica_complaints', signal_type: 'cfpb_complaint', source_record_key: 'rec_003', entity_ids: ['entity_bank_a', 'entity_bank_b'], jurisdiction_id: 'us_wa_pierce', timestamp: '2026-03-01T09:00:00Z', payload: { product: 'credit_card', issue: 'billing' } },
    { stream_id: 'propublica_complaints', signal_type: 'cfpb_complaint', source_record_key: 'rec_004', entity_ids: ['entity_bank_b'], jurisdiction_id: 'us_wa_pierce', timestamp: '2026-03-10T11:00:00Z', payload: { product: 'mortgage', issue: 'closing' } },
    { stream_id: 'propublica_complaints', signal_type: 'cfpb_complaint', source_record_key: 'rec_005', entity_ids: ['entity_bank_a'], jurisdiction_id: 'us_wa_snohomish', timestamp: '2026-04-01T08:00:00Z', payload: { product: 'mortgage', issue: 'closing' } },
    { stream_id: 'propublica_complaints', signal_type: 'cfpb_complaint', source_record_key: 'rec_001', entity_ids: ['entity_bank_a'], jurisdiction_id: 'us_wa_king', timestamp: '2026-02-15T10:00:00Z', payload: { product: 'mortgage', issue: 'closing' } }, // DUPLICATE
  ];

  // 4. Compute fingerprints
  const withFingerprints = signals.map((s) => ({
    ...s,
    fingerprint: computeEventFingerprint(s),
  }));

  // 5. Deduplicate
  const deduped = deduplicateByFingerprint(withFingerprints, (s) => s.fingerprint);
  assert.equal(deduped.unique_count, 5);
  assert.equal(deduped.duplicate_count, 1);

  // 6. Normalize geography
  const uniqueSignals = deduped.unique;
  for (const signal of uniqueSignals) {
    const normalized = normalizeGeography(signal.jurisdiction_id, geography.records);
    assert.ok(normalized, `Failed to normalize: ${signal.jurisdiction_id}`);
  }

  // 7. Filter by temporal window
  const temporallyBounded = uniqueSignals.filter((s) => {
    const ts = new Date(s.timestamp).getTime();
    return ts >= new Date(window.from).getTime() && ts <= new Date(window.to).getTime();
  });
  assert.equal(temporallyBounded.length, 5);

  // 8. Compute convergence
  const rule = createConvergenceRule({
    rule_id: 'wa_entity_jurisdiction_convergence',
    signal_types: ['cfpb_complaint'],
    group_dimensions: ['jurisdiction_id'],
    min_signals: 2,
    kernel: 'count',
  });

  const convergence = computeConvergence({
    signals: temporallyBounded,
    rule,
    asOf: '2026-08-01T00:00:00Z',
    window,
    adjacencyMap: geography.adjacency,
    geographyVersion: geography.hash,
  });

  assert.equal(convergence.status, 'completed');
  assert.ok(convergence.observations.length >= 1); // King County has 2+ signals
  assert.ok(convergence.receipt);
  assert.ok(convergence.receipt.manifest_hash);

  // 9. Compute entity relationships
  const entityIds = [...new Set(temporallyBounded.flatMap((s) => s.entity_ids))];
  const relationships = computeEntityRelationships(entityIds, temporallyBounded);
  assert.ok(relationships.relationships_with_evidence >= 1); // bank_a and bank_b co-occur

  // 10. Create immutable receipt
  const manifest = createInputManifest({
    computation_type: 'bounded_washington_proof',
    engine_id: 'atlas.substrate',
    engine_version: '1.0.0',
    as_of: '2026-08-01T00:00:00Z',
    temporal_window: window,
    geography_version: geography.hash,
    input_sources: [
      { type: 'signal_events', count: temporallyBounded.length },
      { type: 'geography_registry', jurisdiction: 'us_wa', hash: geography.hash },
    ],
    parameters: {
      convergence_rule: rule.rule_id,
      deduplication: { total: signals.length, unique: deduped.unique_count },
    },
  });

  const receipt = createReceipt({
    manifest,
    output_summary: {
      convergence_observations: convergence.observations.length,
      relationships: relationships.relationships_with_evidence,
      entity_count: entityIds.length,
      jurisdiction_count: [...new Set(temporallyBounded.map((s) => s.jurisdiction_id))].length,
    },
  });

  assert.ok(receipt.receipt_identity);
  const verification = verifyReceipt(receipt);
  assert.equal(verification.valid, true);

  // 11. Replay and verify determinism
  const replayCtx = createReplayContext({
    as_of: '2026-08-01T00:00:00Z',
    signals: temporallyBounded.map((s) => ({ ...s, ingested_at: s.timestamp })),
    rules: [rule],
    geography_version: geography.hash,
    timestamp_field: 'ingested_at',
  });

  const replayResult = await executeReplay({
    replayContext: replayCtx,
    computeFn: (sigs, rules) => {
      const conv = computeConvergence({
        signals: sigs,
        rule: rules[0],
        asOf: '2026-08-01T00:00:00Z',
        geographyVersion: geography.hash,
      });
      return { observations: conv.observations.length };
    },
    computation_type: 'convergence',
    engine_id: 'atlas.substrate',
    engine_version: '1.0.0',
  });

  assert.equal(replayResult.status, 'completed');
  assert.equal(replayResult.result.observations, convergence.observations.length);
  assert.ok(replayResult.receipt.receipt_identity);
});
