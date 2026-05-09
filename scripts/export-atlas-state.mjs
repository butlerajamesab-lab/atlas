import fs from 'node:fs/promises';
import path from 'node:path';

const projectRef = process.env.SUPABASE_PROJECT_REF || 'bjdjjgnkhxblnpdrjqtw';
const pat = process.env.SUPABASE_MANAGEMENT_PAT;
const outDir = process.argv[2] || 'src/schema';

if (!pat) {
  console.error('SUPABASE_MANAGEMENT_PAT is required.');
  process.exit(1);
}

async function runSql(query) {
  const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${pat}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase SQL query failed (${response.status}): ${text.slice(0, 1000)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const metadataSql = String.raw`
select jsonb_build_object(
  'project_ref', '${projectRef}',
  'captured_at', now(),
  'tables', coalesce((
    select jsonb_agg(jsonb_build_object(
      'schema', c.table_schema,
      'table', c.table_name,
      'columns', (
        select jsonb_agg(jsonb_build_object(
          'ordinal_position', c2.ordinal_position,
          'column_name', c2.column_name,
          'data_type', c2.data_type,
          'udt_name', c2.udt_name,
          'is_nullable', c2.is_nullable,
          'column_default', c2.column_default
        ) order by c2.ordinal_position)
        from information_schema.columns c2
        where c2.table_schema = c.table_schema and c2.table_name = c.table_name
      ),
      'primary_key', coalesce((
        select jsonb_agg(a.attname order by a.attnum)
        from pg_index i
        join pg_class tbl on tbl.oid = i.indrelid
        join pg_namespace ns on ns.oid = tbl.relnamespace
        join pg_attribute a on a.attrelid = tbl.oid and a.attnum = any(i.indkey)
        where i.indisprimary and ns.nspname = c.table_schema and tbl.relname = c.table_name
      ), '[]'::jsonb),
      'rls_enabled', coalesce((
        select cls.relrowsecurity
        from pg_class cls join pg_namespace ns on ns.oid = cls.relnamespace
        where ns.nspname = c.table_schema and cls.relname = c.table_name
      ), false)
    ) order by c.table_schema, c.table_name)
    from information_schema.tables c
    where c.table_schema = 'public' and c.table_type = 'BASE TABLE'
  ), '[]'::jsonb),
  'views', coalesce((
    select jsonb_agg(jsonb_build_object('schema', table_schema, 'view', table_name, 'definition', view_definition) order by table_schema, table_name)
    from information_schema.views
    where table_schema = 'public'
  ), '[]'::jsonb),
  'functions', coalesce((
    select jsonb_agg(jsonb_build_object(
      'schema', n.nspname,
      'function', p.proname,
      'identity_arguments', pg_get_function_identity_arguments(p.oid),
      'result_type', pg_get_function_result(p.oid),
      'definition', pg_get_functiondef(p.oid)
    ) order by n.nspname, p.proname)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  ), '[]'::jsonb),
  'policies', coalesce((
    select jsonb_agg(to_jsonb(pol) order by pol.schemaname, pol.tablename, pol.policyname)
    from pg_policies pol
    where pol.schemaname = 'public'
  ), '[]'::jsonb),
  'triggers', coalesce((
    select jsonb_agg(jsonb_build_object(
      'schema', event_object_schema,
      'table', event_object_table,
      'trigger', trigger_name,
      'event', event_manipulation,
      'timing', action_timing,
      'statement', action_statement
    ) order by event_object_schema, event_object_table, trigger_name, event_manipulation)
    from information_schema.triggers
    where trigger_schema = 'public'
  ), '[]'::jsonb),
  'indexes', coalesce((
    select jsonb_agg(jsonb_build_object('schema', schemaname, 'table', tablename, 'index', indexname, 'definition', indexdef) order by schemaname, tablename, indexname)
    from pg_indexes
    where schemaname = 'public'
  ), '[]'::jsonb)
) as atlas_schema;
`;

const rowCountsSql = String.raw`
create or replace function pg_temp.atlas_table_counts()
returns table (schema_name text, table_name text, row_count bigint)
language plpgsql
as $$
declare
  r record;
begin
  for r in select schemaname, tablename from pg_tables where schemaname = 'public' order by schemaname, tablename loop
    execute format('select count(*)::bigint from %I.%I', r.schemaname, r.tablename) into row_count;
    schema_name := r.schemaname;
    table_name := r.tablename;
    return next;
  end loop;
end;
$$;
select coalesce(jsonb_agg(jsonb_build_object('schema', schema_name, 'table', table_name, 'row_count', row_count) order by schema_name, table_name), '[]'::jsonb) as row_counts
from pg_temp.atlas_table_counts();
`;

function firstValue(result, key) {
  if (Array.isArray(result) && result.length > 0) {
    if (key in result[0]) return result[0][key];
    if (result[0].result && key in result[0].result) return result[0].result[key];
  }
  return result;
}

function renderSchemaSql(meta) {
  const lines = [];
  lines.push('-- Atlas Supabase schema inventory dump');
  lines.push(`-- Project ref: ${projectRef}`);
  lines.push(`-- Captured at: ${meta.captured_at}`);
  lines.push('-- This file is an introspection artifact. Use src/schema/001_streaming_tables.sql for executable streaming DDL.');
  lines.push('');
  for (const table of meta.tables || []) {
    lines.push(`-- TABLE public.${table.table}`);
    lines.push(`-- RLS enabled: ${table.rls_enabled}`);
    for (const col of table.columns || []) {
      lines.push(`--   ${col.column_name}: ${col.data_type}${col.is_nullable === 'NO' ? ' not null' : ''}${col.column_default ? ` default ${col.column_default}` : ''}`);
    }
    if ((table.primary_key || []).length) lines.push(`--   primary key: ${table.primary_key.join(', ')}`);
    lines.push('');
  }
  for (const fn of meta.functions || []) {
    lines.push(`-- FUNCTION public.${fn.function}(${fn.identity_arguments}) returns ${fn.result_type}`);
    if (fn.definition) lines.push(fn.definition.trim() + ';');
    lines.push('');
  }
  for (const trig of meta.triggers || []) {
    lines.push(`-- TRIGGER ${trig.trigger} on public.${trig.table}: ${trig.timing} ${trig.event} ${trig.statement}`);
  }
  if ((meta.triggers || []).length) lines.push('');
  for (const pol of meta.policies || []) {
    lines.push(`-- POLICY ${pol.policyname} on public.${pol.tablename}: command=${pol.cmd}, roles=${JSON.stringify(pol.roles)}, qual=${pol.qual}, with_check=${pol.with_check}`);
  }
  if ((meta.policies || []).length) lines.push('');
  for (const idx of meta.indexes || []) {
    lines.push(`${idx.definition};`);
  }
  lines.push('');
  return lines.join('\n');
}

function renderMarkdown(meta, counts) {
  const lines = [];
  lines.push('# Atlas Supabase State Inventory');
  lines.push('');
  lines.push(`Captured from Atlas Supabase project \`${projectRef}\` at \`${meta.captured_at}\`.`);
  lines.push('');
  lines.push('## Tables and row counts');
  lines.push('');
  lines.push('| Table | Rows | RLS | Primary key |');
  lines.push('|---|---:|---|---|');
  const countMap = new Map((counts || []).map((r) => [`${r.schema}.${r.table}`, r.row_count]));
  for (const table of meta.tables || []) {
    const key = `${table.schema}.${table.table}`;
    lines.push(`| \`${key}\` | ${countMap.get(key) ?? 0} | ${table.rls_enabled ? 'enabled' : 'disabled'} | ${(table.primary_key || []).join(', ') || '—'} |`);
  }
  if (!(meta.tables || []).length) lines.push('| _No public base tables found before the streaming upgrade._ | 0 | — | — |');
  lines.push('');
  lines.push('## Functions');
  lines.push('');
  lines.push('| Function | Result type |');
  lines.push('|---|---|');
  for (const fn of meta.functions || []) lines.push(`| \`public.${fn.function}(${fn.identity_arguments})\` | \`${fn.result_type}\` |`);
  if (!(meta.functions || []).length) lines.push('| _No public functions found._ | — |');
  lines.push('');
  lines.push('## RLS policies');
  lines.push('');
  lines.push('| Table | Policy | Command | Roles |');
  lines.push('|---|---|---|---|');
  for (const pol of meta.policies || []) lines.push(`| \`public.${pol.tablename}\` | \`${pol.policyname}\` | ${pol.cmd} | ${(pol.roles || []).join(', ')} |`);
  if (!(meta.policies || []).length) lines.push('| _No public RLS policies found._ | — | — | — |');
  lines.push('');
  lines.push('## Triggers');
  lines.push('');
  lines.push('| Table | Trigger | Timing | Event |');
  lines.push('|---|---|---|---|');
  for (const trig of meta.triggers || []) lines.push(`| \`public.${trig.table}\` | \`${trig.trigger}\` | ${trig.timing} | ${trig.event} |`);
  if (!(meta.triggers || []).length) lines.push('| _No public triggers found._ | — | — | — |');
  lines.push('');
  return lines.join('\n');
}

await fs.mkdir(outDir, { recursive: true });
const metadataResult = await runSql(metadataSql);
const countsResult = await runSql(rowCountsSql);
const metadata = firstValue(metadataResult, 'atlas_schema');
const rowCounts = firstValue(countsResult, 'row_counts');

await fs.writeFile(path.join(outDir, 'atlas_schema_metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
await fs.writeFile(path.join(outDir, 'atlas_data_state.json'), JSON.stringify({ project_ref: projectRef, captured_at: metadata.captured_at, row_counts: rowCounts }, null, 2) + '\n');
await fs.writeFile(path.join(outDir, 'atlas_schema_dump.sql'), renderSchemaSql(metadata));
await fs.writeFile(path.join(outDir, 'atlas_state_inventory.md'), renderMarkdown(metadata, rowCounts));

console.log(JSON.stringify({ ok: true, project_ref: projectRef, tables: metadata.tables?.length ?? 0, functions: metadata.functions?.length ?? 0, policies: metadata.policies?.length ?? 0, triggers: metadata.triggers?.length ?? 0, row_count_entries: rowCounts?.length ?? 0 }, null, 2));
