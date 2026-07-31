import assert from 'node:assert/strict';
import test from 'node:test';
import {
  executeLiveDataSignalCycle,
  resolveLiveDataSignalBridgeConfiguration,
} from './liveDataSignalBridgeService.js';

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
  });
  assert.equal(config.atlasUrl, 'https://atlas.example.test');
  assert.equal(config.atlasKey, 'atlas-service-key');
  assert.equal(config.minUniqueRecords, 12);
  assert.equal(config.minUnresolvedRate, 0.75);
  assert.equal(config.candidateLimit, 25);
  assert.equal('lighthouseUrl' in config, false);
  assert.equal('lighthouseKey' in config, false);
});

test('Domain 3 cycle runs detection then governed Atlas database transport', async () => {
  const calls = [];
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
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].name, 'detect_propublica_unresolved_metadata_v1');
  assert.deepEqual(calls[0].args, {
    p_min_unique_records: 12,
    p_min_unresolved_rate: 0.75,
    p_limit: 25,
  });
  assert.equal(calls[1].name, 'bridge_live_data_signal_candidates_v1');
  assert.equal(result.bridge.bridged, 9);
  assert.equal(result.bridge.failed, 0);
  assert.equal(result.bridge.transport, 'atlas_database_http_receipt_v1');
});

test('Domain 3 cycle fails closed when detection has no completed run receipt', async () => {
  const atlasClient = {
    async rpc(name) {
      assert.equal(name, 'detect_propublica_unresolved_metadata_v1');
      return { data: { status: 'failed', candidates: [] }, error: null };
    },
  };

  await assert.rejects(
    executeLiveDataSignalCycle({ atlasClient }),
    /no completed run receipt/,
  );
});

test('Domain 3 cycle surfaces governed database transport errors', async () => {
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

  await assert.rejects(
    executeLiveDataSignalCycle({ atlasClient }),
    /Atlas Domain 3 transport failed: encrypted bridge config unavailable/,
  );
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

  const result = await executeLiveDataSignalCycle({ atlasClient });
  assert.equal(result.bridge.bridged, 0);
  assert.equal(result.bridge.idempotent, 9);
  assert.equal(result.bridge.failed, 0);
});