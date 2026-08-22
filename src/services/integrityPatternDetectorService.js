import crypto from 'crypto';

const ENGINE_ID = 'atlas.domain3_integrity_exact';
const ENGINE_VERSION = '1.0.0';
const DAY_MS = 86_400_000;
const SOURCE_REF_LIMIT = 25;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._/-]{2,255}$/;

const INTERPRETATION_BOUNDARY =
  'evidence-bound integrity pattern candidate; not proof of corruption, unlawful conduct, motive, causation, or liability';

const RULES = Object.freeze([
  {
    rule_id: 'atlas.domain3.integrity.phoenix_continuity',
    rule_version: '1.0.0',
    signal_type: 'phoenix_continuity_candidate',
    engine_id: ENGINE_ID,
    engine_version: ENGINE_VERSION,
    rule_contract: {
      domain: 3,
      detector: 'phoenix_continuity',
      minimum_shared_exact_identifiers: 2,
      maximum_successor_gap_days: 730,
      identity_policy: 'source-declared canonical entity IDs and exact identifiers only; no fuzzy name matching',
      interpretation_boundary: INTERPRETATION_BOUNDARY,
    },
  },
  {
    rule_id: 'atlas.domain3.integrity.exact_identifier_reuse',
    rule_version: '1.0.0',
    signal_type: 'exact_identifier_reuse_candidate',
    engine_id: ENGINE_ID,
    engine_version: ENGINE_VERSION,
    rule_contract: {
      domain: 3,
      detector: 'exact_identifier_reuse',
      allowed_identifier_types: ['address', 'phone', 'license', 'agent', 'operator', 'facility', 'activity'],
      minimum_distinct_canonical_entities: 2,
      identity_policy: 'exact normalized values only; no fuzzy name matching',
      interpretation_boundary: INTERPRETATION_BOUNDARY,
    },
  },
  {
    rule_id: 'atlas.domain3.integrity.financial_conduit',
    rule_version: '1.0.0',
    signal_type: 'financial_conduit_candidate',
    engine_id: ENGINE_ID,
    engine_version: ENGINE_VERSION,
    rule_contract: {
      domain: 3,
      detector: 'bounded_pass_through',
      minimum_outgoing_to_incoming_ratio: 0.8,
      maximum_outgoing_to_incoming_ratio: 1.05,
      maximum_gap_days: 30,
      identity_policy: 'exact canonical payer, intermediary, and recipient IDs required',
      review_family: 'beneficial_funder_and_disclosure_review',
      interpretation_boundary: INTERPRETATION_BOUNDARY,
    },
  },
  {
    rule_id: 'atlas.domain3.integrity.legislative_financial_convergence',
    rule_version: '1.0.0',
    signal_type: 'legislative_financial_convergence_candidate',
    engine_id: ENGINE_ID,
    engine_version: ENGINE_VERSION,
    rule_contract: {
      domain: 3,
      detector: 'legislative_financial_convergence',
      maximum_gap_days: 365,
      identity_policy: 'transfer recipient must exactly equal the canonical legislative actor ID',
      topic_policy: 'source-declared policy tags only; no free-text intent inference',
      interpretation_boundary: INTERPRETATION_BOUNDARY,
    },
  },
  {
    rule_id: 'atlas.domain3.integrity.source_contradiction',
    rule_version: '1.0.0',
    signal_type: 'source_contradiction_candidate',
    engine_id: ENGINE_ID,
    engine_version: ENGINE_VERSION,
    rule_contract: {
      domain: 3,
      detector: 'source_contradiction',
      minimum_distinct_values: 2,
      minimum_distinct_source_ids: 2,
      identity_policy: 'same exact canonical subject ID and normalized predicate required',
      resolution_policy: 'detector preserves all values and never selects a true value',
      interpretation_boundary: INTERPRETATION_BOUNDARY,
    },
  },
  {
    rule_id: 'atlas.domain3.integrity.numeric_range_anomaly',
    rule_version: '1.0.0',
    signal_type: 'numeric_range_anomaly_candidate',
    engine_id: ENGINE_ID,
    engine_version: ENGINE_VERSION,
    rule_contract: {
      domain: 3,
      detector: 'declared_numeric_range',
      baseline_policy: 'expected bounds must be supplied explicitly by a governed source adapter',
      identity_policy: 'exact canonical subject ID required',
      interpretation_boundary: INTERPRETATION_BOUNDARY,
    },
  },
]);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stableValue(nested)]),
  );
}

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim().replace(/\s+/g, ' ');
  return normalized.length ? normalized : null;
}

function normalizedComparable(value) {
  const text = normalizeText(value);
  return text ? text.toLocaleLowerCase('en-US') : null;
}

function stableId(value) {
  const text = normalizeText(value);
  return text && STABLE_ID_PATTERN.test(text) ? text : null;
}

function timestampMs(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : null;
}

function finiteNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringList(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map(normalizedComparable).filter(Boolean))].sort();
  }
  const text = normalizeText(value);
  if (!text) return [];
  return [...new Set(text.split(/[,;|]/).map(normalizedComparable).filter(Boolean))].sort();
}

function payloadOf(event) {
  return event?.payload && typeof event.payload === 'object' ? event.payload : {};
}

function rawOf(event) {
  const raw = payloadOf(event).raw;
  return raw && typeof raw === 'object' ? raw : {};
}

function declaredObservationOf(event) {
  const declared = payloadOf(event).integrity_observation;
  return declared && typeof declared === 'object' ? declared : {};
}

function provenanceOf(event) {
  return event?.provenance && typeof event.provenance === 'object' ? event.provenance : {};
}

function firstText(...values) {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) return text;
  }
  return null;
}

function firstStableId(...values) {
  for (const value of values) {
    const id = stableId(value);
    if (id) return id;
  }
  return null;
}

function observedAtOf(event, ...values) {
  return firstText(...values, event?.timestamp, event?.ingested_at);
}

function jurisdictionOf(event, declared = {}) {
  const spacetime = event?.spacetime && typeof event.spacetime === 'object' ? event.spacetime : {};
  return firstText(
    declared.jurisdiction_id,
    event?.jurisdiction_id,
    spacetime.jurisdiction,
    spacetime.region,
  ) || 'unknown';
}

function canonicalIdFrom(declared, payload, raw, ...keys) {
  for (const key of keys) {
    const id = firstStableId(declared?.[key], payload?.[key], raw?.[key]);
    if (id) return id;
  }
  return null;
}

function exactIdentifiersOf(declared, payload, raw) {
  const source = [declared.exact_identifiers, payload.exact_identifiers, raw.exact_identifiers]
    .find((value) => value && typeof value === 'object' && !Array.isArray(value));
  if (!source) return {};

  const identifiers = {};
  for (const [rawKind, rawValues] of Object.entries(source)) {
    const kind = normalizedComparable(rawKind);
    if (!kind) continue;
    const values = Array.isArray(rawValues) ? rawValues : [rawValues];
    const normalized = [...new Set(values.map(normalizedComparable).filter(Boolean))].sort();
    if (normalized.length) identifiers[kind] = normalized;
  }
  return identifiers;
}

function sourceRecordKeyOf(event) {
  const payload = payloadOf(event);
  const raw = rawOf(event);
  return firstText(
    payload.source_record_key,
    payload.external_id,
    payload.filing_id,
    payload.action_id,
    payload.observation_id,
    payload.assertion_id,
    payload.registration_number,
    raw.source_record_key,
    raw.external_id,
    raw.id,
    `${event.stream_id}:${event.offset}`,
  );
}

function sourceEventRef(event) {
  if (!event?.stream_id || !Number.isFinite(Number(event.offset)) || !SHA256_PATTERN.test(event.event_identity_hash || '')) {
    return null;
  }
  return {
    stream_id: String(event.stream_id),
    offset: Number(event.offset),
    event_identity_hash: String(event.event_identity_hash).toLowerCase(),
  };
}

function evidenceRef(event) {
  const sourceRef = sourceEventRef(event);
  if (!sourceRef) return null;
  const payload = payloadOf(event);
  const raw = rawOf(event);
  const provenance = provenanceOf(event);
  const sourceId = firstText(event.source_id, provenance.source_system, event.stream_id);
  if (!sourceId) return null;
  const result = {
    ...sourceRef,
    source_id: sourceId,
    source_class: firstText(event.module_hint, provenance.channel, event.signal_type, 'unknown'),
    source_record_key: sourceRecordKeyOf(event),
    source_uri: firstText(payload.source_url, raw.source_url, raw.openstates_url, provenance.source_url),
    pinpoint: firstText(payload.pinpoint, payload.locator, raw.pinpoint, raw.locator),
    quote_text: firstText(payload.quote_text, payload.excerpt, raw.quote_text, raw.excerpt),
    observed_at: observedAtOf(event),
  };
  return Object.fromEntries(Object.entries(result).filter(([, value]) => value !== null && value !== undefined));
}

function evidenceKey(ref) {
  return `${ref.stream_id}\u0000${ref.offset}\u0000${ref.event_identity_hash}`;
}

function uniqueEvents(events) {
  const byKey = new Map();
  for (const event of events.flat()) {
    const ref = sourceEventRef(event);
    if (!ref) continue;
    const key = evidenceKey(ref);
    if (!byKey.has(key)) byKey.set(key, event);
  }
  return [...byKey.values()].sort((left, right) =>
    String(left.stream_id).localeCompare(String(right.stream_id)) || Number(left.offset) - Number(right.offset));
}

function eventBundle(events) {
  const bounded = uniqueEvents(events).slice(0, SOURCE_REF_LIMIT);
  return {
    events: bounded,
    source_event_refs: bounded.map(sourceEventRef).filter(Boolean),
    evidence_refs: bounded.map(evidenceRef).filter(Boolean),
  };
}

function eventFreshness(events) {
  const latest = events.reduce((value, event) => {
    const parsed = timestampMs(event?.ingested_at || event?.timestamp);
    return parsed !== null && parsed > value ? parsed : value;
  }, 0);
  return latest > 0 ? new Date(latest).toISOString() : null;
}

function confidenceFrom(factors) {
  const total = factors.reduce((sum, factor) => sum + factor.weight, 0);
  if (total <= 0) return 0;
  const met = factors.reduce((sum, factor) => sum + (factor.satisfied ? factor.weight : 0), 0);
  return Number((met / total).toFixed(6));
}

function candidate({
  ruleId,
  signalType,
  title,
  description,
  events,
  subjectIds,
  jurisdiction,
  severity,
  factors,
  statistics,
  unresolvedFields,
  limitations,
}) {
  const bundle = eventBundle(events);
  if (!bundle.source_event_refs.length) return null;
  const sourceFreshnessAt = eventFreshness(bundle.events);
  if (!sourceFreshnessAt) return null;
  const entityIds = [...new Set(subjectIds.map(stableId).filter(Boolean))].sort();
  const sourceInputHash = stableHash({ rule_id: ruleId, source_event_refs: bundle.source_event_refs });
  const candidateHash = stableHash({
    rule_id: ruleId,
    rule_version: '1.0.0',
    subject_ids: entityIds,
    jurisdiction_id: jurisdiction || 'unknown',
    source_input_hash: sourceInputHash,
  });
  const sources = [...new Set(bundle.evidence_refs.map((ref) => ref.source_id))].sort();
  const sourceClasses = [...new Set(bundle.evidence_refs.map((ref) => ref.source_class))].sort();

  return {
    candidate_hash: candidateHash,
    rule_id: ruleId,
    rule_version: '1.0.0',
    engine_id: ENGINE_ID,
    engine_version: ENGINE_VERSION,
    signal_type: signalType,
    title,
    description,
    primary_stream_id: bundle.source_event_refs[0].stream_id,
    source_event_refs: bundle.source_event_refs,
    entity_ids: entityIds,
    entity_resolution_status: entityIds.length ? 'resolved_exact_source_ids' : 'not_applicable',
    jurisdiction_id: jurisdiction || 'unknown',
    severity,
    confidence_score: confidenceFrom(factors),
    verification_state: 'unverified',
    supporting_statistics: {
      ...statistics,
      confidence_factors: factors,
      source_ids: sources,
      source_classes: sourceClasses,
      independent_source_count: sources.length,
      source_class_count: sourceClasses.length,
      unresolved_fields: [...new Set(unresolvedFields)].sort(),
      limitations,
      review_disposition: 'human_review_required',
      allegation_status: 'unproven_integrity_pattern_candidate',
      interpretation_boundary: INTERPRETATION_BOUNDARY,
    },
    evidence_refs: bundle.evidence_refs,
    source_freshness_at: sourceFreshnessAt,
    detected_at: sourceFreshnessAt,
    source_input_hash: sourceInputHash,
  };
}

function mapEntity(event) {
  const payload = payloadOf(event);
  const raw = rawOf(event);
  const declared = declaredObservationOf(event);
  const kind = normalizedComparable(declared.kind);
  const isEntityKind = ['entity', 'entity_registration', 'license'].includes(kind)
    || ['entity_registration', 'license'].includes(normalizedComparable(event.signal_type));
  const entityId = canonicalIdFrom(declared, payload, raw, 'canonical_entity_id', 'entity_id');
  const exactIdentifiers = exactIdentifiersOf(declared, payload, raw);
  if (!entityId || (!isEntityKind && Object.keys(exactIdentifiers).length === 0)) return null;
  return {
    entity_id: entityId,
    label: firstText(declared.entity_name, payload.entity_name, payload.organization_name, payload.registrant_name, raw.name, entityId),
    status: firstText(declared.status, payload.status, raw.status),
    formed_at: observedAtOf(event, declared.formed_at, payload.formed_at, payload.registration_date, raw.formed_at),
    ended_at: firstText(declared.ended_at, payload.ended_at, payload.termination_date, raw.ended_at),
    jurisdiction_id: jurisdictionOf(event, declared),
    exact_identifiers: exactIdentifiers,
    interest_tags: stringList(declared.interest_tags ?? payload.interest_tags ?? raw.interest_tags),
    event,
  };
}

function mapTransfer(event) {
  const payload = payloadOf(event);
  const raw = rawOf(event);
  const declared = declaredObservationOf(event);
  const kind = normalizedComparable(declared.kind);
  const isTransferKind = ['financial_transfer', 'campaign_contribution', 'lobbying_disclosure'].includes(kind)
    || ['campaign_contribution', 'campaign_disbursement', 'lobbying_disclosure', 'financial_transfer'].includes(normalizedComparable(event.signal_type));
  if (!isTransferKind) return null;
  const fromEntityId = canonicalIdFrom(
    declared,
    payload,
    raw,
    'from_canonical_entity_id',
    'from_entity_id',
    'payer_entity_id',
    'donor_entity_id',
    'client_entity_id',
  );
  const toEntityId = canonicalIdFrom(
    declared,
    payload,
    raw,
    'to_canonical_entity_id',
    'to_entity_id',
    'recipient_entity_id',
    'candidate_entity_id',
    'registrant_entity_id',
  );
  const amount = finiteNumber(declared.amount ?? payload.amount ?? raw.amount);
  const occurredAt = observedAtOf(event, declared.occurred_at, payload.occurred_at, payload.filing_date, payload.date, raw.date);
  if (!fromEntityId || !toEntityId || amount === null || amount <= 0 || timestampMs(occurredAt) === null) return null;
  return {
    transfer_id: firstStableId(declared.transfer_id, payload.transfer_id, payload.external_id, payload.filing_id, `${event.stream_id}:${event.offset}`),
    from_entity_id: fromEntityId,
    to_entity_id: toEntityId,
    from_label: firstText(declared.from_entity_name, payload.from_entity_name, payload.donor_name, payload.client_name, fromEntityId),
    to_label: firstText(declared.to_entity_name, payload.to_entity_name, payload.recipient_name, payload.candidate_name, payload.registrant_name, toEntityId),
    amount,
    occurred_at: occurredAt,
    purpose_tags: stringList(declared.purpose_tags ?? declared.policy_tags ?? payload.purpose_tags ?? payload.issues ?? raw.purpose_tags),
    jurisdiction_id: jurisdictionOf(event, declared),
    event,
  };
}

function mapLegislativeAction(event) {
  const payload = payloadOf(event);
  const raw = rawOf(event);
  const declared = declaredObservationOf(event);
  const kind = normalizedComparable(declared.kind);
  const isLegislative = ['legislative_action', 'legislative_activity'].includes(kind)
    || ['legislative_action', 'legislative_activity'].includes(normalizedComparable(event.signal_type));
  if (!isLegislative) return null;
  const actorEntityId = canonicalIdFrom(declared, payload, raw, 'actor_canonical_entity_id', 'actor_entity_id', 'legislator_entity_id');
  const policyTags = stringList(declared.policy_tags ?? payload.policy_tags ?? payload.subjects ?? raw.subject);
  const occurredAt = observedAtOf(event, declared.occurred_at, payload.occurred_at, payload.latest_action_date, raw.latest_action_date);
  const actionId = firstStableId(declared.action_id, payload.action_id, payload.external_id, raw.id, `${event.stream_id}:${event.offset}`);
  if (!actorEntityId || !actionId || !policyTags.length || timestampMs(occurredAt) === null) return null;
  return {
    action_id: actionId,
    actor_entity_id: actorEntityId,
    actor_label: firstText(declared.actor_name, payload.actor_name, payload.legislator_name, actorEntityId),
    occurred_at: occurredAt,
    jurisdiction_id: jurisdictionOf(event, declared),
    policy_tags: policyTags,
    event,
  };
}

function mapAssertion(event) {
  const payload = payloadOf(event);
  const raw = rawOf(event);
  const declared = declaredObservationOf(event);
  const kind = normalizedComparable(declared.kind);
  if (!['assertion', 'source_assertion', 'enforcement_assertion'].includes(kind)) return null;
  const subjectId = canonicalIdFrom(declared, payload, raw, 'subject_canonical_entity_id', 'subject_id', 'entity_id');
  const predicate = normalizedComparable(declared.predicate ?? payload.predicate ?? raw.predicate);
  const value = normalizeText(declared.value ?? payload.value ?? raw.value);
  if (!subjectId || !predicate || !value) return null;
  return {
    assertion_id: firstStableId(declared.assertion_id, payload.assertion_id, payload.external_id, `${event.stream_id}:${event.offset}`),
    subject_id: subjectId,
    subject_label: firstText(declared.subject_name, payload.subject_name, subjectId),
    predicate,
    value,
    effective_at: observedAtOf(event, declared.effective_at, payload.effective_at),
    jurisdiction_id: jurisdictionOf(event, declared),
    source_id: firstText(event.source_id, provenanceOf(event).source_system, event.stream_id),
    event,
  };
}

function mapNumericObservation(event) {
  const payload = payloadOf(event);
  const raw = rawOf(event);
  const declared = declaredObservationOf(event);
  const kind = normalizedComparable(declared.kind);
  if (!['numeric_observation', 'declared_numeric_range'].includes(kind)) return null;
  const subjectId = canonicalIdFrom(declared, payload, raw, 'subject_canonical_entity_id', 'subject_id', 'entity_id');
  const metric = normalizedComparable(declared.metric ?? payload.metric ?? raw.metric);
  const actual = finiteNumber(declared.actual ?? payload.actual ?? raw.actual);
  const expectedMin = finiteNumber(declared.expected_min ?? payload.expected_min ?? raw.expected_min);
  const expectedMax = finiteNumber(declared.expected_max ?? payload.expected_max ?? raw.expected_max);
  if (!subjectId || !metric || actual === null || (expectedMin === null && expectedMax === null)) return null;
  return {
    observation_id: firstStableId(declared.observation_id, payload.observation_id, payload.external_id, `${event.stream_id}:${event.offset}`),
    subject_id: subjectId,
    subject_label: firstText(declared.subject_name, payload.subject_name, subjectId),
    metric,
    actual,
    expected_min: expectedMin,
    expected_max: expectedMax,
    observed_at: observedAtOf(event, declared.observed_at, payload.observed_at),
    jurisdiction_id: jurisdictionOf(event, declared),
    event,
  };
}

export function mapIntegrityPatternInput(events) {
  const canonical = (Array.isArray(events) ? events : []).filter((event) => sourceEventRef(event));
  return {
    entities: canonical.map(mapEntity).filter(Boolean),
    transfers: canonical.map(mapTransfer).filter(Boolean),
    legislative_actions: canonical.map(mapLegislativeAction).filter(Boolean),
    assertions: canonical.map(mapAssertion).filter(Boolean),
    numeric_observations: canonical.map(mapNumericObservation).filter(Boolean),
  };
}

function identifierEntries(entity) {
  const entries = [];
  for (const [kind, values] of Object.entries(entity.exact_identifiers || {})) {
    for (const value of values) entries.push([kind, value]);
  }
  return entries.sort(([leftKind, leftValue], [rightKind, rightValue]) =>
    `${leftKind}:${leftValue}`.localeCompare(`${rightKind}:${rightValue}`));
}

function sharedIdentifiers(left, right) {
  const rightKeys = new Set(identifierEntries(right).map(([kind, value]) => `${kind}\u0000${value}`));
  return identifierEntries(left).filter(([kind, value]) => rightKeys.has(`${kind}\u0000${value}`));
}

function detectPhoenixContinuity(entities) {
  const endedStatuses = new Set(['dead', 'dissolved', 'revoked', 'suspended', 'debarred', 'terminated', 'inactive']);
  const successorsByIdentifier = new Map();
  for (const entity of entities) {
    for (const [kind, value] of identifierEntries(entity)) {
      const key = `${kind}\u0000${value}`;
      if (!successorsByIdentifier.has(key)) successorsByIdentifier.set(key, []);
      successorsByIdentifier.get(key).push(entity);
    }
  }
  const results = [];
  for (const predecessor of entities) {
    if (!endedStatuses.has(normalizedComparable(predecessor.status))) continue;
    const endedMs = timestampMs(predecessor.ended_at);
    if (endedMs === null) continue;
    const counts = new Map();
    for (const [kind, value] of identifierEntries(predecessor)) {
      for (const successor of successorsByIdentifier.get(`${kind}\u0000${value}`) || []) {
        if (successor.entity_id === predecessor.entity_id) continue;
        counts.set(successor.entity_id, { successor, count: (counts.get(successor.entity_id)?.count || 0) + 1 });
      }
    }
    for (const { successor, count } of counts.values()) {
      if (count < 2) continue;
      const formedMs = timestampMs(successor.formed_at);
      if (formedMs === null || formedMs < endedMs) continue;
      const gapDays = Math.floor((formedMs - endedMs) / DAY_MS);
      if (gapDays > 730) continue;
      const shared = sharedIdentifiers(predecessor, successor);
      const factors = [
        { factor_id: 'two_or_more_exact_identifiers', weight: 0.65, satisfied: true, explanation: `${shared.length} exact identifier pairs are shared.` },
        { factor_id: 'successor_formed_after_end', weight: 0.2, satisfied: true, explanation: `Successor formation follows predecessor end by ${gapDays} day(s).` },
        { factor_id: 'within_one_year', weight: 0.15, satisfied: gapDays <= 365, explanation: gapDays <= 365 ? 'Formation is within one year.' : 'Formation is more than one year later.' },
      ];
      results.push(candidate({
        ruleId: 'atlas.domain3.integrity.phoenix_continuity',
        signalType: 'phoenix_continuity_candidate',
        title: `Continuity review: ${successor.label}`,
        description: `A later entity shares ${shared.length} exact identifiers with an ended entity and requires human continuity review.`,
        events: [predecessor.event, successor.event],
        subjectIds: [predecessor.entity_id, successor.entity_id],
        jurisdiction: successor.jurisdiction_id || predecessor.jurisdiction_id,
        severity: 'high',
        factors,
        statistics: { predecessor_entity_id: predecessor.entity_id, successor_entity_id: successor.entity_id, shared_identifier_types: [...new Set(shared.map(([kind]) => kind))].sort(), shared_identifier_count: shared.length, gap_days: gapDays },
        unresolvedFields: ['beneficial_ownership', 'operator_control', 'lawful_successorship'],
        limitations: ['Exact continuity supports review but does not establish evasion, fraud, or common ownership.'],
      }));
    }
  }
  return results.filter(Boolean);
}

function detectIdentifierReuse(entities) {
  const allowed = new Set(['address', 'phone', 'license', 'agent', 'operator', 'facility', 'activity']);
  const groups = new Map();
  for (const entity of entities) {
    for (const [kind, value] of identifierEntries(entity)) {
      if (!allowed.has(kind)) continue;
      const key = `${kind}\u0000${value}`;
      if (!groups.has(key)) groups.set(key, { kind, entities: new Map() });
      groups.get(key).entities.set(entity.entity_id, entity);
    }
  }
  const results = [];
  for (const group of groups.values()) {
    const matched = [...group.entities.values()].sort((left, right) => left.entity_id.localeCompare(right.entity_id));
    if (matched.length < 2) continue;
    results.push(candidate({
      ruleId: 'atlas.domain3.integrity.exact_identifier_reuse',
      signalType: 'exact_identifier_reuse_candidate',
      title: `Exact ${group.kind} reuse across ${matched.length} entities`,
      description: `${matched.length} distinct canonical entities share the same exact ${group.kind} identifier and require relationship review.`,
      events: matched.map((entity) => entity.event),
      subjectIds: matched.map((entity) => entity.entity_id),
      jurisdiction: matched.map((entity) => entity.jurisdiction_id).find(Boolean),
      severity: 'medium',
      factors: [
        { factor_id: 'exact_identifier_match', weight: 0.75, satisfied: true, explanation: `The normalized ${group.kind} value is exactly equal across records.` },
        { factor_id: 'multiple_canonical_entities', weight: 0.25, satisfied: true, explanation: `${matched.length} distinct canonical entity IDs are present.` },
      ],
      statistics: { identifier_type: group.kind, distinct_entity_count: matched.length },
      unresolvedFields: ['authorized_shared_service', 'ownership_relationship', 'identifier_effective_dates'],
      limitations: ['Shared contact, address, agent, facility, activity, or license data may be lawful and does not by itself establish misconduct.'],
    }));
  }
  return results.filter(Boolean);
}

function detectFinancialConduits(transfers) {
  const incomingByIntermediary = new Map();
  const outgoingByIntermediary = new Map();
  for (const transfer of transfers) {
    if (!incomingByIntermediary.has(transfer.to_entity_id)) incomingByIntermediary.set(transfer.to_entity_id, []);
    if (!outgoingByIntermediary.has(transfer.from_entity_id)) outgoingByIntermediary.set(transfer.from_entity_id, []);
    incomingByIntermediary.get(transfer.to_entity_id).push(transfer);
    outgoingByIntermediary.get(transfer.from_entity_id).push(transfer);
  }
  const results = [];
  for (const [intermediary, incomingRows] of incomingByIntermediary) {
    const outgoingRows = outgoingByIntermediary.get(intermediary) || [];
    for (const incoming of incomingRows) {
      const incomingMs = timestampMs(incoming.occurred_at);
      for (const outgoing of outgoingRows) {
        if (incoming.transfer_id === outgoing.transfer_id || incoming.from_entity_id === outgoing.to_entity_id) continue;
        const outgoingMs = timestampMs(outgoing.occurred_at);
        if (incomingMs === null || outgoingMs === null || outgoingMs < incomingMs) continue;
        const gapDays = Math.floor((outgoingMs - incomingMs) / DAY_MS);
        if (gapDays > 30) continue;
        const ratio = outgoing.amount / incoming.amount;
        if (ratio < 0.8 || ratio > 1.05) continue;
        results.push(candidate({
          ruleId: 'atlas.domain3.integrity.financial_conduit',
          signalType: 'financial_conduit_candidate',
          title: `Financial conduit review: ${incoming.to_label}`,
          description: `An exact intermediary received and transferred ${(ratio * 100).toFixed(1)}% of the incoming amount within ${gapDays} day(s); beneficial-funder and disclosure review is required.`,
          events: [incoming.event, outgoing.event],
          subjectIds: [incoming.from_entity_id, intermediary, outgoing.to_entity_id],
          jurisdiction: outgoing.jurisdiction_id || incoming.jurisdiction_id,
          severity: 'high',
          factors: [
            { factor_id: 'exact_intermediary_identity', weight: 0.4, satisfied: true, explanation: 'Incoming recipient exactly equals outgoing sender.' },
            { factor_id: 'bounded_amount_ratio', weight: 0.35, satisfied: true, explanation: 'Outgoing amount is 80–105% of incoming amount.' },
            { factor_id: 'bounded_time_window', weight: 0.25, satisfied: true, explanation: 'Transfers occurred within 30 days.' },
          ],
          statistics: { incoming_transfer_id: incoming.transfer_id, outgoing_transfer_id: outgoing.transfer_id, intermediary_entity_id: intermediary, incoming_amount: incoming.amount, outgoing_amount: outgoing.amount, amount_ratio: Number(ratio.toFixed(6)), gap_days: gapDays },
          unresolvedFields: ['fund_identity', 'intermediary_purpose', 'required_disclosures', 'refund_or_reimbursement'],
          limitations: ['Amount and timing similarity can arise from lawful transfers and does not establish concealment, coordination, or a straw-donor scheme.', 'The rule does not claim the same dollars were transferred without account-level tracing.'],
        }));
      }
    }
  }
  return results.filter(Boolean);
}

function detectLegislativeFinancialConvergence(entities, transfers, actions) {
  const interestsByEntity = new Map(entities.map((entity) => [entity.entity_id, entity.interest_tags || []]));
  const actionsByActor = new Map();
  for (const action of actions) {
    if (!actionsByActor.has(action.actor_entity_id)) actionsByActor.set(action.actor_entity_id, []);
    actionsByActor.get(action.actor_entity_id).push(action);
  }
  const results = [];
  for (const transfer of transfers) {
    const donorTags = [...new Set([...(interestsByEntity.get(transfer.from_entity_id) || []), ...transfer.purpose_tags])].sort();
    if (!donorTags.length) continue;
    for (const action of actionsByActor.get(transfer.to_entity_id) || []) {
      const transferMs = timestampMs(transfer.occurred_at);
      const actionMs = timestampMs(action.occurred_at);
      if (transferMs === null || actionMs === null || Math.abs(actionMs - transferMs) > 365 * DAY_MS) continue;
      const overlap = action.policy_tags.filter((tag) => donorTags.includes(tag));
      if (!overlap.length) continue;
      const gapDays = Math.floor(Math.abs(actionMs - transferMs) / DAY_MS);
      results.push(candidate({
        ruleId: 'atlas.domain3.integrity.legislative_financial_convergence',
        signalType: 'legislative_financial_convergence_candidate',
        title: `Legislative-financial convergence: ${action.actor_label}`,
        description: `A financial transfer and legislative action involving the same exact actor overlap on ${overlap.length} source-declared policy tag(s) within ${gapDays} day(s).`,
        events: [transfer.event, action.event],
        subjectIds: [transfer.from_entity_id, transfer.to_entity_id],
        jurisdiction: action.jurisdiction_id,
        severity: 'high',
        factors: [
          { factor_id: 'exact_actor_identity', weight: 0.45, satisfied: true, explanation: 'Transfer recipient exactly equals the legislative actor ID.' },
          { factor_id: 'declared_policy_overlap', weight: 0.3, satisfied: true, explanation: `Shared declared tags: ${overlap.join(', ')}.` },
          { factor_id: 'one_year_window', weight: 0.25, satisfied: true, explanation: 'Transfer and action occurred within 365 days.' },
        ],
        statistics: { transfer_id: transfer.transfer_id, action_id: action.action_id, overlapping_policy_tags: overlap, gap_days: gapDays },
        unresolvedFields: ['independent_explanation', 'decision_causation', 'beneficial_funder', 'required_disclosure_compliance'],
        limitations: ['Temporal and topic convergence is a review signal only and does not establish a quid pro quo, improper motive, corruption, or illegality.', 'Policy tags are source-declared; Atlas does not infer political intent from free text.'],
      }));
    }
  }
  return results.filter(Boolean);
}

function detectSourceContradictions(assertions) {
  const groups = new Map();
  for (const assertion of assertions) {
    const key = `${assertion.subject_id}\u0000${assertion.predicate}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(assertion);
  }
  const results = [];
  for (const group of groups.values()) {
    const values = [...new Set(group.map((assertion) => normalizedComparable(assertion.value)))].sort();
    const sources = [...new Set(group.map((assertion) => assertion.source_id).filter(Boolean))].sort();
    if (values.length < 2 || sources.length < 2) continue;
    const first = group[0];
    results.push(candidate({
      ruleId: 'atlas.domain3.integrity.source_contradiction',
      signalType: 'source_contradiction_candidate',
      title: `Source contradiction: ${first.subject_label} / ${first.predicate}`,
      description: `${values.length} conflicting values for ${first.predicate} are present across ${sources.length} source IDs; no value is selected as true.`,
      events: group.map((assertion) => assertion.event),
      subjectIds: [first.subject_id],
      jurisdiction: group.map((assertion) => assertion.jurisdiction_id).find(Boolean),
      severity: 'medium',
      factors: [
        { factor_id: 'same_exact_subject', weight: 0.35, satisfied: true, explanation: 'Assertions use the same canonical subject ID.' },
        { factor_id: 'same_exact_predicate', weight: 0.25, satisfied: true, explanation: 'Assertions use the same normalized predicate.' },
        { factor_id: 'different_values', weight: 0.2, satisfied: true, explanation: 'At least two distinct normalized values are present.' },
        { factor_id: 'independent_source_ids', weight: 0.2, satisfied: true, explanation: 'At least two source IDs are present.' },
      ],
      statistics: { predicate: first.predicate, distinct_value_count: values.length, distinct_source_count: sources.length, values },
      unresolvedFields: ['effective_period_overlap', 'source_authority', 'supersession', 'clerical_error'],
      limitations: ['A contradiction may reflect different effective dates, scopes, definitions, or later corrections.', 'Atlas preserves every value; a human reviewer must resolve the conflict against its sources.'],
    }));
  }
  return results.filter(Boolean);
}

function detectNumericRangeAnomalies(observations) {
  const results = [];
  for (const observation of observations) {
    const below = observation.expected_min !== null && observation.actual < observation.expected_min;
    const above = observation.expected_max !== null && observation.actual > observation.expected_max;
    if (!below && !above) continue;
    results.push(candidate({
      ruleId: 'atlas.domain3.integrity.numeric_range_anomaly',
      signalType: 'numeric_range_anomaly_candidate',
      title: `Declared-range anomaly: ${observation.subject_label} / ${observation.metric}`,
      description: `${observation.metric} is outside the expected range explicitly supplied by the governed source adapter.`,
      events: [observation.event],
      subjectIds: [observation.subject_id],
      jurisdiction: observation.jurisdiction_id,
      severity: 'medium',
      factors: [
        { factor_id: 'numeric_value_present', weight: 0.3, satisfied: true, explanation: 'A finite actual value is present.' },
        { factor_id: 'source_declared_bound', weight: 0.3, satisfied: true, explanation: 'At least one expected bound is explicitly supplied.' },
        { factor_id: 'outside_declared_range', weight: 0.4, satisfied: true, explanation: 'The actual value falls outside the supplied bound.' },
      ],
      statistics: { observation_id: observation.observation_id, metric: observation.metric, actual: observation.actual, expected_min: observation.expected_min, expected_max: observation.expected_max },
      unresolvedFields: ['baseline_method', 'denominator_consistency', 'measurement_error', 'seasonality'],
      limitations: ['Expected bounds are source-declared; Atlas does not independently validate the baseline.', 'An anomaly is not evidence of intent or misconduct.'],
    }));
  }
  return results.filter(Boolean);
}

export function summarizeIntegrityPatternReadiness(events) {
  const input = mapIntegrityPatternInput(events);
  const counts = {
    canonical_events_scanned: (Array.isArray(events) ? events : []).filter((event) => sourceEventRef(event)).length,
    exact_entity_records: input.entities.length,
    exact_financial_transfers: input.transfers.length,
    exact_legislative_actions: input.legislative_actions.length,
    exact_source_assertions: input.assertions.length,
    declared_numeric_observations: input.numeric_observations.length,
  };
  const blockingGaps = [];
  if (!counts.exact_entity_records) blockingGaps.push('no_source_declared_exact_entity_records');
  if (!counts.exact_financial_transfers) blockingGaps.push('no_exact_payer_and_recipient_transfer_records');
  if (!counts.exact_legislative_actions) blockingGaps.push('no_exact_legislative_actor_records_with_policy_tags');
  if (!counts.exact_source_assertions) blockingGaps.push('no_canonical_subject_predicate_value_assertions');
  if (!counts.declared_numeric_observations) blockingGaps.push('no_source_declared_numeric_bounds');
  return {
    ...counts,
    automatic_integrity_pattern_detection_ready: blockingGaps.length === 0,
    blocking_gaps: blockingGaps,
    interpretation_boundary: INTERPRETATION_BOUNDARY,
  };
}

export function deriveIntegrityPatternCandidates(events) {
  const input = mapIntegrityPatternInput(events);
  const candidates = [
    ...detectPhoenixContinuity(input.entities),
    ...detectIdentifierReuse(input.entities),
    ...detectFinancialConduits(input.transfers),
    ...detectLegislativeFinancialConvergence(input.entities, input.transfers, input.legislative_actions),
    ...detectSourceContradictions(input.assertions),
    ...detectNumericRangeAnomalies(input.numeric_observations),
  ];
  return [...new Map(candidates.map((item) => [item.candidate_hash, item])).values()]
    .sort((left, right) => left.rule_id.localeCompare(right.rule_id) || left.candidate_hash.localeCompare(right.candidate_hash));
}

export {
  ENGINE_ID as INTEGRITY_PATTERN_ENGINE_ID,
  ENGINE_VERSION as INTEGRITY_PATTERN_ENGINE_VERSION,
  INTERPRETATION_BOUNDARY as INTEGRITY_PATTERN_INTERPRETATION_BOUNDARY,
  RULES as INTEGRITY_PATTERN_RULES,
};
