import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../src/schema/20260804_convergence_source_identity_stability.sql', import.meta.url),
  'utf8',
);

test('governed source population excludes mutable replay telemetry', () => {
  assert.doesNotMatch(migration, /'replay_count'/i);
  assert.doesNotMatch(migration, /'last_seen_at'/i);
  assert.doesNotMatch(migration, /'latest_historical_offset'/i);
  assert.doesNotMatch(migration, /'historical_event_count'/i);
});

test('governed source population preserves immutable event identity', () => {
  assert.match(migration, /'event_identity_hash',\s*identity\.event_identity_hash/i);
  assert.match(migration, /'canonical_offset',\s*identity\.canonical_offset::text/i);
  assert.match(migration, /'source_record_key',\s*identity\.source_record_key/i);
  assert.match(migration, /'first_seen_at',\s*identity\.first_seen_at/i);
  assert.match(migration, /'source_timestamp',\s*identity\.source_timestamp/i);
});

test('source population function remains service-role-only', () => {
  assert.match(migration, /set search_path = pg_catalog, public, atlas/i);
  assert.match(migration, /from public, anon, authenticated/i);
  assert.match(migration, /to service_role/i);
});
