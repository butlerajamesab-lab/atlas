import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPOSITORY_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const MANIFEST_PATH = 'supabase/migration-manifest.json';
const CONFIG_PATH = 'supabase/config.toml';
const CANONICAL_ROOT = 'supabase/migrations';
const COMPACT_LEDGER_PATH = 'supabase/evidence/production-migration-ledger.json';
const MIGRATION_NAME = /^(\d{14})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;
const SHA256 = /^[a-f0-9]{64}$/;
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.branches',
  '.temp',
  'coverage',
  'dist',
  'node_modules',
]);

const PROHIBITED_CANONICAL_PATTERNS = [
  {
    id: 'transient_http_response',
    pattern: /\bnet\._http_response\b/i,
    reason: 'migration SQL must not depend on transient pg_net response rows',
  },
  {
    id: 'server_file_read',
    pattern: /\b(?:pg_read_file|pg_read_binary_file|lo_import)\s*\(/i,
    reason: 'migration SQL must be self-contained and may not read server files',
  },
  {
    id: 'copy_program',
    pattern: /\bcopy\b[\s\S]{0,500}\bprogram\b/i,
    reason: 'migration SQL must not execute operating-system programs',
  },
  {
    id: 'psql_include',
    pattern: /^\s*\\(?:i|ir|include|include_relative)\b/im,
    reason: 'migration SQL must not include untracked files at runtime',
  },
];

function normalizeRepositoryPath(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}

function walkSqlFiles(absoluteDirectory, repositoryRoot = REPOSITORY_ROOT) {
  if (!existsSync(absoluteDirectory)) return [];

  const found = [];
  for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
    const absolutePath = path.join(absoluteDirectory, entry.name);
    if (entry.isDirectory()) {
      found.push(...walkSqlFiles(absolutePath, repositoryRoot));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.sql')) {
      found.push(normalizeRepositoryPath(path.relative(repositoryRoot, absolutePath)));
    }
  }
  return found.sort();
}

function sha256File(repositoryPath, repositoryRoot = REPOSITORY_ROOT) {
  const bytes = readFileSync(path.join(repositoryRoot, repositoryPath));
  return createHash('sha256').update(bytes).digest('hex');
}

function orderedLedgerDigest(rows) {
  const encoded = rows
    .map((row) => [
      row.version,
      row.name,
      row.statementsSha256,
      row.rollbackSha256,
    ].join('\x1f'))
    .join('\x1e');
  return createHash('sha256').update(encoded).digest('hex');
}

function parseTomlSubset(text) {
  let section = '';
  const values = new Map();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '').trim();
    if (!line) continue;
    const sectionMatch = line.match(/^\[([^\]]+)]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    const valueMatch = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!valueMatch) continue;
    const key = section ? `${section}.${valueMatch[1]}` : valueMatch[1];
    const encoded = valueMatch[2].trim();
    let value = encoded;
    if (/^"(?:[^"\\]|\\.)*"$/.test(encoded)) value = JSON.parse(encoded);
    else if (/^-?\d+$/.test(encoded)) value = Number(encoded);
    else if (encoded === 'true' || encoded === 'false') value = encoded === 'true';
    else if (encoded === '[]') value = [];
    values.set(key, value);
  }
  return values;
}

function classifyDatabaseBearingPath(repositoryPath) {
  const value = normalizeRepositoryPath(repositoryPath);
  if (value.toLowerCase().endsWith('.sql')) return true;
  if (
    value.startsWith('supabase/') ||
    value.startsWith('src/schema/') ||
    value.startsWith('sql/openstates/')
  ) return true;
  if (
    value === 'package.json' ||
    value === 'package-lock.json' ||
    value === 'scripts/apply-sql-management-api.mjs' ||
    value === 'scripts/validate-supabase-migrations.mjs'
  ) return true;
  return /^\.github\/workflows\/[^/]*(?:supabase|database|migration)[^/]*\.ya?ml$/i.test(value);
}

function changedPathsFrom(baseRevision, repositoryRoot = REPOSITORY_ROOT) {
  if (!baseRevision || /^0+$/.test(baseRevision)) {
    return { paths: [], conservative: true, reason: 'base revision is unavailable' };
  }
  try {
    const output = execFileSync(
      'git',
      ['diff', '--name-only', '--diff-filter=ACMR', `${baseRevision}...HEAD`],
      { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return {
      paths: output.split(/\r?\n/).filter(Boolean).map(normalizeRepositoryPath),
      conservative: false,
      reason: null,
    };
  } catch (error) {
    return {
      paths: [],
      conservative: true,
      reason: `could not diff ${baseRevision}: ${error.message}`,
    };
  }
}

function canonicalPatternViolations(sqlText) {
  return PROHIBITED_CANONICAL_PATTERNS
    .filter(({ pattern }) => pattern.test(sqlText))
    .map(({ id, reason }) => ({ id, reason }));
}

function validateRepository({
  repositoryRoot = REPOSITORY_ROOT,
  requireReady = false,
  remoteLedgerPath = null,
  requireRemoteParity = false,
} = {}) {
  const errors = [];
  const warnings = [];
  const manifestAbsolutePath = path.join(repositoryRoot, MANIFEST_PATH);
  const configAbsolutePath = path.join(repositoryRoot, CONFIG_PATH);

  if (!existsSync(manifestAbsolutePath)) {
    return { errors: [`missing ${MANIFEST_PATH}`], warnings, manifest: null };
  }
  if (!existsSync(configAbsolutePath)) {
    return { errors: [`missing ${CONFIG_PATH}`], warnings, manifest: null };
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestAbsolutePath, 'utf8'));
  } catch (error) {
    return { errors: [`invalid ${MANIFEST_PATH}: ${error.message}`], warnings, manifest: null };
  }

  if (manifest.schemaVersion !== 1) errors.push('manifest schemaVersion must be 1');
  if (manifest.canonical?.root !== CANONICAL_ROOT) {
    errors.push(`manifest canonical.root must be ${CANONICAL_ROOT}`);
  }
  if (!['blocked', 'ready'].includes(manifest.canonical?.status)) {
    errors.push('manifest canonical.status must be blocked or ready');
  }
  if (manifest.canonical?.postgresMajorVersion !== 17) {
    errors.push('manifest canonical.postgresMajorVersion must be 17');
  }
  const expectedSqlRoots = [
    ['supabase/migrations', 'canonical_migrations'],
    ['supabase/tests', 'validation_sql'],
    ['src/schema', 'noncanonical_input'],
    ['sql/openstates', 'noncanonical_input'],
  ];
  const declaredSqlRoots = (manifest.sqlRoots ?? []).map((root) => [root.path, root.classification]);
  if (JSON.stringify(declaredSqlRoots) !== JSON.stringify(expectedSqlRoots)) {
    errors.push('manifest sqlRoots must declare the four bounded Atlas SQL roots in canonical order');
  }

  const config = parseTomlSubset(readFileSync(configAbsolutePath, 'utf8'));
  const configExpectations = new Map([
    ['project_id', 'atlas'],
    ['db.major_version', 17],
    ['db.migrations.enabled', true],
    ['db.seed.enabled', false],
  ]);
  for (const [key, expected] of configExpectations) {
    if (config.get(key) !== expected) {
      errors.push(`${CONFIG_PATH} ${key} must equal ${JSON.stringify(expected)}`);
    }
  }
  if (config.get('db.port') === config.get('db.shadow_port')) {
    errors.push(`${CONFIG_PATH} db.port and db.shadow_port must differ`);
  }

  const productionEvidence = manifest.productionEvidence ?? {};
  if (!SHA256.test(productionEvidence.compactLedgerSha256 ?? '')) {
    errors.push('manifest productionEvidence.compactLedgerSha256 is invalid');
  }
  const compactLedgerPath = normalizeRepositoryPath(productionEvidence.compactLedgerPath ?? '');
  let compactLedger = null;
  if (!compactLedgerPath) {
    errors.push('manifest productionEvidence.compactLedgerPath is required');
  } else if (compactLedgerPath !== COMPACT_LEDGER_PATH) {
    errors.push(`manifest compact ledger path must be ${COMPACT_LEDGER_PATH}`);
  } else {
    const compactLedgerAbsolutePath = path.join(repositoryRoot, compactLedgerPath);
    if (!existsSync(compactLedgerAbsolutePath)) {
      errors.push(`compact production ledger is missing: ${compactLedgerPath}`);
    } else {
      const compactLedgerHash = sha256File(compactLedgerPath, repositoryRoot);
      if (compactLedgerHash !== productionEvidence.compactLedgerSha256) {
        errors.push(
          `compact production ledger hash mismatch: expected ` +
          `${productionEvidence.compactLedgerSha256}, got ${compactLedgerHash}`,
        );
      }
      try {
        compactLedger = JSON.parse(readFileSync(compactLedgerAbsolutePath, 'utf8'));
      } catch (error) {
        errors.push(`invalid compact production ledger: ${error.message}`);
      }
    }
  }

  if (compactLedger) {
    const rows = Array.isArray(compactLedger.rows) ? compactLedger.rows : [];
    if (!Array.isArray(compactLedger.rows)) errors.push('compact ledger rows must be an array');
    if (compactLedger.schemaVersion !== 1) errors.push('compact ledger schemaVersion must be 1');
    if (compactLedger.project?.ref !== productionEvidence.projectRef) {
      errors.push('compact ledger project ref differs from the manifest');
    }
    if (compactLedger.project?.serverVersion !== productionEvidence.serverVersion) {
      errors.push('compact ledger server version differs from the manifest');
    }
    if (compactLedger.capturedAt !== productionEvidence.capturedAt) {
      errors.push('compact ledger capture time differs from the manifest');
    }
    if (compactLedger.repository?.observedDefaultBranchHead !== manifest.repository?.observedDefaultBranchHead) {
      errors.push('compact ledger repository head differs from the manifest');
    }
    if (rows.length !== productionEvidence.migrationCount || rows.length !== compactLedger.migrationCount) {
      errors.push('compact ledger row count differs from the declared migration count');
    }

    let previousVersion = null;
    const seenVersions = new Set();
    for (const row of rows) {
      if (!/^\d{14}$/.test(row.version ?? '')) errors.push(`invalid compact ledger version: ${row.version}`);
      if (typeof row.name !== 'string' || row.name.length === 0) {
        errors.push(`compact ledger row ${row.version ?? 'unknown'} has no name`);
      }
      if (/[\x1e\x1f]/.test(row.version ?? '') || /[\x1e\x1f]/.test(row.name ?? '')) {
        errors.push(`compact ledger row ${row.version ?? 'unknown'} contains a hash delimiter`);
      }
      if (!SHA256.test(row.statementsSha256 ?? '')) {
        errors.push(`compact ledger row ${row.version ?? 'unknown'} has invalid statements SHA-256`);
      }
      if (!SHA256.test(row.rollbackSha256 ?? '')) {
        errors.push(`compact ledger row ${row.version ?? 'unknown'} has invalid rollback SHA-256`);
      }
      if (seenVersions.has(row.version)) errors.push(`duplicate compact ledger version: ${row.version}`);
      if (previousVersion !== null && row.version <= previousVersion) {
        errors.push(`compact ledger versions are out of order at ${row.version}`);
      }
      seenVersions.add(row.version);
      previousVersion = row.version;
    }
    if (rows[0]?.version !== productionEvidence.firstVersion) {
      errors.push('compact ledger first version differs from the manifest');
    }
    if (rows.at(-1)?.version !== productionEvidence.lastVersion) {
      errors.push('compact ledger last version differs from the manifest');
    }
    const computedDigest = orderedLedgerDigest(rows);
    if (
      computedDigest !== compactLedger.orderedLedgerSha256 ||
      computedDigest !== productionEvidence.orderedLedgerSha256
    ) {
      errors.push(`compact ledger ordered digest mismatch: computed ${computedDigest}`);
    }
  }

  const dependencyClosure = manifest.foundationalDependencyClosure ?? {};
  if (dependencyClosure.relationCount !== 22) {
    errors.push('foundational dependency closure must account for exactly 22 relations');
  }
  for (const [key, value] of [
    ['evidenceSha256', dependencyClosure.evidenceSha256],
    ['catalogSnapshotSha256', dependencyClosure.catalogSnapshotSha256],
    ['foreignKeyClosureSnapshotSha256', dependencyClosure.foreignKeyClosureSnapshotSha256],
  ]) {
    if (!SHA256.test(value ?? '')) errors.push(`foundational dependency closure ${key} is invalid`);
  }
  const baselineBlocker = (manifest.blockers ?? []).find(
    (blocker) => blocker.id === 'production_schema_baseline_missing',
  );
  const prerequisiteNames = baselineBlocker?.prerequisitesWithoutCreationDdl ?? [];
  if (prerequisiteNames.length !== 22 || new Set(prerequisiteNames).size !== 22) {
    errors.push('production baseline blocker must enumerate 22 unique foundational relations');
  }

  const entries = [
    ...(manifest.canonical?.migrations ?? []),
    ...(manifest.validationSql ?? []),
    ...(manifest.noncanonicalInputs ?? []),
  ];
  for (const entry of manifest.validationSql ?? []) {
    if (!normalizeRepositoryPath(entry.path ?? '').startsWith('supabase/tests/')) {
      errors.push(`validation SQL must stay under supabase/tests: ${entry.path}`);
    }
  }
  for (const entry of manifest.noncanonicalInputs ?? []) {
    const inputPath = normalizeRepositoryPath(entry.path ?? '');
    if (!inputPath.startsWith('src/schema/') && !inputPath.startsWith('sql/openstates/')) {
      errors.push(`noncanonical SQL input is outside its bounded roots: ${entry.path}`);
    }
  }
  const entriesByPath = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry.path !== 'string') {
      errors.push('every SQL inventory entry must have a path');
      continue;
    }
    const inventoryPath = normalizeRepositoryPath(entry.path);
    if (path.isAbsolute(entry.path) || inventoryPath === '..' || inventoryPath.startsWith('../')) {
      errors.push(`SQL inventory path escapes the repository: ${entry.path}`);
      continue;
    }
    if (entriesByPath.has(inventoryPath)) errors.push(`duplicate SQL inventory path: ${inventoryPath}`);
    entriesByPath.set(inventoryPath, entry);
    if (!SHA256.test(entry.sha256 ?? '')) errors.push(`invalid SHA-256 for ${inventoryPath}`);
  }

  const discoveredSql = walkSqlFiles(repositoryRoot, repositoryRoot);
  for (const sqlPath of discoveredSql) {
    if (!entriesByPath.has(sqlPath)) errors.push(`untracked SQL file: ${sqlPath}`);
  }
  for (const [inventoryPath, entry] of entriesByPath) {
    const absolutePath = path.join(repositoryRoot, inventoryPath);
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
      errors.push(`inventoried SQL file is missing: ${inventoryPath}`);
      continue;
    }
    const actualHash = sha256File(inventoryPath, repositoryRoot);
    if (entry.sha256 !== actualHash) {
      errors.push(`SQL hash mismatch for ${inventoryPath}: expected ${entry.sha256}, got ${actualHash}`);
    }
  }

  for (const recovered of manifest.recoveredTransientPayloads ?? []) {
    const sourceEntry = entriesByPath.get(normalizeRepositoryPath(recovered.sourcePath ?? ''));
    if (!sourceEntry) {
      errors.push(`recovered transient payload source is not inventoried: ${recovered.sourcePath}`);
      continue;
    }
    if (
      recovered.transientRowPresentAtAudit !== false ||
      recovered.sourceHashMatches !== true ||
      recovered.expectedFullContentSha256 !== sourceEntry.sha256
    ) {
      errors.push(`recovered transient payload evidence is inconsistent: ${recovered.ledgerVersion}`);
    }
    if (!compactLedger?.rows?.some(
      (row) => row.version === recovered.ledgerVersion && row.name === recovered.ledgerName,
    )) {
      errors.push(`recovered transient payload ledger row is absent: ${recovered.ledgerVersion}`);
    }
  }

  const hashGroups = new Map();
  for (const entry of entries) {
    if (!SHA256.test(entry.sha256 ?? '')) continue;
    const group = hashGroups.get(entry.sha256) ?? [];
    group.push(entry);
    hashGroups.set(entry.sha256, group);
  }
  for (const group of hashGroups.values()) {
    if (group.length < 2) continue;
    const originals = group.filter((entry) => !entry.duplicateOf);
    if (originals.length !== 1) {
      errors.push(`duplicate SQL hash ${group[0].sha256} must identify exactly one original file`);
      continue;
    }
    for (const duplicate of group.filter((entry) => entry.duplicateOf)) {
      if (normalizeRepositoryPath(duplicate.duplicateOf) !== normalizeRepositoryPath(originals[0].path)) {
        errors.push(`${duplicate.path} duplicateOf must reference ${originals[0].path}`);
      }
    }
  }

  const canonicalEntries = manifest.canonical?.migrations ?? [];
  const canonicalDiscovered = walkSqlFiles(path.join(repositoryRoot, CANONICAL_ROOT), repositoryRoot);
  const declaredCanonical = canonicalEntries.map((entry) => normalizeRepositoryPath(entry.path));
  if (JSON.stringify(canonicalDiscovered) !== JSON.stringify(declaredCanonical)) {
    errors.push('canonical migration list/order differs from the manifest');
  }

  let previousVersion = null;
  const seenVersions = new Set();
  for (const entry of canonicalEntries) {
    const canonicalPath = normalizeRepositoryPath(entry.path);
    if (path.posix.dirname(canonicalPath) !== CANONICAL_ROOT) {
      errors.push(`canonical migration must be directly under ${CANONICAL_ROOT}: ${entry.path}`);
      continue;
    }
    const basename = path.posix.basename(canonicalPath);
    const match = basename.match(MIGRATION_NAME);
    if (!match) {
      errors.push(`invalid canonical migration filename: ${entry.path}`);
      continue;
    }
    const version = match[1];
    if (seenVersions.has(version)) errors.push(`duplicate canonical migration version: ${version}`);
    if (previousVersion !== null && version <= previousVersion) {
      errors.push(`canonical migration versions are reordered at ${entry.path}`);
    }
    seenVersions.add(version);
    previousVersion = version;

    const sqlText = readFileSync(path.join(repositoryRoot, entry.path), 'utf8');
    for (const violation of canonicalPatternViolations(sqlText)) {
      errors.push(`${entry.path}: ${violation.id}: ${violation.reason}`);
    }
  }

  const openBlockers = (manifest.blockers ?? []).filter((blocker) => blocker.status !== 'resolved');
  if (manifest.canonical?.status === 'blocked') {
    if (canonicalEntries.length !== 0) {
      errors.push('blocked canonical root must stay empty; do not commit a partial migration chain');
    }
    if (openBlockers.length === 0) errors.push('blocked canonical root must declare at least one open blocker');
  }
  if (manifest.canonical?.status === 'ready') {
    if (canonicalEntries.length === 0) errors.push('ready canonical root must contain migrations');
    if (canonicalEntries[0]?.kind !== 'production_baseline') {
      errors.push('first canonical migration must be kind=production_baseline');
    }
    if (openBlockers.length !== 0) errors.push('ready canonical root cannot have open blockers');
    if (manifest.productionEvidence?.ledgerReconciliationStatus !== 'reconciled') {
      errors.push('ready canonical root requires a reconciled production ledger');
    }
  }
  if (requireReady && manifest.canonical?.status !== 'ready') {
    errors.push('database-bearing change blocked: canonical production baseline is not ready');
  }

  if (remoteLedgerPath) {
    try {
      const ledger = JSON.parse(readFileSync(path.resolve(repositoryRoot, remoteLedgerPath), 'utf8'));
      const observed = productionEvidence;
      if (ledger.source?.project_id !== observed.projectRef) {
        errors.push('remote ledger project does not match manifest production project');
      }
      if (ledger.summary?.migration_count !== observed.migrationCount) {
        errors.push('remote ledger migration count does not match the manifest observation');
      }
      if (ledger.summary?.ordered_ledger_sha256 !== observed.orderedLedgerSha256) {
        errors.push('remote ledger digest does not match the manifest observation');
      }
      if (compactLedger) {
        const remoteRows = ledger.migrations ?? [];
        if (remoteRows.length !== compactLedger.rows.length) {
          errors.push('remote ledger row count does not match compact evidence');
        } else {
          for (let index = 0; index < remoteRows.length; index += 1) {
            const remote = remoteRows[index];
            const compact = compactLedger.rows[index];
            if (
              remote.version !== compact.version ||
              remote.name !== compact.name ||
              remote.statements_sha256 !== compact.statementsSha256 ||
              remote.rollback_sha256 !== compact.rollbackSha256
            ) {
              errors.push(`remote ledger row ${index + 1} differs from compact evidence`);
              break;
            }
          }
        }
      }
    } catch (error) {
      errors.push(`could not validate remote ledger evidence: ${error.message}`);
    }
  } else if (requireRemoteParity) {
    errors.push('remote ledger evidence is required for parity validation');
  }

  if (manifest.productionEvidence?.serverVersion !== '17.6') {
    warnings.push('productionEvidence.serverVersion differs from the audited 17.6 observation');
  }

  return {
    errors,
    warnings,
    manifest,
    discoveredSqlCount: discoveredSql.length,
    canonicalMigrationCount: canonicalEntries.length,
    compactLedgerRowCount: compactLedger?.rows?.length ?? 0,
    openBlockerCount: openBlockers.length,
  };
}

function parseArguments(argv) {
  const options = {
    requireReady: false,
    requireRemoteParity: false,
    remoteLedgerPath: null,
    changedFrom: null,
    githubOutput: false,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--require-ready') options.requireReady = true;
    else if (argument === '--require-remote-parity') options.requireRemoteParity = true;
    else if (argument === '--github-output') options.githubOutput = true;
    else if (argument === '--json') options.json = true;
    else if (argument === '--remote-ledger') options.remoteLedgerPath = argv[++index];
    else if (argument === '--changed-from') options.changedFrom = argv[++index];
    else throw new Error(`unknown argument: ${argument}`);
  }
  return options;
}

function runCli() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
    return;
  }

  const changeSet = options.changedFrom === null
    ? { paths: [], conservative: false, reason: null }
    : changedPathsFrom(options.changedFrom);
  const databaseChanged = changeSet.conservative || changeSet.paths.some(classifyDatabaseBearingPath);
  const result = validateRepository({
    requireReady: options.requireReady || (options.changedFrom !== null && databaseChanged),
    remoteLedgerPath: options.remoteLedgerPath,
    requireRemoteParity: options.requireRemoteParity,
  });

  if (options.githubOutput) {
    const outputPath = process.env.GITHUB_OUTPUT;
    if (!outputPath) {
      result.errors.push('--github-output requires GITHUB_OUTPUT');
    } else {
      appendFileSync(outputPath, `database_changed=${databaseChanged}\n`);
      appendFileSync(outputPath, `baseline_status=${result.manifest?.canonical?.status ?? 'unknown'}\n`);
    }
  }

  const summary = {
    ok: result.errors.length === 0,
    baselineStatus: result.manifest?.canonical?.status ?? 'unknown',
    databaseChanged,
    conservativeChangeClassification: changeSet.conservative,
    changeClassificationReason: changeSet.reason,
    canonicalMigrationCount: result.canonicalMigrationCount ?? 0,
    compactLedgerRowCount: result.compactLedgerRowCount ?? 0,
    discoveredSqlCount: result.discoveredSqlCount ?? 0,
    openBlockerCount: result.openBlockerCount ?? 0,
    warnings: result.warnings,
    errors: result.errors,
  };

  if (options.json) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(
      `Atlas Supabase boundary: ${summary.ok ? 'PASS' : 'FAIL'}; ` +
      `baseline=${summary.baselineStatus}; canonical=${summary.canonicalMigrationCount}; ` +
      `ledger_rows=${summary.compactLedgerRowCount}; inventoried_sql=${summary.discoveredSqlCount}; ` +
      `blockers=${summary.openBlockerCount}`,
    );
    if (options.changedFrom !== null) {
      console.log(`Database-bearing change: ${databaseChanged}`);
      if (changeSet.reason) console.log(`Classification note: ${changeSet.reason}`);
    }
    for (const warning of result.warnings) console.warn(`WARNING: ${warning}`);
    for (const error of result.errors) console.error(`ERROR: ${error}`);
  }

  if (!summary.ok) process.exitCode = 1;
}

const executedDirectly = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  : false;
if (executedDirectly) runCli();

export {
  CANONICAL_ROOT,
  canonicalPatternViolations,
  changedPathsFrom,
  classifyDatabaseBearingPath,
  orderedLedgerDigest,
  parseTomlSubset,
  sha256File,
  validateRepository,
  walkSqlFiles,
};
