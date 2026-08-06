import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(
  new URL('../src/schema/20260806_domain3_row_receipt_endpoint.sql', import.meta.url),
  'utf8',
);

test('transport requires the Lighthouse target and separate scoped receipt token', () => {
  assert.match(migration, /config\.target_url/);
  assert.match(migration, /config\.config_json->>'domain3_receipt_token'/);
  assert.match(migration, /scoped Domain 3 receipt token is missing/);
  assert.match(migration, /length\(v_config\.domain3_receipt_token\)/);
  assert.doesNotMatch(migration, /target_service_key/);
});

test('transport calls only the bounded Lighthouse direct PostgreSQL route', () => {
  assert.match(migration, /\/api\/atlas-domain3\/receipt/);
  assert.match(migration, /x-atlas-domain3-token/);
  assert.match(migration, /v_record::text/);
  assert.match(migration, /atlas_lighthouse_direct_postgres_receipt_v1/);
  assert.doesNotMatch(migration, /\/rest\/v1\/rpc\//);
  assert.doesNotMatch(migration, /http_header\('apikey'/);
  assert.doesNotMatch(migration, /http_header\('Authorization'/);
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

test('transport requires an explicit canonical receipt before marking a candidate bridged', () => {
  assert.match(migration, /coalesce\(\(v_body->>'ok'\)::boolean, false\) is not true/);
  assert.match(migration, /v_body->>'live_data_signal_id'/);
  assert.match(migration, /v_body->>'signal_hash'/);
  assert.match(migration, /v_body->>'governance_status'/);
  assert.match(migration, /lighthouse_status = 'bridged'/);
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
