import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(
  new URL('../src/schema/20260806_domain3_row_receipt_endpoint.sql', import.meta.url),
  'utf8',
);

test('transport requires separate gateway and scoped receipt credentials', () => {
  assert.match(migration, /config\.target_service_key/);
  assert.match(migration, /config\.config_json->>'domain3_receipt_token'/);
  assert.match(migration, /scoped Domain 3 receipt token is missing/);
  assert.match(migration, /length\(v_config\.domain3_receipt_token\)/);
});

test('transport calls only the scoped Lighthouse receipt endpoint', () => {
  assert.match(migration, /register_live_data_signal_transport_receipt_v2/);
  assert.match(migration, /'p_bridge_token', v_config\.domain3_receipt_token/);
  assert.match(migration, /http_header\('apikey', v_config\.target_service_key\)/);
  assert.doesNotMatch(migration, /http_header\('Authorization'/);
  assert.doesNotMatch(migration, /register_live_data_signal_receipt_v1/);
});

test('transport preserves the complete canonical candidate contract', () => {
  for (const token of [
    "'source_event_refs'",
    "'entity_ids'",
    "'entity_resolution_status'",
    "'severity'",
    "'confidence_score'",
    "'verification_state'",
    "'supporting_statistics'",
    "'evidence_refs'",
    "'detection_rule_id'",
    "'detection_rule_version'",
    "'engine_id'",
    "'engine_version'",
    "'source_freshness_at'",
    "'detected_at'",
    "'governance_status', 'observation_candidate'",
  ]) {
    assert.match(migration, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('transport remains additive and service-role executed inside Atlas', () => {
  assert.match(
    migration,
    /revoke all on function public\.bridge_live_data_signal_candidates_v1\(uuid, integer\)[\s\S]*from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.bridge_live_data_signal_candidates_v1\(uuid, integer\)[\s\S]*to service_role/i,
  );
  assert.doesNotMatch(migration, /^\s*delete\s+from\b/im);
  assert.doesNotMatch(migration, /^\s*truncate\b/im);
  assert.doesNotMatch(migration, /^\s*drop\s+(?:table|view|schema|function|trigger|index)\b/im);
  assert.doesNotMatch(migration, /sLaqVvylvMyctybqokeDrP8j1yb42o2Mkkjh08bazaENlMiKtURCK_YHkeLuP5Ju/);
});
