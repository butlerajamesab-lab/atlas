import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deriveDomain3PopulationCandidates } from '../src/services/domain3PopulationDetectorService.js';
import { deriveCrossJurisdictionCandidates } from '../src/services/domain3PopulationReplayService.js';

// The candidate table's severity CHECK admits only
// 'critical' | 'high' | 'medium'. Three rule bands could emit
// 'low' (cross_category_entity and trend_anomaly since the
// 2026-11-07 rule corrections; cross_jurisdiction_recurrence
// since long before), and a single 'low' candidate poisons its
// rule's whole persist transaction — cross_category_entity
// produced no runs at all after the corrections deployed.
// Bands now floor at 'medium'.

function event({ offset, category, entity, jurisdiction = 'WA', year = 2025, stream = 'cfpb_complaints' }) {
  return {
    stream_id: stream,
    offset,
    timestamp: `${year}-01-01T00:00:00.000Z`,
    ingested_at: `${year}-01-02T00:00:00.000Z`,
    signal_type: category,
    spacetime: { jurisdiction, city: 'Seattle' },
    payload: { category, company: entity, external_id: `${stream}-${offset}` },
    event_identity_hash: String(offset).padStart(64, 'a').slice(-64),
    jurisdiction_id: jurisdiction,
  };
}

test('cross-category at minimum breadth (3 categories) floors at medium', () => {
  const rows = [];
  let offset = 1;
  for (const category of ['cat_a', 'cat_b', 'cat_c']) {
    for (let i = 0; i < 4; i += 1) rows.push(event({ offset: offset++, category, entity: 'Globex' }));
  }
  const candidates = deriveDomain3PopulationCandidates(rows)
    .filter((candidate) => candidate.signal_type === 'cross_category_entity');
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].severity, 'medium');
});

test('trend anomaly at +60 percent floors at medium', () => {
  const rows = [];
  let offset = 100;
  for (let i = 0; i < 20; i += 1) rows.push(event({ offset: offset++, category: 'cat_a', entity: `E${i}`, year: 2024 }));
  for (let i = 0; i < 32; i += 1) rows.push(event({ offset: offset++, category: 'cat_a', entity: `E${i}`, year: 2025 }));
  const candidates = deriveDomain3PopulationCandidates(rows)
    .filter((candidate) => candidate.signal_type === 'trend_anomaly');
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].severity, 'medium');
});

test('cross-jurisdiction recurrence across 2 jurisdictions floors at medium', () => {
  const rows = [];
  let offset = 200;
  for (let i = 0; i < 6; i += 1) rows.push(event({ offset: offset++, category: 'cat_a', entity: 'Globex', jurisdiction: 'WA' }));
  for (let i = 0; i < 6; i += 1) rows.push(event({ offset: offset++, category: 'cat_a', entity: 'Globex', jurisdiction: 'OR' }));
  const candidates = deriveCrossJurisdictionCandidates(rows);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].severity, 'medium');
});

test('no derivation file can emit a severity the candidate table rejects', () => {
  for (const path of ['../src/services/domain3PopulationDetectorService.js', '../src/services/domain3PopulationReplayService.js', '../src/services/integrityPatternDetectorService.js']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /severity[^\n]*'low'/, `${path} must not emit severity 'low'`);
  }
});
