import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  deriveDomain3PopulationCandidates,
  normalizeEntityKey,
} from '../src/services/domain3PopulationDetectorService.js';
import { executeDomain3FullReplay } from '../src/services/domain3PopulationReplayService.js';

// Contract tests for the 2026-11-07 population-rule corrections
// (RULE-AUDIT-2026-11-07 findings P1-P5). Each test names the audit
// finding it closes.

function event({ offset, category, city, entity, stream = 'cfpb_complaints', jurisdiction = 'WA', year = 2025 }) {
  return {
    stream_id: stream,
    offset,
    timestamp: `${year}-01-01T00:00:00.000Z`,
    ingested_at: `${year}-01-02T00:00:00.000Z`,
    signal_type: category,
    spacetime: { jurisdiction, city },
    payload: { category, company: entity, external_id: `${stream}-${offset}` },
    event_identity_hash: String(offset).padStart(64, '0').slice(-64),
    jurisdiction_id: jurisdiction,
  };
}

test('P1: a geography dominant everywhere does not fire (location quotient, not present-group mean)', () => {
  const rows = [];
  let offset = 1;
  // Two partitions; Seattle holds ~80% of geography-bearing events in BOTH.
  for (const [stream, jurisdiction] of [['cfpb_complaints', 'WA'], ['nyc_311', 'NY']]) {
    for (let i = 0; i < 40; i += 1) rows.push(event({ offset: offset++, category: `cat_${i % 6}`, city: 'Seattle', entity: `E${i % 9}`, stream, jurisdiction }));
    for (let i = 0; i < 10; i += 1) rows.push(event({ offset: offset++, category: `cat_${i % 6}`, city: `Town ${i}`, entity: `T${i}`, stream, jurisdiction }));
  }
  const candidates = deriveDomain3PopulationCandidates(rows);
  const seattle = candidates.filter((candidate) => candidate.signal_type === 'geographic_cluster' && candidate.title.includes('Seattle'));
  assert.equal(seattle.length, 0, 'Seattle is big everywhere, so it is not locally over-represented anywhere');
});

test('P3: declared normalization merges case and corporate-suffix variants into one grouping key', () => {
  assert.equal(normalizeEntityKey('TransUnion'), 'transunion');
  assert.equal(normalizeEntityKey('TRANSUNION'), 'transunion');
  assert.equal(normalizeEntityKey('Acme Corp'), 'acme');
  assert.equal(normalizeEntityKey('ACME CORP.'), 'acme');
  assert.equal(normalizeEntityKey('acme'), 'acme');

  const rows = [];
  let offset = 1;
  for (const variant of ['Acme Corp', 'ACME CORP.', 'acme']) {
    for (let i = 0; i < 6; i += 1) rows.push(event({ offset: offset++, category: `cat_${i % 3}`, city: 'Seattle', entity: variant }));
  }
  for (let i = 0; i < 22; i += 1) rows.push(event({ offset: offset++, category: `other_${i % 4}`, city: `City ${i % 5}`, entity: `Other ${i}` }));
  for (let e = 0; e < 40; e += 1) {
    for (let i = 0; i < 3; i += 1) rows.push(event({ offset: offset++, category: `beta_${e % 5}`, city: `BCity ${e % 7}`, entity: `Beta ${e}`, stream: 'nyc_311', jurisdiction: 'NY' }));
  }
  rows.push(event({ offset: offset++, category: 'cat_0', city: 'Seattle', entity: 'Acme', stream: 'nyc_311', jurisdiction: 'NY' }));
  rows.push(event({ offset: offset++, category: 'cat_1', city: 'Seattle', entity: 'ACME', stream: 'nyc_311', jurisdiction: 'NY' }));

  const candidates = deriveDomain3PopulationCandidates(rows);
  const repeat = candidates.find((candidate) => candidate.signal_type === 'repeat_entity' && candidate.supporting_statistics.entity_key === 'acme');
  assert.ok(repeat, 'expected the variants to merge into one repeat_entity candidate');
  assert.equal(repeat.supporting_statistics.pattern_count, 18);
});

test('P4: evidence refs are an evenly spaced sample spanning the full pattern, capped at 25', () => {
  const rows = [];
  let offset = 1;
  const groupOffsets = [];
  for (let i = 0; i < 100; i += 1) {
    groupOffsets.push(offset);
    rows.push(event({ offset: offset++, category: `cat_${i % 4}`, city: 'Seattle', entity: 'Sprawl Co' }));
  }
  for (let e = 0; e < 100; e += 1) {
    for (let i = 0; i < 3; i += 1) rows.push(event({ offset: offset++, category: `beta_${e % 5}`, city: `BCity ${e % 7}`, entity: `Beta ${e}`, stream: 'nyc_311', jurisdiction: 'NY' }));
  }
  const candidates = deriveDomain3PopulationCandidates(rows);
  const repeat = candidates.find((candidate) => candidate.signal_type === 'repeat_entity' && candidate.supporting_statistics.entity_key === 'sprawl');
  assert.ok(repeat, 'expected repeat_entity candidate for the 100-event pattern');
  assert.equal(repeat.supporting_statistics.pattern_count, 100);
  assert.equal(repeat.source_event_refs.length, 25);
  assert.equal(repeat.source_event_refs[0].offset, groupOffsets[0], 'first ref is the pattern start');
  assert.equal(repeat.source_event_refs[24].offset, groupOffsets[99], 'last ref is the pattern end');
  assert.equal(repeat.supporting_statistics.evidence_sampling, 'evenly_spaced_sample_over_stream_offset_order_including_first_and_last');
});

test('P2: entity-rule confidence is a declared factor score capped by the unresolved-resolution factor', () => {
  const rows = [];
  let offset = 1;
  for (let i = 0; i < 30; i += 1) rows.push(event({ offset: offset++, category: `cat_${i % 4}`, city: 'Seattle', entity: 'Cap Co' }));
  for (let i = 0; i < 30; i += 1) rows.push(event({ offset: offset++, category: `other_${i % 5}`, city: `City ${i % 6}`, entity: `Other ${i}` }));
  for (let e = 0; e < 80; e += 1) { for (let i = 0; i < 3; i += 1) rows.push(event({ offset: offset++, category: `beta_${e % 5}`, city: `BCity ${e % 7}`, entity: `Beta ${e}`, stream: 'nyc_311', jurisdiction: 'NY' })); }

  const candidates = deriveDomain3PopulationCandidates(rows);
  const repeat = candidates.find((candidate) => candidate.signal_type === 'repeat_entity' && candidate.supporting_statistics.entity_key === 'cap');
  assert.ok(repeat, 'expected repeat_entity candidate');
  const factors = repeat.supporting_statistics.confidence_factors;
  const resolution = factors.find((factor) => factor.factor_id === 'exact_entity_resolution');
  assert.ok(resolution, 'expected the exact_entity_resolution factor');
  assert.equal(resolution.satisfied, false);
  const expected = factors.reduce((sum, factor) => sum + (factor.satisfied ? factor.weight : 0), 0);
  assert.ok(Math.abs(repeat.confidence_score - expected) < 1e-9, 'score is exactly the satisfied factor weights');
  assert.ok(repeat.confidence_score <= 0.7);
  assert.notEqual(repeat.severity, 'critical');
});

test('P5: exactly one observation loader remains, and it is the replay canonical order', () => {
  const detector = readFileSync(new URL('../src/services/domain3PopulationDetectorService.js', import.meta.url), 'utf8');
  const replay = readFileSync(new URL('../src/services/domain3PopulationReplayService.js', import.meta.url), 'utf8');
  assert.doesNotMatch(detector, /executeDomain3PopulationDetection/);
  assert.doesNotMatch(detector, /loadCanonicalObservations/);
  assert.doesNotMatch(detector, /\.order\('ingested_at'/);
  assert.match(replay, /\.order\('stream_id', \{ ascending: true \}\)[\s\S]*\.order\('offset', \{ ascending: true \}\)/);
});

function fakeClient(rows, persisted) {
  return {
    from() {
      const query = {
        select() { return query; },
        not() { return query; },
        order() { return query; },
        async range(from, to) { return { data: rows.slice(from, to + 1), error: null }; },
      };
      return query;
    },
    async rpc(name, args) {
      if (name === 'register_domain3_population_rules_v1') return { data: { rules_registered: args.p_rules.length }, error: null };
      if (name === 'persist_domain3_population_run_v1') {
        persisted.push(...args.p_candidates);
        return { data: { status: 'completed', run_id: args.p_run_id, candidates_produced: args.p_candidates.length }, error: null };
      }
      if (name === 'reconcile_domain3_population_currentness_v1') return { data: { status: 'skipped' }, error: null };
      throw new Error(`unexpected rpc ${name}`);
    },
  };
}

test('P2+P3: cross-jurisdiction recurrence groups by normalized key and carries the capped factor score', async () => {
  const rows = [];
  let offset = 1;
  for (let i = 0; i < 6; i += 1) rows.push(event({ offset: offset++, category: 'filing', city: 'Seattle', entity: 'Globex Inc', jurisdiction: 'WA' }));
  for (let i = 0; i < 6; i += 1) rows.push(event({ offset: offset++, category: 'filing', city: 'Portland', entity: 'GLOBEX INC.', jurisdiction: 'OR' }));
  const persisted = [];
  const result = await executeDomain3FullReplay({ atlasClient: fakeClient(rows, persisted) });
  assert.equal(result.status, 'completed');
  const cross = persisted.find((candidate) => candidate.rule_id === 'atlas.domain3.cross_jurisdiction_recurrence');
  assert.ok(cross, 'expected a cross-jurisdiction candidate');
  assert.equal(cross.supporting_statistics.entity_key, 'globex');
  assert.equal(cross.supporting_statistics.jurisdiction_count, 2);
  assert.equal(cross.supporting_statistics.confidence_semantics, 'weighted_declared_factor_score_not_probability');
  assert.ok(cross.confidence_score <= 0.7);
  assert.notEqual(cross.severity, 'critical');
});
