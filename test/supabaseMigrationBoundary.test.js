import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  canonicalPatternViolations,
  classifyDatabaseBearingPath,
  orderedLedgerDigest,
  validateRepository,
} from '../scripts/validate-supabase-migrations.mjs';

test('Atlas SQL inventory and canonical readiness state are internally exact', () => {
  const result = validateRepository();
  assert.deepEqual(result.errors, []);
  assert.equal(
    result.discoveredSqlCount,
    result.manifest.noncanonicalInputs.length +
      result.manifest.validationSql.length +
      result.manifest.canonical.migrations.length,
  );
  assert.equal(result.manifest.noncanonicalInputs.length, 40);
  assert.equal(result.compactLedgerRowCount, 49);
  if (result.manifest.canonical.status === 'blocked') {
    assert.equal(result.canonicalMigrationCount, 0);
    assert.ok(result.openBlockerCount >= 1);
  } else {
    assert.ok(result.canonicalMigrationCount >= 1);
    assert.equal(result.openBlockerCount, 0);
  }
});

test('compact production ledger preserves exact order and digest without raw statements', async () => {
  const receipt = JSON.parse(
    await readFile(
      new URL('../supabase/evidence/production-migration-ledger.json', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(receipt.rows.length, 49);
  assert.equal(receipt.rows[0].version, '20260513203455');
  assert.equal(receipt.rows.at(-1).version, '20260822082205');
  assert.equal(orderedLedgerDigest(receipt.rows), receipt.orderedLedgerSha256);
  assert.equal('statements' in receipt.rows[0], false);
});

test('path classifier catches SQL and every migration-boundary control file', () => {
  for (const repositoryPath of [
    'outside-the-known-roots/change.sql',
    'src/schema/new-contract.txt',
    'sql/openstates/runbook.md',
    'supabase/config.toml',
    'scripts/apply-sql-management-api.mjs',
    'scripts/validate-supabase-migrations.mjs',
    '.github/workflows/database-migration-gate.yml',
    'package.json',
  ]) {
    assert.equal(classifyDatabaseBearingPath(repositoryPath), true, repositoryPath);
  }
  assert.equal(classifyDatabaseBearingPath('src/services/scheduler.js'), false);
  assert.equal(classifyDatabaseBearingPath('docs/ATLAS_DOMAIN_SPACE_CONTRACT.md'), false);
});

test('canonical migrations reject transient payloads and runtime file inclusion', () => {
  const examples = [
    'select content from net._http_response where id = 146;',
    "select pg_read_file('/tmp/migration.sql');",
    "copy x from program 'curl https://example.invalid';",
    '\\ir ../untracked.sql',
  ];
  for (const sql of examples) assert.notDeepEqual(canonicalPatternViolations(sql), []);
  assert.deepEqual(
    canonicalPatternViolations('create table public.safe_example(id bigint primary key);'),
    [],
  );
});

test('legacy Management API path is explicit break-glass and has no production default', async () => {
  const script = await readFile(
    new URL('../scripts/apply-sql-management-api.mjs', import.meta.url),
    'utf8',
  );
  assert.match(script, /ATLAS_BREAK_GLASS_SQL_APPLY/);
  assert.match(script, /ATLAS_BREAK_GLASS_SQL_SHA256/);
  assert.match(script, /SUPABASE_PROJECT_REF is required/);
  assert.doesNotMatch(script, /\|\|\s*['"]bjdjjgnkhxblnpdrjqtw['"]/);
});

test('workflow exposes one stable fail-closed database check', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/database-migration-gate.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /^name: database-migration-gate$/m);
  assert.match(workflow, /^  database-migration-gate:$/m);
  assert.match(workflow, /^    name: database-migration-gate$/m);
  assert.match(workflow, /run: supabase start/);
  assert.match(workflow, /supabase db lint --local --fail-on error/);
  assert.match(workflow, /supabase migration list --local/);
  assert.match(workflow, /supabase migration up --local/);
  assert.match(workflow, /diff --unified/);
  assert.doesNotMatch(workflow, /supabase db start|--level error/);
});
