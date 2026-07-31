import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(
  new URL('../src/schema/20260731_domain3_candidate_identity_receipt.sql', import.meta.url),
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

test('bridge uses the explicit Lighthouse JSON receipt contract', () => {
  assert.match(bridge, /register_live_data_signal_receipt_v1/);
  assert.match(bridge, /parseRegistrationReceipt/);
  assert.match(bridge, /live_data_signal_id/);
  assert.doesNotMatch(bridge, /register_live_data_signal_v1'/);
});