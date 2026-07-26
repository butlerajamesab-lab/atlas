import assert from 'node:assert/strict';
import test from 'node:test';
import {
  drainProductionSignals,
  mapProductionSignalToBridgeRow,
  resolveBridgeConfiguration,
} from './bridgeDrainService.js';

const SIGNAL = {
  signal_id: '9007199254740991',
  signal_type: 'jurisdiction_legislative_activity',
  geography_key: 'us-wa',
  severity_score: 0.8,
  metadata_json: { title: 'Verified activity' },
  source_connector_id: '06e0aef5-24e6-400d-b365-6e614e8dc41f',
  raw_record_id: '6ae81db8-7f84-4390-84aa-6cd8d1c832be',
  statute_id: '8c3c7f97-3a7b-4ad5-989e-0e8f639401e2',
  entity_ids: ['entity-1'],
  jurisdiction_raw_value: 'Washington',
  jurisdiction_id: null,
  source_url: 'https://example.test/source',
  detected_at: '2026-07-26T18:00:00.000Z',
  confidence_score: 0.9,
  severity: 'high',
  signal_status: 'active',
  evidence_payload: { source: 'fixture' },
  generation_method: 'deterministic_rule',
  rule_id: 'fixture_rule_v1',
  rule_version: 'v1',
  provenance_metadata: { verified: true },
  signal_dedup_key: 'fixture|1',
  record_origin: 'live_api',
  verification_status: 'verified',
};

test('bridge configuration fails closed without explicit Lighthouse credentials', () => {
  assert.throws(
    () => resolveBridgeConfiguration({
      SUPABASE_URL: 'https://atlas.example.test',
      SUPABASE_SERVICE_ROLE_KEY: 'atlas-key',
    }),
    /LIGHTHOUSE_SUPABASE_URL/,
  );

  assert.throws(
    () => resolveBridgeConfiguration({
      SUPABASE_URL: 'https://same.example.test',
      SUPABASE_SERVICE_ROLE_KEY: 'atlas-key',
      LIGHTHOUSE_SUPABASE_URL: 'https://same.example.test',
      LIGHTHOUSE_SERVICE_ROLE_KEY: 'lighthouse-key',
    }),
    /source and target URLs are identical/,
  );
});

test('production signal mapping preserves exact bigint identity and provenance', () => {
  const row = mapProductionSignalToBridgeRow(SIGNAL, {
    emittedAt: '2026-07-26T19:00:00.000Z',
    sourceProjectRef: 'atlas-ref',
    targetProjectRef: 'lighthouse-ref',
  });

  assert.equal(row.atlas_signal_id, '9007199254740991');
  assert.equal(row.source_system, 'atlas');
  assert.equal(row.bridge_version, 'atlas_lighthouse_bridge_v1');
  assert.equal(row.generation_method, 'deterministic_rule');
  assert.equal(row.verification_status, 'verified');
  assert.deepEqual(row.evidence_payload, { source: 'fixture' });
  assert.equal(row.bridge_metadata.transport, 'atlas_service_cross_project_v1');
  assert.equal(row.bridge_metadata.source_project_ref, 'atlas-ref');
  assert.equal(row.bridge_metadata.target_project_ref, 'lighthouse-ref');
});

test('drain inserts only production identities absent from Lighthouse', async () => {
  const secondSignal = { ...SIGNAL, signal_id: '9007199254740992', signal_dedup_key: 'fixture|2' };
  const inserted = [];

  const atlasClient = {
    from(table) {
      assert.equal(table, 'v_civic_map_signals_production');
      return {
        select() { return this; },
        order() { return this; },
        async range(start) {
          return start === 0
            ? { data: [SIGNAL, secondSignal], error: null }
            : { data: [], error: null };
        },
      };
    },
  };

  const lighthouseClient = {
    from(table) {
      assert.equal(table, 'atlas_lighthouse_signal_bridge_v1');
      return {
        select() {
          return {
            async in() {
              return { data: [{ atlas_signal_id: SIGNAL.signal_id }], error: null };
            },
          };
        },
        async insert(rows) {
          inserted.push(...(Array.isArray(rows) ? rows : [rows]));
          return { data: null, error: null };
        },
      };
    },
  };

  const result = await drainProductionSignals({
    atlasClient,
    lighthouseClient,
    pageSize: 500,
    scanLimit: 500,
    emittedAt: '2026-07-26T19:00:00.000Z',
  });

  assert.equal(result.processed, 2);
  assert.equal(result.skipped, 1);
  assert.equal(result.bridged, 1);
  assert.equal(result.errors, 0);
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].atlas_signal_id, secondSignal.signal_id);
});
