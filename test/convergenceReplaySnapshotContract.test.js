import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../src/schema/20260804_convergence_replay_snapshot_contract.sql', import.meta.url),
  'utf8',
);

test('replay transport exposes records and does not leak records_json', () => {
  assert.match(migration, /'records',\s*snapshot\.records_json/i);
  assert.doesNotMatch(migration, /to_jsonb\(snapshot\)/i);
  assert.match(migration, /'record_count',\s*snapshot\.record_count/i);
  assert.match(migration, /order by snapshot\.snapshot_type/i);
});

test('replay function remains service-role-only with pinned search path', () => {
  assert.match(migration, /set search_path = pg_catalog, public, atlas/i);
  assert.match(
    migration,
    /revoke all on function public\.atlas_convergence_get_replay_bundle_v1\(text\)[\s\S]*from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.atlas_convergence_get_replay_bundle_v1\(text\)[\s\S]*to service_role/i,
  );
});
