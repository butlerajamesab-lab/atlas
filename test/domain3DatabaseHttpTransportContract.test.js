import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(
  new URL('../src/schema/20260731_domain3_database_http_transport.sql', import.meta.url),
  'utf8',
);
const service = fs.readFileSync(
  new URL('../src/services/liveDataSignalBridgeService.js', import.meta.url),
  'utf8',
);

test('transport uses the existing encrypted Atlas bridge configuration', () => {
  assert.match(migration, /atlas_bridge_config_for\('atlas-to-lighthouse'\)/);
  assert.match(migration, /target_service_key/);
  assert.match(migration, /target_url/);
  assert.doesNotMatch(migration, /sbp_[a-z0-9]+/i);
  assert.doesNotMatch(migration, /eyJ[a-zA-Z0-9_-]+\./);
});

test('transport calls only the explicit Lighthouse Domain 3 receipt RPC', () => {
  assert.match(migration, /register_live_data_signal_receipt_v1/);
  assert.doesNotMatch(migration, /detected_signals/);
  assert.doesNotMatch(migration, /live_signals[^_]/);
  assert.doesNotMatch(migration, /findings/);
  assert.doesNotMatch(migration, /cases/);
});

test('transport preserves the complete evidence-bound candidate contract', () => {
  for (const token of [
    "'source_event_refs'",
    "'entity_ids'",
    "'entity_resolution_status'",
    "'severity'",
    "'confidence_score'",
    "'supporting_statistics'",
    "'detection_rule_id'",
    "'detection_rule_version'",
    "'engine_id'",
    "'engine_version'",
    "'source_freshness_at'",
    "'governance_status', 'observation_candidate'",
  ]) {
    assert.match(migration, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('transport parses explicit receipt shapes and rejects missing identity', () => {
  assert.match(migration, /jsonb_typeof\(v_body\) = 'object'/);
  assert.match(migration, /jsonb_typeof\(v_body\) = 'array'/);
  assert.match(migration, /jsonb_typeof\(v_body\) = 'string'/);
  assert.match(migration, /contains no live_data_signal_id/);
});

test('transport records bridged, idempotent, and failed candidate receipts', () => {
  assert.match(migration, /v_bridged := v_bridged \+ 1/);
  assert.match(migration, /v_idempotent := v_idempotent \+ 1/);
  assert.match(migration, /v_failed := v_failed \+ 1/);
  assert.match(migration, /lighthouse_status = 'bridged'/);
  assert.match(migration, /lighthouse_status = 'failed'/);
  assert.match(migration, /atlas_database_http_receipt_v1/);
});

test('Node scheduler remains owner and delegates transport execution', () => {
  // Bridge service orchestrates detection and attempts database-side transport first
  assert.match(service, /detect_propublica_unresolved_metadata_v1/);
  assert.match(service, /bridge_live_data_signal_candidates_v1/);
  // Bridge service delegates Lighthouse communication to liveDataSignalTransport.js
  // but exposes parseRegistrationReceipt for the register_live_data_signal_receipt_v1 contract
  assert.match(service, /parseRegistrationReceipt/);
  assert.match(service, /register_live_data_signal_receipt_v1/);
  // Bridge service itself does NOT hold Lighthouse credentials — those live in the transport layer
  assert.doesNotMatch(service, /LIGHTHOUSE_SUPABASE_URL/);
  assert.doesNotMatch(service, /LIGHTHOUSE_SERVICE_ROLE_KEY/);
});

test('database transport is service-role-only', () => {
  assert.match(
    migration,
    /revoke all on function public\.bridge_live_data_signal_candidates_v1\(uuid, integer\)[\s\S]*from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.bridge_live_data_signal_candidates_v1\(uuid, integer\)[\s\S]*to service_role/i,
  );
});