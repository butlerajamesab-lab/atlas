import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bridgeLiveDataSignalCandidates,
  parseRegistrationReceipt,
  resolveLiveDataSignalBridgeConfiguration,
} from './liveDataSignalBridgeService.js';

const RECORD = {
  signal_type: 'elevated_unresolved_record_rate',
  title: 'Elevated unresolved nonprofit filing metadata rate',
  description: 'Data-quality observation; not a misconduct or legal finding.',
  primary_stream_id: 'pro_publica',
  source_event_refs: [{ stream_id: 'pro_publica', offset: 10 }],
  entity_ids: ['np-example'],
  entity_resolution_status: 'resolved',
  jurisdiction_id: 'us_federal',
  severity: 'high',
  confidence_score: 1,
  verification_state: 'verified',
  supporting_statistics: {
    candidate_identity_version: '1.1.0',
    unique_source_record_count: 13,
    unresolved_unique_record_count: 13,
    unresolved_unique_rate: 1,
  },
  evidence_refs: [{ stream_id: 'pro_publica', offset: 10 }],
  detection_rule_id: 'atlas.propublica_unresolved_filing_metadata_rate',
  detection_rule_version: '1.1.0',
  engine_id: 'atlas.live_data_signal_exact',
  engine_version: '1.1.0',
  source_freshness_at: '2025-02-14T23:10:35.430Z',
  detected_at: '2026-07-31T19:00:00.000Z',
  governance_status: 'observation_candidate',
};

test('Domain 3 bridge configuration fails closed', () => {
  assert.throws(
    () => resolveLiveDataSignalBridgeConfiguration({
      SUPABASE_URL: 'https://atlas.example.test',
      SUPABASE_SERVICE_ROLE_KEY: 'atlas-key',
    }),
    /LIGHTHOUSE_SUPABASE_URL/,
  );
  assert.throws(
    () => resolveLiveDataSignalBridgeConfiguration({
      SUPABASE_URL: 'https://same.example.test',
      SUPABASE_SERVICE_ROLE_KEY: 'atlas-key',
      LIGHTHOUSE_SUPABASE_URL: 'https://same.example.test',
      LIGHTHOUSE_SERVICE_ROLE_KEY: 'lighthouse-key',
    }),
    /identical source and target URLs/,
  );
});

test('registration receipt parser accepts object, array, and JSON string shapes', () => {
  const receipt = {
    live_data_signal_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    signal_hash: 'b'.repeat(64),
    governance_status: 'observation_candidate',
  };
  assert.equal(parseRegistrationReceipt(receipt).live_data_signal_id, receipt.live_data_signal_id);
  assert.equal(parseRegistrationReceipt([receipt]).signal_hash, receipt.signal_hash);
  assert.equal(
    parseRegistrationReceipt(JSON.stringify(receipt)).governance_status,
    'observation_candidate',
  );
  assert.throws(() => parseRegistrationReceipt(null), /no live-data signal registration receipt/);
});

test('Domain 3 bridge preserves the completed Atlas record without defaults', async () => {
  const calls = [];
  const atlasClient = {
    async rpc(name, args) {
      calls.push({ system: 'atlas', name, args });
      return { data: null, error: null };
    },
  };
  const lighthouseClient = {
    async rpc(name, args) {
      calls.push({ system: 'lighthouse', name, args });
      assert.equal(name, 'register_live_data_signal_receipt_v1');
      assert.deepEqual(args.p_record, RECORD);
      return {
        data: {
          live_data_signal_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          signal_hash: 'b'.repeat(64),
          governance_status: 'observation_candidate',
        },
        error: null,
      };
    },
  };

  const result = await bridgeLiveDataSignalCandidates({
    atlasClient,
    lighthouseClient,
    detection: {
      run_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      candidates: [{
        candidate_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        candidate_hash: 'a'.repeat(64),
        lighthouse_status: 'pending',
        lighthouse_record_id: null,
        lighthouse_record: RECORD,
      }],
    },
  });

  assert.equal(result.candidates_seen, 1);
  assert.equal(result.bridged, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.receipts[0].signal_hash, 'b'.repeat(64));
  assert.equal(calls.filter((call) => call.system === 'lighthouse').length, 1);
  assert.equal(
    calls.some((call) => call.name === 'mark_live_data_signal_candidate_bridge_v1'),
    true,
  );
});

test('Domain 3 bridge counts an exact receipt replay as idempotent', async () => {
  const atlasClient = {
    async rpc() {
      return { data: null, error: null };
    },
  };
  const lighthouseClient = {
    async rpc() {
      return {
        data: [{
          live_data_signal_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          signal_hash: 'b'.repeat(64),
          governance_status: 'observation_candidate',
        }],
        error: null,
      };
    },
  };

  const result = await bridgeLiveDataSignalCandidates({
    atlasClient,
    lighthouseClient,
    detection: {
      candidates: [{
        candidate_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        lighthouse_status: 'bridged',
        lighthouse_record_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        lighthouse_record: RECORD,
      }],
    },
  });

  assert.equal(result.bridged, 0);
  assert.equal(result.idempotent, 1);
  assert.equal(result.failed, 0);
});

test('Domain 3 bridge rejects incomplete candidates instead of inventing values', async () => {
  const atlasCalls = [];
  const atlasClient = {
    async rpc(name, args) {
      atlasCalls.push({ name, args });
      return { data: null, error: null };
    },
  };
  const lighthouseClient = {
    async rpc() {
      throw new Error('Lighthouse must not be called for an incomplete candidate');
    },
  };

  const incomplete = { ...RECORD };
  delete incomplete.confidence_score;
  delete incomplete.severity;

  const result = await bridgeLiveDataSignalCandidates({
    atlasClient,
    lighthouseClient,
    detection: {
      candidates: [{
        candidate_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        lighthouse_record: incomplete,
      }],
    },
  });

  assert.equal(result.bridged, 0);
  assert.equal(result.failed, 1);
  assert.match(result.receipts[0].error, /severity|confidence_score/);
  assert.equal(
    atlasCalls.some((call) => call.args?.p_status === 'failed'),
    true,
  );
});