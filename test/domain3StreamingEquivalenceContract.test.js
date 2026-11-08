import assert from 'node:assert/strict';
import test from 'node:test';
import {
  accumulatePopulationEvent,
  createPopulationAccumulator,
  deriveDomain3PopulationCandidates,
  finalizePopulationCandidates,
} from '../src/services/domain3PopulationDetectorService.js';
import {
  accumulateIntegrityEvent,
  createIntegrityAccumulator,
  deriveIntegrityPatternCandidates,
  deriveIntegrityPatternCandidatesFromInput,
  summarizeIntegrityPatternReadiness,
  summarizeIntegrityPatternReadinessFromInput,
} from '../src/services/integrityPatternDetectorService.js';
import {
  deriveCrossJurisdictionCandidates,
  finalizeCrossJurisdictionCandidates,
} from '../src/services/domain3PopulationReplayService.js';

// The streaming accumulators must reproduce the array detectors exactly:
// same inputs, same candidates (population detected_at is wall-clock and
// is the only field allowed to differ).

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]),
  );
}

function comparable(candidates) {
  return JSON.stringify(canonical(candidates.map((candidate) => {
    const copy = { ...candidate };
    delete copy.detected_at;
    return copy;
  })));
}

let hashCounter = 0;
function nextHash() {
  hashCounter += 1;
  return String(hashCounter).padStart(64, '0').slice(-64);
}

function makeEvent({
  stream = 'cfpb_complaints',
  offset,
  timestamp = '2025-03-01T00:00:00.000Z',
  category = null,
  entity = null,
  city = null,
  jurisdiction = 'WA',
  payload = {},
  spacetime = {},
  signalType = 'complaint',
}) {
  return {
    stream_id: stream,
    offset,
    timestamp,
    ingested_at: '2025-03-02T00:00:00.000Z',
    signal_type: signalType,
    spacetime: { jurisdiction, ...(city ? { city } : {}), ...spacetime },
    provenance: { channel: 'test', source_system: stream },
    payload: {
      ...(category ? { category } : {}),
      ...(entity ? { company: entity } : {}),
      ...payload,
    },
    source_id: stream,
    jurisdiction_id: jurisdiction,
    module_hint: 'test',
    event_identity_hash: nextHash(),
  };
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildFixtureEvents() {
  const events = [];
  let offset = 0;
  const push = (spec) => { offset += 1; events.push(makeEvent({ offset, ...spec })); };

  // Partition A: dominant entity + concentrated category + one city.
  for (let i = 0; i < 40; i += 1) push({ category: `cat_${i % 4}`, entity: 'Dominant Corp', city: 'Seattle' });
  for (let e = 0; e < 12; e += 1) {
    for (let i = 0; i < 2; i += 1) push({ category: `other_${e % 3}`, entity: `Other ${e}`, city: `City ${e % 4}` });
  }
  // Diluting partition B so location quotients are meaningful.
  for (let e = 0; e < 66; e += 1) {
    for (let i = 0; i < 3; i += 1) push({ stream: 'nyc_311', jurisdiction: 'NY', category: `beta_${e % 5}`, entity: `Beta ${e}`, city: `Beta City ${e % 7}` });
  }
  for (let i = 0; i < 2; i += 1) push({ stream: 'nyc_311', jurisdiction: 'NY', category: 'cat_0', entity: 'Dominant Corp', city: 'Beta City 0' });
  // Cross-jurisdiction entity: Dominant Corp also appears in OR.
  for (let i = 0; i < 12; i += 1) push({ stream: 'or_doj', jurisdiction: 'OR', category: 'cat_1', entity: 'Dominant Corp', city: 'Salem' });
  // Trend pair in partition A: 2023 small, 2024 triple.
  for (let i = 0; i < 10; i += 1) push({ timestamp: '2023-05-01T00:00:00.000Z', category: 'trend_a', entity: `Trend ${i}`, city: 'Tacoma' });
  for (let i = 0; i < 30; i += 1) push({ timestamp: '2024-05-01T00:00:00.000Z', category: 'trend_b', entity: `Trend ${i}`, city: 'Tacoma' });
  // Unclassified / geography-free / entity-free noise.
  for (let i = 0; i < 15; i += 1) push({ stream: 'sec_edgar', jurisdiction: 'us_federal', signalType: 'filing' });
  // Display-name tie: two raw forms of one key, equal counts.
  for (let i = 0; i < 12; i += 1) push({ category: 'tie_cat', entity: 'Acme Inc', city: 'Spokane' });
  for (let i = 0; i < 12; i += 1) push({ category: 'tie_cat', entity: 'ACME INC', city: 'Spokane' });
  return events;
}

function buildRandomEvents() {
  const rand = mulberry32(42);
  const streams = ['cfpb_complaints', 'wa_ag', 'sec_edgar'];
  const categories = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'];
  const cities = ['Seattle', 'Tacoma', 'Spokane', 'Salem', 'Boise'];
  const jurisdictions = ['WA', 'OR', 'us_federal'];
  const entities = Array.from({ length: 30 }, (_, i) => `Entity ${i}${i % 5 === 0 ? ' LLC' : ''}`);
  const events = [];
  const offsets = new Map();
  for (let i = 0; i < 600; i += 1) {
    const stream = streams[Math.floor(rand() * streams.length)];
    const offset = (offsets.get(stream) || 0) + 1;
    offsets.set(stream, offset);
    const year = 2023 + Math.floor(rand() * 3);
    events.push(makeEvent({
      stream,
      offset,
      timestamp: `${year}-0${1 + Math.floor(rand() * 9)}-15T00:00:00.000Z`,
      category: rand() < 0.85 ? categories[Math.floor(rand() * categories.length)] : null,
      entity: rand() < 0.8 ? entities[Math.floor(rand() * entities.length)] : null,
      city: rand() < 0.85 ? cities[Math.floor(rand() * cities.length)] : null,
      jurisdiction: jurisdictions[Math.floor(rand() * jurisdictions.length)],
    }));
  }
  return events.sort((a, b) => String(a.stream_id).localeCompare(String(b.stream_id)) || a.offset - b.offset);
}

function assertPopulationEquivalence(events, label) {
  const acc = createPopulationAccumulator();
  for (const event of events) accumulatePopulationEvent(acc, event);
  assert.equal(
    comparable(finalizePopulationCandidates(acc)),
    comparable(deriveDomain3PopulationCandidates(events)),
    `${label}: population candidates differ`,
  );
  assert.equal(
    comparable(finalizeCrossJurisdictionCandidates(acc)),
    comparable(deriveCrossJurisdictionCandidates(events)),
    `${label}: cross-jurisdiction candidates differ`,
  );
}

test('streaming population derivation equals array derivation on fixtures', () => {
  assertPopulationEquivalence(buildFixtureEvents(), 'fixtures');
});

test('streaming population derivation equals array derivation on seeded random events', () => {
  assertPopulationEquivalence(buildRandomEvents(), 'random');
});

function declarationEvent({ offset, declared, stream = 'atlas_integrity_observations' }) {
  return {
    stream_id: stream,
    offset,
    timestamp: '2025-04-01T00:00:00.000Z',
    ingested_at: '2025-04-02T00:00:00.000Z',
    signal_type: 'declared_numeric_observation',
    spacetime: { jurisdiction: 'us_federal' },
    provenance: { channel: 'test', source_system: 'test_source' },
    // Production declaration events carry a source record key beside the
    // declared observation; evidence refs must keep it through the
    // accumulator's slimming (regression: the 2026-11-08 production
    // equivalence run diffed on exactly this field).
    payload: { integrity_observation: declared, external_id: `whd-case-${offset}`, raw: { id: `whd-case-${offset}` } },
    source_id: 'test_source',
    jurisdiction_id: 'us_federal',
    module_hint: 'integrity_observation',
    event_identity_hash: nextHash(),
  };
}

function buildIntegrityEvents() {
  const events = [];
  // Numeric: one in range, one out of range (year 3021).
  events.push(declarationEvent({
    offset: 1,
    declared: {
      kind: 'numeric_observation', observation_id: 'obs_ok', subject_canonical_entity_id: 'whd_case:1',
      subject_name: 'Ok Co', metric: 'findings_end_date', actual: 19000, expected_min: 12784, expected_max: 20000,
      observed_at: '2025-04-01T00:00:00.000Z',
    },
  }));
  events.push(declarationEvent({
    offset: 2,
    declared: {
      kind: 'numeric_observation', observation_id: 'obs_bad', subject_canonical_entity_id: 'whd_case:2',
      subject_name: 'Bad Date Co', metric: 'findings_end_date', actual: 383990, expected_min: 12784, expected_max: 20000,
      observed_at: '2025-04-01T00:00:00.000Z',
    },
  }));
  // Phoenix pair: ended entity and successor sharing two exact identifiers.
  events.push(declarationEvent({
    offset: 3,
    declared: {
      kind: 'entity', canonical_entity_id: 'ent_old', entity_name: 'Old Corp', status: 'dissolved',
      formed_at: '2015-01-01T00:00:00.000Z', ended_at: '2023-01-01T00:00:00.000Z',
      exact_identifiers: { license: ['LIC-1'], address: ['1 Main St'] },
    },
  }));
  events.push(declarationEvent({
    offset: 4,
    declared: {
      kind: 'entity', canonical_entity_id: 'ent_new', entity_name: 'New Corp', status: 'active',
      formed_at: '2023-06-01T00:00:00.000Z',
      exact_identifiers: { license: ['LIC-1'], address: ['1 Main St'] },
    },
  }));
  // Conduit: A -> M -> B, 95% within 10 days.
  events.push(declarationEvent({
    offset: 5,
    declared: {
      kind: 'financial_transfer', transfer_id: 't1', from_canonical_entity_id: 'ent_a',
      to_canonical_entity_id: 'ent_m', amount: 1000, occurred_at: '2025-01-01T00:00:00.000Z',
    },
  }));
  events.push(declarationEvent({
    offset: 6,
    declared: {
      kind: 'financial_transfer', transfer_id: 't2', from_canonical_entity_id: 'ent_m',
      to_canonical_entity_id: 'ent_b', amount: 950, occurred_at: '2025-01-10T00:00:00.000Z',
    },
  }));
  // Assertions: same subject + predicate, two values, two sources.
  events.push(declarationEvent({
    offset: 7,
    stream: 'source_one',
    declared: {
      kind: 'assertion', assertion_id: 'a1', subject_canonical_entity_id: 'ent_x',
      predicate: 'status', value: 'active', effective_at: '2025-01-01T00:00:00.000Z',
    },
  }));
  const second = declarationEvent({
    offset: 8,
    stream: 'source_two',
    declared: {
      kind: 'assertion', assertion_id: 'a2', subject_canonical_entity_id: 'ent_x',
      predicate: 'status', value: 'revoked', effective_at: '2025-02-01T00:00:00.000Z',
    },
  });
  second.source_id = 'other_source';
  events.push(second);
  // Legislative convergence: entity with interest tag, transfer to actor, action with same tag.
  events.push(declarationEvent({
    offset: 9,
    declared: {
      kind: 'entity', canonical_entity_id: 'ent_donor', entity_name: 'Donor LLC', status: 'active',
      interest_tags: ['housing'],
      exact_identifiers: { license: ['LIC-9'] },
    },
  }));
  events.push(declarationEvent({
    offset: 10,
    declared: {
      kind: 'financial_transfer', transfer_id: 't3', from_canonical_entity_id: 'ent_donor',
      to_canonical_entity_id: 'ent_actor', amount: 500, occurred_at: '2025-02-01T00:00:00.000Z',
    },
  }));
  events.push(declarationEvent({
    offset: 11,
    declared: {
      kind: 'legislative_action', action_id: 'act1', actor_canonical_entity_id: 'ent_actor',
      actor_name: 'Senator Example', policy_tags: ['housing'], occurred_at: '2025-03-01T00:00:00.000Z',
    },
  }));
  // Noise events that map to nothing.
  events.push(makeEvent({ stream: 'cfpb_complaints', offset: 900, category: 'noise', entity: 'Noise Co' }));
  return events;
}

test('streaming integrity derivation equals array derivation on declared fixtures', () => {
  const events = buildIntegrityEvents();
  const acc = createIntegrityAccumulator();
  for (const event of events) accumulateIntegrityEvent(acc, event);
  const streamed = deriveIntegrityPatternCandidatesFromInput(acc.input);
  const array = deriveIntegrityPatternCandidates(events);
  assert.ok(array.length >= 4, `expected several integrity candidates, got ${array.length}`);
  // Integrity candidates are fully data-derived (detected_at comes from
  // the evidence freshness), so the comparison is exact, nothing stripped.
  assert.equal(JSON.stringify(canonical(streamed)), JSON.stringify(canonical(array)));
  assert.equal(
    JSON.stringify(canonical(summarizeIntegrityPatternReadinessFromInput(acc.input, acc.scanned))),
    JSON.stringify(canonical(summarizeIntegrityPatternReadiness(events))),
  );
});
