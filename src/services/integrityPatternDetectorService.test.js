import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {
  INTEGRITY_PATTERN_INTERPRETATION_BOUNDARY,
  INTEGRITY_PATTERN_RULES,
  deriveIntegrityPatternCandidates,
  mapIntegrityPatternInput,
  summarizeIntegrityPatternReadiness,
} from './integrityPatternDetectorService.js';

function makeEvent({ offset, sourceId = 'governed_source', streamId = 'integrity_fixture', timestamp = '2025-01-01T00:00:00.000Z', observation }) {
  return {
    stream_id: streamId,
    offset,
    timestamp,
    ingested_at: timestamp,
    signal_type: observation.kind,
    source_id: sourceId,
    jurisdiction_id: 'WA',
    module_hint: 'integrity_fixture',
    spacetime: { jurisdiction: 'WA' },
    provenance: {
      source_system: sourceId,
      source_url: `https://example.test/${sourceId}/${offset}`,
    },
    payload: {
      external_id: `${sourceId}_${offset}`,
      integrity_observation: observation,
    },
    event_identity_hash: crypto.createHash('sha256').update(`${streamId}:${offset}`).digest('hex'),
  };
}

test('integrity rules are Domain 3 candidate rules with a non-accusatory boundary', () => {
  assert.equal(INTEGRITY_PATTERN_RULES.length, 6);
  assert.match(INTEGRITY_PATTERN_INTERPRETATION_BOUNDARY, /not proof of corruption/);
  for (const rule of INTEGRITY_PATTERN_RULES) {
    assert.match(rule.rule_id, /^atlas\.domain3\.integrity\./);
    assert.equal(rule.rule_contract.domain, 3);
    assert.match(rule.rule_contract.interpretation_boundary, /not proof/);
  }
});

test('source names alone never become canonical financial or legislative identities', () => {
  const observations = [
    {
      stream_id: 'open_secrets',
      offset: 1,
      timestamp: '2026-08-20T00:00:00.000Z',
      ingested_at: '2026-08-21T00:00:00.000Z',
      signal_type: 'lobbying_disclosure',
      source_id: 'senate_lda',
      jurisdiction_id: 'us_federal',
      module_hint: 'lobbying',
      payload: { amount: 30000, client_name: 'Named Client', registrant_name: 'Named Registrant', issues: 'VET' },
      provenance: { source_system: 'senate_lobbying_disclosure', source_url: 'https://example.test/filing/1' },
      event_identity_hash: crypto.createHash('sha256').update('lda:1').digest('hex'),
    },
    {
      stream_id: 'open_states',
      offset: 1,
      timestamp: '2026-01-12T00:00:00.000Z',
      ingested_at: '2026-08-21T00:00:00.000Z',
      signal_type: 'legislative_activity',
      source_id: 'open_states',
      jurisdiction_id: 'WA',
      module_hint: 'legislative',
      payload: { title: 'A bill', subjects: ['veterans'], latest_action_date: '2026-01-12' },
      provenance: { source_system: 'open_states', source_url: 'https://example.test/bill/1' },
      event_identity_hash: crypto.createHash('sha256').update('openstates:1').digest('hex'),
    },
  ];

  const mapped = mapIntegrityPatternInput(observations);
  assert.equal(mapped.transfers.length, 0);
  assert.equal(mapped.legislative_actions.length, 0);
  assert.deepEqual(deriveIntegrityPatternCandidates(observations), []);

  const readiness = summarizeIntegrityPatternReadiness(observations);
  assert.equal(readiness.automatic_integrity_pattern_detection_ready, false);
  assert.ok(readiness.blocking_gaps.includes('no_exact_payer_and_recipient_transfer_records'));
  assert.ok(readiness.blocking_gaps.includes('no_exact_legislative_actor_records_with_policy_tags'));
});

test('exact evidence-bound inputs derive each governed integrity pattern without creating a finding', () => {
  const events = [
    makeEvent({ offset: 1, observation: {
      kind: 'entity_registration',
      canonical_entity_id: 'entity-old',
      entity_name: 'Old Entity',
      status: 'dissolved',
      ended_at: '2025-01-01T00:00:00.000Z',
      exact_identifiers: { address: ['1 Main St'], phone: ['555-0100'] },
    } }),
    makeEvent({ offset: 2, timestamp: '2025-02-01T00:00:00.000Z', observation: {
      kind: 'entity_registration',
      canonical_entity_id: 'entity-new',
      entity_name: 'New Entity',
      status: 'active',
      formed_at: '2025-02-01T00:00:00.000Z',
      exact_identifiers: { address: ['1 Main St'], phone: ['555-0100'] },
    } }),
    makeEvent({ offset: 3, observation: {
      kind: 'entity_registration',
      canonical_entity_id: 'entity-donor',
      entity_name: 'Declared Donor',
      status: 'active',
      interest_tags: ['health'],
      exact_identifiers: { license: ['DONOR-1'] },
    } }),
    makeEvent({ offset: 4, timestamp: '2025-03-01T00:00:00.000Z', observation: {
      kind: 'financial_transfer',
      transfer_id: 'transfer-in',
      from_entity_id: 'entity-origin',
      to_entity_id: 'entity-middle',
      from_entity_name: 'Origin',
      to_entity_name: 'Middle',
      amount: 100,
      occurred_at: '2025-03-01T00:00:00.000Z',
      purpose_tags: ['general'],
    } }),
    makeEvent({ offset: 5, timestamp: '2025-03-10T00:00:00.000Z', observation: {
      kind: 'financial_transfer',
      transfer_id: 'transfer-out',
      from_entity_id: 'entity-middle',
      to_entity_id: 'entity-destination',
      from_entity_name: 'Middle',
      to_entity_name: 'Destination',
      amount: 90,
      occurred_at: '2025-03-10T00:00:00.000Z',
      purpose_tags: ['general'],
    } }),
    makeEvent({ offset: 6, timestamp: '2025-04-01T00:00:00.000Z', observation: {
      kind: 'financial_transfer',
      transfer_id: 'transfer-legislator',
      from_entity_id: 'entity-donor',
      to_entity_id: 'entity-legislator',
      from_entity_name: 'Declared Donor',
      to_entity_name: 'Exact Legislator',
      amount: 500,
      occurred_at: '2025-04-01T00:00:00.000Z',
      purpose_tags: ['health'],
    } }),
    makeEvent({ offset: 7, timestamp: '2025-05-01T00:00:00.000Z', sourceId: 'legislature', observation: {
      kind: 'legislative_action',
      action_id: 'action-1',
      actor_entity_id: 'entity-legislator',
      actor_name: 'Exact Legislator',
      occurred_at: '2025-05-01T00:00:00.000Z',
      policy_tags: ['health'],
    } }),
    makeEvent({ offset: 8, sourceId: 'registry-a', observation: {
      kind: 'source_assertion',
      assertion_id: 'assertion-a',
      subject_id: 'entity-subject',
      subject_name: 'Subject',
      predicate: 'registered_status',
      value: 'active',
    } }),
    makeEvent({ offset: 9, sourceId: 'registry-b', observation: {
      kind: 'source_assertion',
      assertion_id: 'assertion-b',
      subject_id: 'entity-subject',
      subject_name: 'Subject',
      predicate: 'registered_status',
      value: 'inactive',
    } }),
    makeEvent({ offset: 10, sourceId: 'bounded-metric', observation: {
      kind: 'numeric_observation',
      observation_id: 'numeric-1',
      subject_id: 'entity-subject',
      subject_name: 'Subject',
      metric: 'declared_total',
      actual: 12,
      expected_min: 0,
      expected_max: 10,
    } }),
  ];

  const first = deriveIntegrityPatternCandidates(events);
  const second = deriveIntegrityPatternCandidates(events);
  const types = new Set(first.map((candidate) => candidate.signal_type));

  assert.ok(types.has('phoenix_continuity_candidate'));
  assert.ok(types.has('exact_identifier_reuse_candidate'));
  assert.ok(types.has('financial_conduit_candidate'));
  assert.ok(types.has('legislative_financial_convergence_candidate'));
  assert.ok(types.has('source_contradiction_candidate'));
  assert.ok(types.has('numeric_range_anomaly_candidate'));
  assert.deepEqual(first, second);

  for (const item of first) {
    assert.equal(item.verification_state, 'unverified');
    assert.equal(item.supporting_statistics.allegation_status, 'unproven_integrity_pattern_candidate');
    assert.equal(item.supporting_statistics.review_disposition, 'human_review_required');
    assert.ok(item.source_event_refs.length > 0);
    assert.ok(item.evidence_refs.every((ref) => /^[a-f0-9]{64}$/.test(ref.event_identity_hash)));
    assert.doesNotMatch(item.description, /is corrupt|committed corruption|illegal conduct/i);
  }
});
