import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../src/schema/20260801_convergence_persistence.sql', import.meta.url), 'utf8');
const timeoutMigration = readFileSync(new URL('../src/schema/20260801_convergence_persistence_timeout.sql', import.meta.url), 'utf8');

test('migration defines canonical population pagination joined to identity ledger', () => {
  assert.match(migration, /atlas_convergence_source_population_page_v1/);
  assert.match(migration, /join atlas\.signal_event_identity identity/);
  assert.match(migration, /identity\.canonical_offset = event\.offset/);
  assert.match(migration, /order by event\.stream_id, event\.offset/);
  assert.match(migration, /p_after_stream_id/);
});

test('persistence is atomic and receipt identity is output-bound', () => {
  assert.match(migration, /atlas_convergence_persist_run_v1\(p_bundle jsonb\)/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /receipt_identity/);
  assert.match(migration, /input_hash/);
  assert.match(migration, /output_hash/);
  assert.doesNotMatch(migration, /p_receipt_identity:\s*receipt\.input_hash/);
});

test('all convergence tables are immutable and forced through RLS', () => {
  for (const table of [
    'geography_registry_snapshot',
    'convergence_run_manifest',
    'convergence_signal_snapshot',
    'convergence_receipt',
    'convergence_result_payload',
  ]) {
    assert.match(migration, new RegExp(`alter table atlas\\.${table} force row level security`, 'i'));
    assert.match(migration, new RegExp(`atlas\\.${table}.*immutable|${table}_immutable`, 'is'));
  }
});

test('security-definer RPCs pin search_path and expose only service_role execution', () => {
  const securityDefiners = migration.match(/security definer/g) ?? [];
  const fixedPaths = migration.match(/set search_path = pg_catalog, public, atlas/g) ?? [];
  assert.ok(securityDefiners.length >= 4);
  assert.equal(fixedPaths.length, securityDefiners.length);
  assert.doesNotMatch(migration, /to authenticated using \(true\)/i);
  assert.doesNotMatch(migration, /for all to service_role/i);
  assert.match(migration, /grant execute on function public\.atlas_convergence_persist_run_v1\(jsonb\)\s+to service_role/i);
});

test('idempotent replay rejects changed governed content', () => {
  assert.match(migration, /already exists with different governed content/);
  assert.match(migration, /payload_json is distinct from/);
  assert.match(migration, /source_population_hash is distinct from/);
});

test('large atomic persistence receives a function-local timeout only', () => {
  assert.match(
    timeoutMigration,
    /alter function public\.atlas_convergence_persist_run_v1\(jsonb\)\s+set statement_timeout = '120s'/i,
  );
  assert.doesNotMatch(timeoutMigration, /alter role|alter database|set statement_timeout\s*=\s*0/i);
});
