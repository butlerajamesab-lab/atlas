import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EVENT_ENTITY_RESOLVER_ID,
  EVENT_ENTITY_RESOLVER_VERSION,
  EVENT_ENTITY_RULE_MANIFEST,
  EVENT_ENTITY_RULE_MANIFEST_HASH,
  buildEntityIndex,
  buildResolutionHash,
  drainEventEntityResolution,
  extractEntityCandidates,
  isEntityTypeCompatible,
  loadResolutionIndex,
  normalizeEntityName,
  normalizeIdentifier,
  resolveCandidate,
  resolveEvent,
  resolveEventBatch,
  sha256Text,
  stableStringify,
} from '../src/services/eventEntityResolution.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function entitiesFixture() {
  return [
    {
      entity_id: 'np-pivotal',
      entity_type: 'nonprofit',
      primary_name: 'Pivotal Philanthropies Pathways Foundation',
      name_variants: ['Pivotal Pathways Foundation'],
      source_systems: ['pro_publica'],
      source_population_id: '934414218',
      source_population_table: 'nonprofit_registry',
      source_external_id: '934414218',
      metadata: { ein: '93-4414218' },
      is_active: true,
    },
    {
      entity_id: 'org-transunion',
      entity_type: 'organization',
      primary_name: 'TRANSUNION INTERMEDIATE HOLDINGS, INC.',
      name_variants: [],
      source_systems: ['cfpb'],
      source_population_table: 'consumer_complaints',
      is_active: true,
    },
    {
      entity_id: 'org-apple',
      entity_type: 'corporation',
      primary_name: 'Apple Inc.',
      name_variants: [],
      source_systems: ['sec_edgar'],
      source_population_table: 'sec_filings',
      metadata: { cik: '320193' },
      is_active: true,
    },
    {
      entity_id: 'agency-doe',
      entity_type: 'government_agency',
      primary_name: 'Department of Energy',
      name_variants: ['U.S. Department of Energy'],
      source_systems: ['usa_spending'],
      source_population_table: 'agencies',
      is_active: true,
    },
    {
      entity_id: 'org-battelle',
      entity_type: 'organization',
      primary_name: 'Battelle Memorial Institute',
      name_variants: [],
      source_systems: ['usa_spending'],
      source_population_table: 'awards',
      is_active: true,
    },
    {
      entity_id: 'person-smith',
      entity_type: 'person',
      primary_name: 'Jordan Smith',
      name_variants: [],
      source_systems: ['open_states'],
      source_population_table: 'legislators',
      is_active: true,
    },
    {
      entity_id: 'dup-abc-org',
      entity_type: 'organization',
      primary_name: 'ABC',
      name_variants: [],
      source_systems: ['one'],
      source_population_table: 'one',
      is_active: true,
    },
    {
      entity_id: 'dup-abc-agency',
      entity_type: 'government_agency',
      primary_name: 'A.B.C.',
      name_variants: [],
      source_systems: ['two'],
      source_population_table: 'two',
      is_active: true,
    },
    {
      entity_id: 'inactive-entity',
      entity_type: 'organization',
      primary_name: 'Inactive Entity',
      is_active: false,
    },
  ];
}

function aliasesFixture() {
  return [
    {
      alias_id: 1,
      entity_id: 'org-transunion',
      alias_text: 'Trans Union Intermediate Holdings',
      alias_type: 'spelling_variant',
      confidence_score: 1,
    },
    {
      alias_id: 2,
      entity_id: 'agency-doe',
      alias_text: 'DOE',
      alias_type: 'acronym',
      confidence_score: 1,
    },
    {
      alias_id: 3,
      entity_id: 'org-apple',
      alias_text: 'Apple Computer',
      alias_type: 'fuzzy_match',
      confidence_score: 1,
    },
    {
      alias_id: 4,
      entity_id: 'org-apple',
      alias_text: 'Apple Incorporated',
      alias_type: 'legal_name',
      confidence_score: 0.95,
    },
  ];
}

function event(overrides = {}) {
  return {
    stream_id: 'cfpb_complaints',
    offset: '10',
    timestamp: '2026-05-10T00:28:15.974Z',
    signal_type: 'consumer_complaint',
    spacetime: { jurisdiction: 'us_federal' },
    provenance: { source_system: 'cfpb' },
    payload: { company: 'TRANSUNION INTERMEDIATE HOLDINGS, INC.' },
    source_id: 'cfpb',
    jurisdiction_id: 'us_federal',
    module_hint: 'consumer_finance',
    ingested_at: '2026-05-10T00:28:16.000Z',
    event_input_hash: HASH_A,
    ...overrides,
  };
}

function candidate(overrides = {}) {
  const extracted = extractEntityCandidates(event())[0];
  return { ...extracted, ...overrides };
}

test('stableStringify is key-order stable', () => {
  assert.equal(stableStringify({ b: 2, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":2}');
  assert.equal(
    sha256Text(stableStringify({ b: 2, a: 1 })),
    sha256Text(stableStringify({ a: 1, b: 2 })),
  );
});

test('rule manifest is versioned, complete, and hashed', () => {
  assert.equal(EVENT_ENTITY_RULE_MANIFEST.length, 13);
  assert.match(EVENT_ENTITY_RULE_MANIFEST_HASH, /^[0-9a-f]{64}$/);
  assert.equal(EVENT_ENTITY_RULE_MANIFEST_HASH, 'd6c15b4bae26b4fb9c87f4173fcd8f880e59b1ff17e0d2e046aaeedaee9695dd');
  assert.ok(EVENT_ENTITY_RULE_MANIFEST.some((rule) => rule.rule_id === 'system.no_declared_entity_rule'));
  for (const rule of EVENT_ENTITY_RULE_MANIFEST) {
    assert.match(rule.rule_id, /^[a-z0-9_.]+$/);
    assert.match(rule.rule_version, /^\d+\.\d+\.\d+$/);
    assert.ok(Array.isArray(rule.signal_types));
    assert.ok(Array.isArray(rule.name_fields));
    assert.ok(Array.isArray(rule.identifier_fields));
    assert.ok(Array.isArray(rule.exact_identifier_types));
    assert.equal(typeof rule.transform, 'string');
    assert.ok(Object.hasOwn(rule, 'expected_entity_type'));
  }
});

test('entity-name normalization matches deployed Atlas compact normalization', () => {
  assert.equal(normalizeEntityName('  A&B, Inc.  '), 'ABINC');
  assert.equal(normalizeEntityName('TRANS UNION'), 'TRANSUNION');
  assert.equal(normalizeEntityName(''), null);
});

test('identifier normalization validates identifier shapes', () => {
  assert.equal(normalizeIdentifier('ein', '93-4414218'), '934414218');
  assert.equal(normalizeIdentifier('ein', '123'), null);
  assert.equal(normalizeIdentifier('cik', '320193'), '0000320193');
  assert.equal(normalizeIdentifier('duns', '12-345-6789'), '123456789');
  assert.equal(normalizeIdentifier('uei', 'ABC1-DEF2-GHI3'), 'ABC1DEF2GHI3');
  assert.equal(normalizeIdentifier('uei', 'short'), null);
  assert.equal(normalizeIdentifier('canonical_entity_id', 'org-apple'), 'org-apple');
});

test('entity type compatibility is explicit and conservative', () => {
  assert.equal(isEntityTypeCompatible('organization', 'corporation'), true);
  assert.equal(isEntityTypeCompatible('government_agency', 'government_agency'), true);
  assert.equal(isEntityTypeCompatible('person', 'corporation'), false);
  assert.equal(isEntityTypeCompatible('nonprofit', 'organization'), false);
});

test('entity index is deterministic across source order and excludes fuzzy/low-confidence aliases', () => {
  const entities = entitiesFixture();
  const aliases = aliasesFixture();
  const first = buildEntityIndex(entities, aliases);
  const second = buildEntityIndex([...entities].reverse(), [...aliases].reverse());

  assert.equal(first.entity_index_hash, second.entity_index_hash);
  assert.equal(first.entity_count, 8);
  assert.equal(first.alias_count, 2);
  assert.equal(first.excluded_alias_count, 2);
  assert.deepEqual([...first.identifiers.get('ein:934414218')], ['np-pivotal']);
  assert.deepEqual([...first.identifiers.get('cik:0000320193')], ['org-apple']);
  assert.equal(first.aliasNames.has(normalizeEntityName('Apple Computer')), false);
});

test('accepted alias confidence formatting does not change the entity-index snapshot', () => {
  const numeric = aliasesFixture();
  const textual = aliasesFixture().map((alias) => ({
    ...alias,
    confidence_score: alias.confidence_score === 1 ? '1.00' : String(alias.confidence_score),
  }));
  const first = buildEntityIndex(entitiesFixture(), numeric);
  const second = buildEntityIndex(entitiesFixture(), textual);
  assert.equal(first.entity_index_hash, second.entity_index_hash);
});

test('ProPublica extraction preserves exact name and EIN source fields', () => {
  const candidates = extractEntityCandidates(event({
    stream_id: 'pro_publica',
    signal_type: 'nonprofit_registry_record',
    payload: {
      name: 'Pivotal Philanthropies Pathways Foundation',
      ein: 934414218,
      raw: { name: 'Ignored fallback' },
    },
  }));
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].source_field, 'payload.name');
  assert.equal(candidates[0].source_field_value, 'Pivotal Philanthropies Pathways Foundation');
  assert.equal(candidates[0].source_identifier_field, 'payload.ein');
  assert.equal(candidates[0].identifier_value, '934414218');
  assert.match(candidates[0].candidate_key, /^[0-9a-f]{64}$/);
});

test('source provenance preserves exact raw values while matching uses trimmed values', () => {
  const candidates = extractEntityCandidates(event({
    stream_id: 'pro_publica',
    signal_type: 'nonprofit_registry_record',
    payload: {
      name: '  Pivotal Philanthropies Pathways Foundation  ',
      ein: ' 93-4414218 ',
    },
  }));
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].source_field_value, '  Pivotal Philanthropies Pathways Foundation  ');
  assert.equal(candidates[0].entity_name, 'Pivotal Philanthropies Pathways Foundation');
  assert.equal(candidates[0].source_identifier_value, ' 93-4414218 ');
  assert.equal(candidates[0].identifier_value, '93-4414218');
});

test('USAspending extraction separates full source field value from parsed recipient', () => {
  const title = 'Contract: BATTELLE MEMORIAL INSTITUTE — $30,354,931,646.47';
  const candidates = extractEntityCandidates(event({
    stream_id: 'usa_spending',
    signal_type: 'federal_contract_award',
    payload: { title, agency: 'Department of Energy' },
  }));
  const recipient = candidates.find((row) => row.entity_role === 'award_recipient');
  const agency = candidates.find((row) => row.entity_role === 'awarding_agency');
  assert.equal(recipient.source_field, 'payload.title');
  assert.equal(recipient.source_field_value, title);
  assert.equal(recipient.entity_name, 'BATTELLE MEMORIAL INSTITUTE');
  assert.equal(agency.source_field, 'payload.agency');
});

test('Open States sponsor arrays retain exact indexed source paths', () => {
  const candidates = extractEntityCandidates(event({
    stream_id: 'open_states',
    signal_type: 'open_states.bill',
    payload: { sponsors: [{ name: 'Jordan Smith' }, 'Taylor Doe'] },
  }));
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].source_field, 'payload.sponsors[0].name');
  assert.equal(candidates[1].source_field, 'payload.sponsors[1]');
});

test('exact EIN takes precedence and resolves to canonical nonprofit', () => {
  const index = buildEntityIndex(entitiesFixture(), aliasesFixture());
  const ev = event({
    stream_id: 'pro_publica',
    signal_type: 'nonprofit_registry_record',
    payload: { name: 'Pivotal Philanthropies Pathways Foundation', ein: '93-4414218' },
  });
  const row = resolveEvent(ev, index)[0];
  assert.equal(row.resolution_status, 'resolved');
  assert.equal(row.entity_id, 'np-pivotal');
  assert.equal(row.match_method, 'exact_external_identifier');
  assert.deepEqual(row.candidate_entity_ids, ['np-pivotal']);
});

test('exact primary name resolves without an external identifier', () => {
  const index = buildEntityIndex(entitiesFixture(), aliasesFixture());
  const row = resolveEvent(event(), index)[0];
  assert.equal(row.resolution_status, 'resolved');
  assert.equal(row.entity_id, 'org-transunion');
  assert.equal(row.match_method, 'exact_primary_name');
});

test('exact retained alias resolves, fuzzy and low-confidence aliases do not', () => {
  const index = buildEntityIndex(entitiesFixture(), aliasesFixture());
  const aliasRow = resolveEvent(event({ payload: { company: 'Trans Union Intermediate Holdings' } }), index)[0];
  assert.equal(aliasRow.resolution_status, 'resolved');
  assert.equal(aliasRow.match_method, 'exact_alias');
  assert.equal(aliasRow.entity_id, 'org-transunion');

  const fuzzyRow = resolveEvent(event({
    stream_id: 'sec_edgar',
    payload: { company: 'Apple Computer' },
  }), index)[0];
  assert.equal(fuzzyRow.resolution_status, 'unresolved');
  assert.equal(fuzzyRow.entity_id, null);

  const lowConfidenceRow = resolveEvent(event({
    stream_id: 'sec_edgar',
    payload: { company: 'Apple Incorporated' },
  }), index)[0];
  assert.equal(lowConfidenceRow.resolution_status, 'unresolved');
});

test('similar but non-canonical spelling is not fuzzily matched', () => {
  const index = buildEntityIndex(entitiesFixture(), aliasesFixture());
  const row = resolveEvent(event({ payload: { company: 'Transunion Intermediate Holding' } }), index)[0];
  assert.equal(row.resolution_status, 'unresolved');
  assert.equal(row.match_method, 'no_exact_match');
  assert.equal(row.match_evidence.no_fuzzy_matching, true);
});

test('duplicate exact canonical names remain ambiguous', () => {
  const index = buildEntityIndex(entitiesFixture(), aliasesFixture());
  const row = resolveEvent(event({ payload: { company: 'A B C' } }), index)[0];
  assert.equal(row.resolution_status, 'ambiguous');
  assert.equal(row.match_method, 'duplicate_exact_name');
  assert.deepEqual(row.candidate_entity_ids, ['dup-abc-agency', 'dup-abc-org']);
});

test('identifier/name conflicts remain ambiguous rather than silently choosing one', () => {
  const index = buildEntityIndex(entitiesFixture(), aliasesFixture());
  const ev = event({
    stream_id: 'sec_edgar',
    signal_type: 'sec_filing',
    payload: { company: 'TRANSUNION INTERMEDIATE HOLDINGS, INC.', cik: '320193' },
  });
  const row = resolveEvent(ev, index)[0];
  assert.equal(row.resolution_status, 'ambiguous');
  assert.equal(row.match_method, 'identifier_name_conflict');
  assert.deepEqual(row.candidate_entity_ids, ['org-apple', 'org-transunion']);
});

test('exact match with incompatible entity type is unresolved', () => {
  const index = buildEntityIndex(entitiesFixture(), aliasesFixture());
  const ev = event({
    stream_id: 'open_states',
    signal_type: 'open_states.bill',
    payload: { sponsor: 'Apple Inc.' },
  });
  const row = resolveEvent(ev, index)[0];
  assert.equal(row.resolution_status, 'unresolved');
  assert.equal(row.match_method, 'exact_match_entity_type_mismatch');
  assert.equal(row.entity_id, null);
  assert.deepEqual(row.candidate_entity_ids, ['org-apple']);
});

test('invalid supplied identifier does not block an exact canonical-name match', () => {
  const index = buildEntityIndex(entitiesFixture(), aliasesFixture());
  const ev = event({
    stream_id: 'sec_edgar',
    signal_type: 'sec_filing',
    payload: { company: 'Apple Inc.', cik: 'not-a-cik' },
  });
  const row = resolveEvent(ev, index)[0];
  assert.equal(row.resolution_status, 'resolved');
  assert.equal(row.entity_id, 'org-apple');
  assert.equal(row.match_method, 'exact_primary_name');
  assert.equal(row.match_evidence.identifier_was_valid, false);
});

test('explicit canonical entity ID resolves exactly', () => {
  const index = buildEntityIndex(entitiesFixture(), aliasesFixture());
  const ev = event({
    stream_id: 'custom_stream',
    signal_type: 'custom',
    payload: { canonical_entity_id: 'org-apple' },
  });
  const row = resolveEvent(ev, index)[0];
  assert.equal(row.resolution_status, 'resolved');
  assert.equal(row.entity_id, 'org-apple');
  assert.equal(row.match_method, 'exact_canonical_entity_id');
  assert.equal(row.source_field, '__none__');
  assert.equal(row.source_identifier_field, 'payload.canonical_entity_id');
});

test('events without a declared entity-bearing field are explicitly ignored', () => {
  const index = buildEntityIndex(entitiesFixture(), aliasesFixture());
  const rows = resolveEvent(event({
    stream_id: 'bls_employment',
    signal_type: 'unemployment_rate',
    payload: { rate: 4.2, state: 'WA' },
  }), index);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].resolution_status, 'ignored');
  assert.equal(rows[0].rule_id, 'system.no_declared_entity_rule');
  assert.equal(rows[0].source_field, '__none__');
});

test('resolution hashes are stable for identical complete inputs', () => {
  const index = buildEntityIndex(entitiesFixture(), aliasesFixture());
  const first = resolveEvent(event(), index)[0];
  const second = resolveEvent(event(), index)[0];
  assert.equal(first.resolution_hash, second.resolution_hash);
  assert.equal(buildResolutionHash(first), first.resolution_hash);
});

test('resolution hash changes when the entity-registry snapshot changes', () => {
  const firstIndex = buildEntityIndex(entitiesFixture(), aliasesFixture());
  const secondIndex = buildEntityIndex(entitiesFixture(), [
    ...aliasesFixture(),
    {
      alias_id: 5,
      entity_id: 'org-battelle',
      alias_text: 'BMI',
      alias_type: 'acronym',
      confidence_score: 1,
    },
  ]);
  const first = resolveEvent(event(), firstIndex)[0];
  const second = resolveEvent(event(), secondIndex)[0];
  assert.notEqual(firstIndex.entity_index_hash, secondIndex.entity_index_hash);
  assert.notEqual(first.resolution_hash, second.resolution_hash);
});

test('batch resolution preserves multiple event entities', () => {
  const index = buildEntityIndex(entitiesFixture(), aliasesFixture());
  const rows = resolveEventBatch([
    event({
      stream_id: 'usa_spending',
      signal_type: 'federal_contract_award',
      payload: {
        title: 'Contract: BATTELLE MEMORIAL INSTITUTE — $100',
        agency: 'Department of Energy',
      },
    }),
  ], index);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.entity_id).sort(), ['agency-doe', 'org-battelle']);
});

function pagedQuery(rows) {
  return {
    select() { return this; },
    order() { return this; },
    range(from, to) {
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
    },
  };
}

test('resolution index loader paginates instead of silently truncating at 10,000 rows', async () => {
  const entities = Array.from({ length: 1001 }, (_, index) => ({
    entity_id: `entity-${String(index).padStart(4, '0')}`,
    entity_type: 'organization',
    primary_name: `Entity ${index}`,
    name_variants: [],
    source_systems: [],
    is_active: true,
  }));
  const supabase = {
    from(viewName) {
      if (viewName === 'v_atlas_entity_resolution_registry_v1') return pagedQuery(entities);
      if (viewName === 'v_atlas_entity_resolution_aliases_v1') return pagedQuery([]);
      throw new Error(`unexpected view ${viewName}`);
    },
  };
  const index = await loadResolutionIndex(supabase);
  assert.equal(index.entity_count, 1001);
});

function createDrainSupabase({ events, persist = null }) {
  let fetchCount = 0;
  const rpcCalls = [];
  return {
    rpcCalls,
    from(viewName) {
      if (viewName === 'v_atlas_entity_resolution_registry_v1') return pagedQuery(entitiesFixture());
      if (viewName === 'v_atlas_entity_resolution_aliases_v1') return pagedQuery(aliasesFixture());
      throw new Error(`unexpected view ${viewName}`);
    },
    async rpc(name, params) {
      rpcCalls.push({ name, params });
      if (name === 'start_atlas_event_entity_resolution_run_v1') {
        return { data: { status: 'running' }, error: null };
      }
      if (name === 'fetch_atlas_signal_events_for_entity_resolution_v1') {
        const data = fetchCount === 0 ? events : [];
        fetchCount += 1;
        return { data, error: null };
      }
      if (name === 'persist_atlas_event_entity_resolution_batch_v1') {
        return {
          data: persist ?? {
            inserted_count: params.p_rows.length,
            idempotent_count: 0,
          },
          error: null,
        };
      }
      if (name === 'complete_atlas_event_entity_resolution_run_v1') {
        return { data: { status: params.p_status }, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
  };
}

test('bounded drain reports completed only after the source is exhausted', async () => {
  const supabase = createDrainSupabase({ events: [event()] });
  const result = await drainEventEntityResolution({
    supabase,
    batchSize: 10,
    maxBatches: 2,
    afterOffset: '-1',
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.has_more, false);
  assert.equal(result.processed_event_count, 1);
  assert.equal(result.last_offset, '10');
  const completeCall = supabase.rpcCalls.find((call) => call.name === 'complete_atlas_event_entity_resolution_run_v1');
  assert.equal(completeCall.params.p_status, 'completed');
});

test('bounded drain marks a full capped run partial rather than falsely complete', async () => {
  const events = [event({ offset: '9007199254740993' })];
  const supabase = createDrainSupabase({ events });
  const result = await drainEventEntityResolution({
    supabase,
    batchSize: 1,
    maxBatches: 1,
    afterOffset: '-1',
  });
  assert.equal(result.status, 'partial');
  assert.equal(result.has_more, true);
  assert.equal(result.last_offset, '9007199254740993');
  const fetchCall = supabase.rpcCalls.find((call) => call.name === 'fetch_atlas_signal_events_for_entity_resolution_v1');
  assert.equal(fetchCall.params.p_after_offset, '-1');
});

test('bounded drain locks the complete rule manifest in the run input', async () => {
  const supabase = createDrainSupabase({ events: [] });
  await drainEventEntityResolution({ supabase, batchSize: 10, maxBatches: 1 });
  const startCall = supabase.rpcCalls.find((call) => call.name === 'start_atlas_event_entity_resolution_run_v1');
  const manifest = startCall.params.p_input_manifest;
  assert.equal(manifest.rule_count, EVENT_ENTITY_RULE_MANIFEST.length);
  assert.deepEqual(manifest.rule_ids, EVENT_ENTITY_RULE_MANIFEST.map((rule) => rule.rule_id));
  assert.equal(manifest.rule_manifest_hash, EVENT_ENTITY_RULE_MANIFEST_HASH);
  assert.equal(manifest.no_fuzzy_matching, true);
  assert.equal(manifest.no_silent_entity_creation, true);
  assert.equal(Object.hasOwn(manifest, 'excluded_alias_count'), false);
});

test('single-stream resume binds the stream cursor to the supplied offset', async () => {
  const supabase = createDrainSupabase({ events: [] });
  await drainEventEntityResolution({
    supabase,
    streamId: 'pro_publica',
    afterOffset: '7450',
    batchSize: 10,
    maxBatches: 1,
  });
  const fetchCall = supabase.rpcCalls.find((call) => call.name === 'fetch_atlas_signal_events_for_entity_resolution_v1');
  assert.equal(fetchCall.params.p_stream_id, 'pro_publica');
  assert.equal(fetchCall.params.p_after_stream_id, 'pro_publica');
  assert.equal(fetchCall.params.p_after_offset, '7450');
});

test('resolver contract constants remain snake_case and versioned', () => {
  assert.equal(EVENT_ENTITY_RESOLVER_ID, 'atlas.signal_event_entity_exact');
  assert.equal(EVENT_ENTITY_RESOLVER_VERSION, '1.0.0');
});
