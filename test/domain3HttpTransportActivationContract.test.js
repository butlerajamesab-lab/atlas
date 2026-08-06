import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(
  new URL('../src/schema/20260806_domain3_http_transport_activation.sql', import.meta.url),
  'utf8',
);

test('activation installs the synchronous HTTP prerequisite and governed bridge', () => {
  assert.match(migration, /create extension if not exists http with schema extensions/i);
  assert.match(migration, /create or replace function public\.bridge_live_data_signal_candidates_v1/);
  assert.match(migration, /extensions\.http_response/);
  assert.match(migration, /extensions\.http_request/);
  assert.match(migration, /extensions\.http_header/);
  assert.match(migration, /from extensions\.http\(/);
});

test('activation uses only the explicit Lighthouse Domain 3 receipt boundary', () => {
  assert.match(migration, /atlas_bridge_config_for\('atlas-to-lighthouse'\)/);
  assert.match(migration, /register_live_data_signal_receipt_v1/);
  assert.doesNotMatch(migration, /insert\s+into\s+(?:public\.)?detected_signals/i);
  assert.doesNotMatch(migration, /insert\s+into\s+(?:public\.)?live_signals\b/i);
  assert.doesNotMatch(migration, /insert\s+into\s+(?:public\.)?findings\b/i);
  assert.doesNotMatch(migration, /insert\s+into\s+(?:public\.)?cases\b/i);
});

test('activation preserves complete evidence-bound candidate data', () => {
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

test('activation is additive, secret-safe, and service-role-only', () => {
  assert.doesNotMatch(migration, /^\s*delete\s+from\b/im);
  assert.doesNotMatch(migration, /^\s*truncate\b/im);
  assert.doesNotMatch(migration, /^\s*drop\s+(?:table|view|schema|function|trigger|index)\b/im);
  assert.doesNotMatch(migration, /sbp_[a-z0-9]+/i);
  assert.doesNotMatch(migration, /eyJ[a-zA-Z0-9_-]+\./);
  assert.match(
    migration,
    /revoke all on function public\.bridge_live_data_signal_candidates_v1\(uuid, integer\)[\s\S]*from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.bridge_live_data_signal_candidates_v1\(uuid, integer\)[\s\S]*to service_role/i,
  );
});
