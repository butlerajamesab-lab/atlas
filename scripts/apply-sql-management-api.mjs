import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const acknowledgement = 'I_ACKNOWLEDGE_THIS_BYPASSES_THE_MIGRATION_LEDGER';
const projectRef = process.env.SUPABASE_PROJECT_REF;
const pat = process.env.SUPABASE_MANAGEMENT_PAT;
const sqlFile = process.argv[2];
const expectedHash = process.env.ATLAS_BREAK_GLASS_SQL_SHA256;

if (process.env.ATLAS_BREAK_GLASS_SQL_APPLY !== acknowledgement) {
  console.error('Direct Management API SQL apply is disabled.');
  console.error('Use reviewed files under supabase/migrations and an isolated preview.');
  console.error(`Break-glass only: set ATLAS_BREAK_GLASS_SQL_APPLY=${acknowledgement}.`);
  process.exit(1);
}

if (!projectRef) {
  console.error('SUPABASE_PROJECT_REF is required; production is never selected by default.');
  process.exit(1);
}

if (!pat) {
  console.error('SUPABASE_MANAGEMENT_PAT is required.');
  process.exit(1);
}

if (!sqlFile) {
  console.error('Usage: node scripts/apply-sql-management-api.mjs <sql-file>');
  process.exit(1);
}

if (!/^[a-f0-9]{64}$/.test(expectedHash ?? '')) {
  console.error('ATLAS_BREAK_GLASS_SQL_SHA256 must be the reviewed file SHA-256.');
  process.exit(1);
}

const absoluteSqlFile = path.resolve(repositoryRoot, sqlFile);
const relativeSqlFile = path.relative(repositoryRoot, absoluteSqlFile).replaceAll('\\', '/');
if (
  relativeSqlFile.startsWith('../') ||
  (!relativeSqlFile.startsWith('src/schema/') && !relativeSqlFile.startsWith('sql/openstates/'))
) {
  console.error('Break-glass SQL must be an inventoried legacy input under src/schema or sql/openstates.');
  process.exit(1);
}

const manifest = JSON.parse(
  await fs.readFile(path.join(repositoryRoot, 'supabase/migration-manifest.json'), 'utf8'),
);
const inventoryEntry = manifest.noncanonicalInputs?.find((entry) => entry.path === relativeSqlFile);
if (!inventoryEntry) {
  console.error(`${relativeSqlFile} is absent from the migration manifest.`);
  process.exit(1);
}

const query = await fs.readFile(absoluteSqlFile, 'utf8');
const actualHash = createHash('sha256').update(query).digest('hex');
if (actualHash !== inventoryEntry.sha256 || actualHash !== expectedHash) {
  console.error(`SQL hash mismatch for ${relativeSqlFile}; refusing to apply.`);
  process.exit(1);
}

console.error('WARNING: executing audited break-glass SQL outside the canonical migration ledger.');
console.error(`Project: ${projectRef}; file: ${relativeSqlFile}; sha256: ${actualHash}`);
const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;

const response = await fetch(endpoint, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${pat}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query }),
});

const bodyText = await response.text();
if (!response.ok) {
  console.error(`Supabase SQL apply failed: HTTP ${response.status}`);
  console.error(bodyText.slice(0, 2000));
  process.exit(1);
}

let parsed = null;
try {
  parsed = JSON.parse(bodyText);
} catch {
  parsed = bodyText;
}

console.log(JSON.stringify({ ok: true, project_ref: projectRef, status: response.status, result_type: Array.isArray(parsed) ? 'array' : typeof parsed }, null, 2));
