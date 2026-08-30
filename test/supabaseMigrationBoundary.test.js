import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  appendFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  canonicalPatternViolations,
  canonicalStateViolations,
  changedPathsFrom,
  classifyDatabaseBearingPath,
  orderedLedgerDigest,
  validateRepository,
} from '../scripts/validate-supabase-migrations.mjs';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

function git(repositoryDirectory, args) {
  return execFileSync('git', args, {
    cwd: repositoryDirectory,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function initializeGitRepository(repositoryDirectory) {
  git(repositoryDirectory, ['init', '-q']);
  git(repositoryDirectory, ['config', 'user.email', 'atlas-validator@example.invalid']);
  git(repositoryDirectory, ['config', 'user.name', 'Atlas Validator Test']);
}

async function createValidatorFixture(t) {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'atlas-validator-'));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));

  const manifest = JSON.parse(
    await readFile(path.join(repositoryRoot, 'supabase/migration-manifest.json'), 'utf8'),
  );
  manifest.canonical.status = 'blocked';
  manifest.canonical.migrations = [];
  manifest.productionEvidence.ledgerReconciliationStatus = 'blocked';
  const baselineBlocker = manifest.blockers.find(
    (blocker) => blocker.id === 'production_schema_baseline_missing',
  );
  if (baselineBlocker) baselineBlocker.status = 'open';
  const inventoryPaths = [
    ...(manifest.validationSql ?? []),
    ...(manifest.noncanonicalInputs ?? []),
  ].map((entry) => entry.path);
  const requiredPaths = new Set([
    'scripts/validate-supabase-migrations.mjs',
    'supabase/config.toml',
    manifest.productionEvidence.compactLedgerPath,
    ...inventoryPaths,
  ]);

  for (const relativePath of requiredPaths) {
    const destination = path.join(fixtureRoot, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(repositoryRoot, relativePath), destination);
  }

  const fixtureManifestPath = path.join(fixtureRoot, 'supabase/migration-manifest.json');
  await mkdir(path.dirname(fixtureManifestPath), { recursive: true });
  await writeFile(fixtureManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return { fixtureRoot, manifest };
}

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
  } else if (result.manifest.canonical.status === 'candidate') {
    assert.ok(result.canonicalMigrationCount >= 1);
    assert.equal(result.manifest.canonical.migrations[0].kind, 'production_baseline');
    assert.equal(
      result.manifest.productionEvidence.ledgerReconciliationStatus,
      'reconstructed_pending_preview_parity',
    );
  } else {
    assert.ok(result.canonicalMigrationCount >= 1);
    assert.equal(result.openBlockerCount, 0);
  }
});

test('candidate baseline is replayable while preview parity remains pending', async (t) => {
  const { fixtureRoot, manifest } = await createValidatorFixture(t);
  const migrationPath = 'supabase/migrations/20260830190000_production_baseline.sql';
  const migrationSql = 'create table public.candidate_baseline_probe(id bigint primary key);\n';
  const migrationHash = createHash('sha256').update(migrationSql).digest('hex');

  await mkdir(path.dirname(path.join(fixtureRoot, migrationPath)), { recursive: true });
  await writeFile(path.join(fixtureRoot, migrationPath), migrationSql);
  manifest.canonical.status = 'candidate';
  manifest.canonical.migrations = [{
    path: migrationPath,
    sha256: migrationHash,
    kind: 'production_baseline',
  }];
  manifest.productionEvidence.ledgerReconciliationStatus =
    'reconstructed_pending_preview_parity';
  await writeFile(
    path.join(fixtureRoot, 'supabase/migration-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  const result = validateRepository({ repositoryRoot: fixtureRoot });
  assert.deepEqual(result.errors, []);
  assert.equal(result.canonicalMigrationCount, 1);
});

test('candidate contract requires a production baseline and pending preview parity', () => {
  const validCandidate = {
    status: 'candidate',
    canonicalEntries: [{ kind: 'production_baseline' }],
    openBlockers: [{ status: 'open' }],
    ledgerReconciliationStatus: 'reconstructed_pending_preview_parity',
  };
  assert.deepEqual(canonicalStateViolations(validCandidate), []);
  assert.match(
    canonicalStateViolations({ ...validCandidate, canonicalEntries: [] }).join('\n'),
    /candidate canonical root must contain migrations/,
  );
  assert.match(
    canonicalStateViolations({
      ...validCandidate,
      canonicalEntries: [{ kind: 'incremental_overlay' }],
    }).join('\n'),
    /first canonical migration must be kind=production_baseline/,
  );
  assert.match(
    canonicalStateViolations({
      ...validCandidate,
      ledgerReconciliationStatus: 'reconciled',
    }).join('\n'),
    /candidate canonical root requires ledger status reconstructed_pending_preview_parity/,
  );
});

test('ready state requires a hash-bound hosted preview acceptance receipt', async (t) => {
  const { fixtureRoot, manifest } = await createValidatorFixture(t);
  const migrationPath = 'supabase/migrations/20260830190000_production_baseline.sql';
  const migrationSql = 'create table public.ready_baseline_probe(id bigint primary key);\n';
  const migrationHash = createHash('sha256').update(migrationSql).digest('hex');
  await mkdir(path.dirname(path.join(fixtureRoot, migrationPath)), { recursive: true });
  await writeFile(path.join(fixtureRoot, migrationPath), migrationSql);
  manifest.canonical.status = 'ready';
  manifest.canonical.migrations = [{
    path: migrationPath,
    version: '20260830190000',
    name: 'production_baseline',
    kind: 'production_baseline',
    sha256: migrationHash,
  }];
  manifest.productionEvidence.ledgerReconciliationStatus = 'reconciled';
  for (const blocker of manifest.blockers) blocker.status = 'resolved';
  delete manifest.acceptanceEvidence;
  await writeFile(
    path.join(fixtureRoot, 'supabase/migration-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  const result = validateRepository({ repositoryRoot: fixtureRoot });
  assert.match(
    result.errors.join('\n'),
    /ready canonical chain requires supabase\/evidence\/hosted-preview-acceptance\.json/,
  );
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
    'scripts/verify-atlas-acceptance.mjs',
    '.github/workflows/database-migration-gate.yml',
    'package.json',
  ]) {
    assert.equal(classifyDatabaseBearingPath(repositoryPath), true, repositoryPath);
  }
  assert.equal(classifyDatabaseBearingPath('src/services/scheduler.js'), false);
  assert.equal(classifyDatabaseBearingPath('docs/ATLAS_DOMAIN_SPACE_CONTRACT.md'), false);
});

test('changed path discovery includes deleted database-bearing files', async (t) => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'atlas-deletion-diff-'));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  initializeGitRepository(fixtureRoot);

  const deletedPath = 'supabase/migrations/20260830190100_deleted_probe.sql';
  await mkdir(path.dirname(path.join(fixtureRoot, deletedPath)), { recursive: true });
  await writeFile(path.join(fixtureRoot, deletedPath), 'select 1;\n');
  git(fixtureRoot, ['add', '.']);
  git(fixtureRoot, ['commit', '-qm', 'add database probe']);
  const baseRevision = git(fixtureRoot, ['rev-parse', 'HEAD']);

  await unlink(path.join(fixtureRoot, deletedPath));
  git(fixtureRoot, ['add', '-A']);
  git(fixtureRoot, ['commit', '-qm', 'delete database probe']);

  const changeSet = changedPathsFrom(baseRevision, fixtureRoot);
  assert.equal(changeSet.conservative, false);
  assert.deepEqual(changeSet.paths, [deletedPath]);
  assert.equal(changeSet.paths.some(classifyDatabaseBearingPath), true);
});

test('--changed-from classifies without implicitly requiring ready status', async (t) => {
  const { fixtureRoot } = await createValidatorFixture(t);
  initializeGitRepository(fixtureRoot);
  git(fixtureRoot, ['add', '.']);
  git(fixtureRoot, ['commit', '-qm', 'create blocked fixture']);
  const baseRevision = git(fixtureRoot, ['rev-parse', 'HEAD']);

  await appendFile(
    path.join(fixtureRoot, 'supabase/config.toml'),
    '\n# Database-bearing classifier fixture.\n',
  );
  git(fixtureRoot, ['add', 'supabase/config.toml']);
  git(fixtureRoot, ['commit', '-qm', 'change database boundary']);

  const output = execFileSync(
    process.execPath,
    [
      path.join(fixtureRoot, 'scripts/validate-supabase-migrations.mjs'),
      '--changed-from',
      baseRevision,
      '--json',
    ],
    { cwd: fixtureRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const summary = JSON.parse(output);
  assert.equal(summary.ok, true);
  assert.equal(summary.databaseChanged, true);
  assert.equal(summary.baselineStatus, 'blocked');
});

test('canonical migrations reject hard-coded transient payloads and runtime file inclusion', () => {
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
  assert.deepEqual(
    canonicalPatternViolations(`
      select response.*
        into v_response
        from net._http_response response
       where response.id = v_attempt.request_id;
    `),
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

test('baseline excludes platform-owned defaults and hardens future app objects', async () => {
  const baseline = await readFile(
    new URL(
      '../supabase/migrations/20260513203455_canonical_jurisdiction_and_workflow_registries.sql',
      import.meta.url,
    ),
    'utf8',
  );
  assert.doesNotMatch(
    baseline,
    /alter default privileges for role "?supabase_admin"?/i,
  );
  for (const schema of ['atlas', 'public', 'private']) {
    assert.match(
      baseline,
      new RegExp(
        `alter default privileges for role postgres in schema ${schema} ` +
        'revoke execute on functions from PUBLIC, anon, authenticated;',
      ),
    );
    assert.match(
      baseline,
      new RegExp(
        `alter default privileges for role postgres in schema ${schema} ` +
        'revoke all on tables from PUBLIC, anon, authenticated;',
      ),
    );
  }
  assert.match(
    baseline,
    /grant select on table atlas\.v_bridge_operational_status to service_role;/,
  );
  assert.match(
    baseline,
    /revoke select on table public\.v_bridge_operational_status from PUBLIC, anon, authenticated;/,
  );
});

test('workflow exposes one stable fail-closed database check', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/database-migration-gate.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /^name: database-migration-gate$/m);
  assert.match(workflow, /^  database-replay-evidence:$/m);
  assert.match(workflow, /^    name: database-replay-evidence$/m);
  assert.match(workflow, /^  database-migration-gate:$/m);
  assert.match(workflow, /^    name: database-migration-gate$/m);
  assert.match(workflow, /run: supabase start/);
  assert.match(workflow, /supabase db lint --local --fail-on error/);
  assert.match(workflow, /supabase migration list --local/);
  assert.match(workflow, /supabase migration up --local/);
  assert.match(workflow, /diff --unified/);
  assert.match(workflow, /baseline_status == 'candidate'/);
  assert.match(workflow, /baseline_status == 'ready'/);
  assert.match(
    workflow,
    /Verify accepted candidate ancestry and replay attestation/,
  );
  assert.match(workflow, /run: npm run db:verify-acceptance/);
  assert.match(workflow, /run: npm run db:require-ready/);
  assert.ok(
    workflow.indexOf('Require reviewed ready baseline for database changes') >
      workflow.indexOf('Repeat clean replay to detect dirty or order-dependent state'),
  );
  const classificationStep = workflow.slice(
    workflow.indexOf('Classify database-bearing paths'),
    workflow.indexOf('Install pinned Supabase CLI'),
  );
  assert.doesNotMatch(classificationStep, /--require-ready/);
  assert.doesNotMatch(workflow, /supabase db start|--level error/);
});
