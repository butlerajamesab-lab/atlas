import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveDomain3PopulationCandidates,
  categoryOf,
  geographyOf,
  entityOf,
} from '../src/services/domain3PopulationDetectorService.js';

function event({ offset, category, city, entity, year = 2025, stream = 'cfpb_complaints', jurisdiction = 'WA' }) {
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

test('field extraction preserves adapter observations without pretending they are signals', () => {
  const row = event({ offset: 1, category: 'debt_collection', city: 'Seattle', entity: 'Example Corp' });
  assert.equal(categoryOf(row), 'debt_collection');
  assert.equal(geographyOf(row), 'Seattle');
  assert.equal(entityOf(row), 'Example Corp');
});

test('repeat entity and cross-category candidates derive from a population, not one row', () => {
  const rows = [];
  let offset = 1;
  for (let i = 0; i < 40; i += 1) rows.push(event({ offset: offset++, category: `cat_${i % 4}`, city: `city_${i % 5}`, entity: 'Dominant Corp' }));
  for (let entityIndex = 0; entityIndex < 12; entityIndex += 1) {
    for (let i = 0; i < 2; i += 1) rows.push(event({ offset: offset++, category: `other_${entityIndex % 3}`, city: `city_${entityIndex % 5}`, entity: `Other ${entityIndex}` }));
  }

  const candidates = deriveDomain3PopulationCandidates(rows);
  const repeat = candidates.find((candidate) => candidate.signal_type === 'repeat_entity' && candidate.title.includes('Dominant Corp'));
  const cross = candidates.find((candidate) => candidate.signal_type === 'cross_category_entity' && candidate.title.includes('Dominant Corp'));

  assert.ok(repeat, 'expected repeat_entity candidate');
  assert.ok(cross, 'expected cross_category_entity candidate');
  assert.equal(repeat.verification_state, 'unverified');
  assert.equal(repeat.entity_resolution_status, 'unresolved_exact_match_required');
  assert.ok(repeat.supporting_statistics.pattern_count > 1);
  assert.ok(Array.isArray(repeat.source_event_refs));
  assert.ok(repeat.source_event_refs.length <= 25);
});

test('frequency and geographic candidates use statistical population baselines', () => {
  const rows = [];
  let offset = 1;
  for (let i = 0; i < 40; i += 1) rows.push(event({ offset: offset++, category: 'dominant_category', city: 'Seattle', entity: `Entity ${i % 8}` }));
  for (let i = 0; i < 8; i += 1) rows.push(event({ offset: offset++, category: `category_${i}`, city: `City ${i}`, entity: `Other ${i}` }));

  const candidates = deriveDomain3PopulationCandidates(rows);
  const frequency = candidates.find((candidate) => candidate.signal_type === 'frequency_spike' && candidate.title.includes('dominant_category'));
  const geography = candidates.find((candidate) => candidate.signal_type === 'geographic_cluster' && candidate.title.includes('Seattle'));

  assert.ok(frequency, 'expected frequency_spike candidate');
  assert.ok(geography, 'expected geographic_cluster candidate');
  assert.ok(frequency.supporting_statistics.z_score >= 1.5);
  assert.ok(geography.supporting_statistics.z_score >= 1.5);
});

test('trend anomaly compares adjacent years and preserves direction', () => {
  const rows = [];
  let offset = 1;
  for (let i = 0; i < 20; i += 1) rows.push(event({ offset: offset++, category: 'complaint', city: 'Seattle', entity: `A${i % 4}`, year: 2024 }));
  for (let i = 0; i < 50; i += 1) rows.push(event({ offset: offset++, category: 'complaint', city: 'Seattle', entity: `A${i % 4}`, year: 2025 }));

  const candidates = deriveDomain3PopulationCandidates(rows);
  const trend = candidates.find((candidate) => candidate.signal_type === 'trend_anomaly');
  assert.ok(trend, 'expected trend_anomaly candidate');
  assert.equal(trend.supporting_statistics.prior_count, 20);
  assert.equal(trend.supporting_statistics.current_count, 50);
  assert.equal(trend.supporting_statistics.percent_change, 150);
});

test('derivation is deterministic for the same canonical observations', () => {
  const rows = [];
  let offset = 1;
  for (let i = 0; i < 30; i += 1) rows.push(event({ offset: offset++, category: 'a', city: 'Seattle', entity: 'Same Corp' }));
  for (let i = 0; i < 10; i += 1) rows.push(event({ offset: offset++, category: `b${i % 3}`, city: `City${i % 4}`, entity: `Other${i}` }));

  const first = deriveDomain3PopulationCandidates(rows).map((candidate) => candidate.candidate_hash);
  const second = deriveDomain3PopulationCandidates(rows).map((candidate) => candidate.candidate_hash);
  assert.deepEqual(first, second);
});
