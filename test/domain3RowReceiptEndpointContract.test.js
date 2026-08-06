import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(
  new URL('../src/schema/20260806_domain3_row_receipt_endpoint.sql', import.meta.url),
  'utf8',
);

test('migration requires the governed bridge before changing its endpoint', () => {
  assert.match(migration, /bridge_live_data_signal_candidates_v1\(uuid,integer\)/);
  assert.match(migration, /governed Domain 3 bridge function is missing/);
  assert.match(migration, /pg_get_functiondef/);
});

test('migration changes only the Lighthouse receipt response contract', () => {
  assert.match(migration, /register_live_data_signal_receipt_v1/);
  assert.match(migration, /register_live_data_signal_transport_receipt_v1/);
  assert.match(migration, /v_definition := replace/);
  assert.doesNotMatch(migration, /insert\s+into\s+atlas\.live_data_signal_candidate/i);
  assert.doesNotMatch(migration, /insert\s+into\s+public\.live_data_signals/i);
  assert.doesNotMatch(migration, /detected_signals/i);
  assert.doesNotMatch(migration, /live_signals\b/i);
});

test('migration is replay-safe and service-role-only', () => {
  assert.match(migration, /if position\('register_live_data_signal_transport_receipt_v1'/);
  assert.match(migration, /return;/);
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
});
