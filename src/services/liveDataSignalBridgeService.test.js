import assert from 'node:assert/strict';
import test from 'node:test';
import {
  executeLiveDataSignalCycle,
  resolveLiveDataSignalBridgeConfiguration,
} from './liveDataSignalBridgeService.js';
import { deriveDomain3PopulationCandidates } from './domain3PopulationDetectorService.js';
import { DOMAIN3_FULL_REPLAY_RULES } from './domain3PopulationReplayService.js';

const emptyPopulationDetector = async () => ({
  engine_id: 'atlas.domain3_population_exact',
  engine_version: '1.1.0',
  observations_scanned: 0,
  candidates_derived: 0,
  candidates_persisted: 0,
  rules_registered: 6,
  runs: [],
});

test('Domain 3 bridge configuration requires Atlas service credentials only', () => {
  assert.throws(
    () => resolveLiveDataSignalBridgeConfiguration({
      SUPABASE_URL: 'https://atlas.example.test',
    }),
    /SUPABASE_SERVICE_ROLE_KEY/,
  );

  const config = resolveLiveDataSignalBridgeConfiguration({
    SUPABASE_URL: 'https://atlas.example.test',
    SUPABASE_SERVICE_ROLE_KEY: 'atlas-service-key',
    ATLAS_DOMAIN3_MIN_UNIQUE_RECORDS: '12',
    ATLAS_DOMAIN3_MIN_UNRESOLVED_RATE: '0.75',
    ATLAS_DOMAIN3_CANDIDATE_LIMIT: '25',
    ATLAS_DOMAIN3_OBSERVATION_LIMIT: '12345',
  });
  assert.equal(config.atlasUrl, 'https://atlas.example.test');
  assert.equal(config.atlasKey, 'atlas-service-key');
  assert.equal(config.minUniqueRecords, 12);
  assert.equal(config.minUnresolvedRate, 0.75);
  assert.equal(config.candidateLimit, 25);
  assert.equal(config.observationLimit, 12345);
  assert.equal('lighthouseUrl' in config, false);
  assert.equal('lighthouseKey' in config, false);
});

test('Domain 3 bridge defaults to complete current observation substrate capacity', () => {
  const config = resolveLiveDataSignalBridgeConfiguration({
    SUPABASE_URL: 'https://atlas.example.test',
    SUPABASE_SERVICE_ROLE_KEY: 'atlas-service-key',
  });
  assert.equal(config.observationLimit, 100000);
  assert.equal(config.candidateLimit, 250);
});

test('full replay declares cross-jurisdiction recurrence as a governed Domain 3 rule', () => {
  assert.ok(DOMAIN3_FULL_REPLAY_RULES.some((rule) =>
    rule.rule_id === 'atlas.domain3.cross_jurisdiction_recurrence'
      && rule.signal_type === 'cross_jurisdiction_recurrence'));
});

test('Domain 3 cycle runs seed detection, population detection, then governed Atlas database transport', async () => {
  const calls = [];
  let populationCalled = false;
  const atlasClient = {
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === 'detect_propublica_unresolved_metadata_v1') {
        return {
          data: {
            run_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            status: 'completed',
            rule_version: '1.1.0',
            candidates_produced: 9,
          },
          error: null,
        };
      }
      if (name === 'bridge_live_data_signal_candidates_v1') {
        assert.deepEqual(args, {
          p_run_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          p_limit: 25,
        });
        return {
          data: {
            run_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            candidates_seen: 9,
            bridged: 9,
            idempotent: 0,
            failed: 0,
            transport: 'atlas_database_http_receipt_v1',
          },
          error: null,
        };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
  };

  const result = await executeLiveDataSignalCycle({
    atlasClient,
    minUniqueRecords: 12,
    minUnresolvedRate: 0.75,
    candidateLimit: 25,
    observationLimit: 12345,
    populationDetector: async ({ observationLimit, candidateLimit }) => {
      populationCalled = true;
      assert.equal(observationLimit, 12345);
      assert.equal(candidateLimit, 25);
      return emptyPopulationDetector();
    },
  });

  assert.equal(populationCalled, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].name, 'detect_propublica_unresolved_metadata_v1');
  assert.deepEqual(calls[0].args, {
    p_min_unique_records: 12,
    p_min_unresolved_rate: 0.75,
    p_limit: 25,
  });
  assert.equal(calls[1].name, 'bridge_live_data_signal_candidates_v1');
  assert.equal(result.status, 'completed');
  assert.equal(result.bridge.bridged, 9);
  assert.equal(result.bridge.failed, 0);
  assert.equal(result.population_detection.engine_id, 'atlas.domain3_population_exact');
});

test('Domain 3 population replay continues when narrow ProPublica seed detector is unavailable', async () => {
  let populationCalled = false;
  const atlasClient = {
    async rpc(name) {
      assert.equal(name, 'detect_propublica_unresolved_metadata_v1');
      return { data: { status: 'failed', candidates: [] }, error: null };
    },
  };

  const result = await executeLiveDataSignalCycle({
    atlasClient,
    populationDetector: async () => {
      populationCalled = true;
      return emptyPopulationDetector();
    },
  });

  assert.equal(populationCalled, true);
  assert.equal(result.status, 'partial');
  assert.match(result.seed_error, /seed detector unavailable/);
  assert.equal(result.population_detection.rules_registered, 6);
});

test('Domain 3 cycle retains per-run transport errors without discarding successful detector work', async () => {
  const atlasClient = {
    async rpc(name) {
      if (name === 'detect_propublica_unresolved_metadata_v1') {
        return {
          data: {
            run_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            status: 'completed',
          },
          error: null,
        };
      }
      return {
        data: null,
        error: { message: 'encrypted bridge config unavailable' },
      };
    },
  };

  const result = await executeLiveDataSignalCycle({ atlasClient, populationDetector: emptyPopulationDetector });
  assert.equal(result.status, 'partial');
  assert.equal(result.bridge.failed, 1);
  assert.match(result.bridge.errors[0].error, /encrypted bridge config unavailable/);
});

test('Domain 3 cycle recognizes idempotent replay receipt', async () => {
  const atlasClient = {
    async rpc(name) {
      if (name === 'detect_propublica_unresolved_metadata_v1') {
        return {
          data: {
            run_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            status: 'completed',
          },
          error: null,
        };
      }
      return {
        data: {
          candidates_seen: 9,
          bridged: 0,
          idempotent: 9,
          failed: 0,
          transport: 'atlas_database_http_receipt_v1',
        },
        error: null,
      };
    },
  };

  const result = await executeLiveDataSignalCycle({ atlasClient, populationDetector: emptyPopulationDetector });
  assert.equal(result.bridge.bridged, 0);
  assert.equal(result.bridge.idempotent, 9);
  assert.equal(result.bridge.failed, 0);
});

test('Domain 3 cycle bridges each population detector run independently', async () => {
  const bridgedRunIds = [];
  const atlasClient = {
    async rpc(name, args) {
      if (name === 'detect_propublica_unresolved_metadata_v1') {
        return { data: { run_id: 'seed-run', status: 'completed' }, error: null };
      }
      if (name === 'bridge_live_data_signal_candidates_v1') {
        bridgedRunIds.push(args.p_run_id);
        return { data: { candidates_seen: 1, bridged: 1, idempotent: 0, failed: 0 }, error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
  };

  const result = await executeLiveDataSignalCycle({
    atlasClient,
    candidateLimit: 10,
    populationDetector: async () => ({
      runs: [
        { run_id: 'population-a', rule_id: 'atlas.domain3.frequency_spike' },
        { run_id: 'population-b', rule_id: 'atlas.domain3.repeat_entity' },
      ],
    }),
  });

  assert.deepEqual(bridgedRunIds, ['seed-run', 'population-a', 'population-b']);
  assert.equal(result.bridge.candidates_seen, 3);
  assert.equal(result.bridge.bridged, 3);
});

test('Domain 3 population detector derives repeat and cross-category signals from canonical observations', () => {
  const rows = [];
  let offset = 1;
  const makeEvent = ({ category, entity, city = 'Seattle' }) => ({
    stream_id: 'cfpb_complaints',
    offset: offset++,
    timestamp: '2025-01-01T00:00:00.000Z',
    ingested_at: '2025-01-02T00:00:00.000Z',
    signal_type: category,
    spacetime: { jurisdiction: 'WA', city },
    payload: { category, company: entity },
    event_identity_hash: String(offset).padStart(64, '0').slice(-64),
    jurisdiction_id: 'WA',
  });

  for (let i = 0; i < 40; i += 1) rows.push(makeEvent({ category: `category_${i % 4}`, entity: 'Dominant Corp' }));
  for (let entityIndex = 0; entityIndex < 12; entityIndex += 1) {
    for (let i = 0; i < 2; i += 1) rows.push(makeEvent({ category: `other_${entityIndex % 3}`, entity: `Other ${entityIndex}`, city: `City ${entityIndex % 4}` }));
  }

  const candidates = deriveDomain3PopulationCandidates(rows);
  const repeat = candidates.find((candidate) => candidate.signal_type === 'repeat_entity' && candidate.title.includes('Dominant Corp'));
  const cross = candidates.find((candidate) => candidate.signal_type === 'cross_category_entity' && candidate.title.includes('Dominant Corp'));

  assert.ok(repeat);
  assert.ok(cross);
  assert.equal(repeat.verification_state, 'unverified');
  assert.equal(repeat.entity_resolution_status, 'unresolved_exact_match_required');
  assert.ok(repeat.source_event_refs.length <= 25);
});
