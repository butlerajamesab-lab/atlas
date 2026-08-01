import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(
  new URL('../src/schema/20260731_domain3_candidate_identity_receipt.sql', import.meta.url),
  'utf8',
);
const transportMigration = fs.readFileSync(
  new URL('../src/schema/20260731_domain3_database_http_transport.sql', import.meta.url),
  'utf8',
);
const bridge = fs.readFileSync(
  new URL('../src/services/liveDataSignalBridgeService.js', import.meta.url),
  'utf8',
);

test('candidate identity excludes adapter replay time', () => {
  assert.match(migration, /candidate_identity_version', '1\.1\.0'/);
  assert.match(migration, /max\(source_observed_at\) as source_freshness_at/);
  assert.match(migration, /source_freshness_basis', 'maximum stable source event timestamp'/);
  const identityBlock = migration.match(/'candidate_identity_version', '1\.1\.0'[\s\S]*?\) as source_input_hash/);
  assert.ok(identityBlock, 'source input hash block must exist');
  assert.doesNotMatch(identityBlock[0], /last_seen_at|clock_timestamp\(\)/);
});

test('candidate rule and engine versions change with identity semantics', () => {
  assert.match(migration, /rule_version = '1\.0\.0'/);
  assert.match(migration, /'1\.1\.0',\n  'elevated_unresolved_record_rate'/);
  assert.match(migration, /'atlas\.live_data_signal_exact',\n        '1\.1\.0'/);
  assert.match(migration, /superseded_by_candidate_identity_version_1\.1\.0/);
});

test('database-owned bridge uses the explicit Lighthouse JSON receipt contract', () => {
  assert.match(transportMigration, /register_live_data_signal_receipt_v1/);
  assert.match(transportMigration, /live_data_signal_id/);
  assert.match(transportMigration, /contains no live_data_signal_id/);
  assert.doesNotMatch(transportMigration, /register_live_data_signal_v1'/);
  assert.match(bridge, /bridge_live_data_signal_candidates_v1/);
  assert.doesNotMatch(bridge, /LIGHTHOUSE_SERVICE_ROLE_KEY|LIGHTHOUSE_SUPABASE_URL/);
});
