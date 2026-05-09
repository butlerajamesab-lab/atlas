import fs from 'node:fs/promises';

const projectRef = process.env.SUPABASE_PROJECT_REF || 'bjdjjgnkhxblnpdrjqtw';
const pat = process.env.SUPABASE_MANAGEMENT_PAT;
const sqlFile = process.argv[2];

if (!pat) {
  console.error('SUPABASE_MANAGEMENT_PAT is required.');
  process.exit(1);
}

if (!sqlFile) {
  console.error('Usage: node scripts/apply-sql-management-api.mjs <sql-file>');
  process.exit(1);
}

const query = await fs.readFile(sqlFile, 'utf8');
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
