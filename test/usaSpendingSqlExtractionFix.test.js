import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationPath = new URL(
  '../src/schema/20260730_event_entity_resolution_usaspending_extraction_fix.sql',
  import.meta.url,
);

test('USAspending SQL extraction fix is additive and self-verifying', async () => {
  const sql = await readFile(migrationPath, 'utf8');

  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.atlas_event_entity_source_value_v1/);
  assert.match(sql, /BATTELLE MEMORIAL INSTITUTE/);
  assert.match(sql, /EXAMPLE FOUNDATION/);
  assert.match(sql, /SAMPLE ORG/);
  assert.match(sql, /DO \$verify\$/);
  assert.match(sql, /BEGIN;/);
  assert.match(sql, /COMMIT;/);

  assert.doesNotMatch(sql, /^\s*DROP\s+/im);
  assert.doesNotMatch(sql, /^\s*DELETE\s+FROM\b/im);
  assert.doesNotMatch(sql, /^\s*TRUNCATE\b/im);
});

test('USAspending SQL extraction fix avoids the failed non-greedy POSIX branch', async () => {
  const sql = await readFile(migrationPath, 'utf8');

  assert.doesNotMatch(sql, /\.\*\?/);
  assert.match(sql, /\(\.\+\)\[\[:space:\]\]\+\[—–-\]\[\[:space:\]\]\+\\\$\.\*\$/);
  assert.match(sql, /IF v_match IS NULL THEN/);
  assert.match(sql, /RETURN NULLIF\(btrim\(v_match\[2\]\), ''\)/);
});
