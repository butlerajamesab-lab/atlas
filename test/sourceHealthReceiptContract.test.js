import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../src/schema/20260806_source_health_receipts.sql', import.meta.url),
  'utf8',
);
const upgrade = readFileSync(
  new URL('../src/schema/20261018_source_health_readiness_view_security.sql', import.meta.url),
  'utf8',
);
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const reconcileScript = readFileSync(new URL('../scripts/reconcile-source-health.mjs', import.meta.url), 'utf8');
const operatorSource = readFileSync(new URL('../src/routes/operator.js', import.meta.url), 'utf8');
const openSecretsAdapter = readFileSync(
  new URL('../src/adapters/openSecretsAdapter.js', import.meta.url),
  'utf8',
);
const faraAdapter = readFileSync(
  new URL('../src/adapters/faraForeignAgentsAdapter.js', import.meta.url),
  'utf8',
);

test('source health substrate extends existing Atlas registries instead of duplicating them', () => {
  assert.match(migration, /references public\.connector_registry\(id\)/);
  assert.match(migration, /references public\.schema_registry\(id\)/);
  assert.doesNotMatch(migration, /create table if not exists public\.connector_registry/i);
  assert.doesNotMatch(migration, /create table if not exists public\.schema_registry/i);
  assert.doesNotMatch(migration, /create table if not exists public\.signal_events/i);
});

test('source health observations are append-oriented and identity bound', () => {
  assert.match(migration, /create table if not exists public\.atlas_source_health_event/);
  assert.match(migration, /source_state_hash text not null/);
  assert.match(migration, /unique \(connector_id, observed_at, source_state_hash\)/);
  assert.doesNotMatch(migration, /on conflict[\s\S]*atlas_source_health_event/i);
});

test('schema drift snapshots preserve complete schema payload identity', () => {
  assert.match(migration, /create table if not exists public\.atlas_source_schema_snapshot/);
  assert.match(migration, /schema_hash text not null/);
  assert.match(migration, /schema_payload jsonb not null/);
  assert.match(migration, /breaking_change/);
});

test('fallback bindings cannot point to themselves and priorities are explicit', () => {
  assert.match(migration, /atlas_source_fallback_not_self/);
  assert.match(migration, /fallback_priority integer not null check \(fallback_priority > 0\)/);
  assert.match(migration, /idx_atlas_source_fallback_active_priority/);
});

test('operational readiness is a deterministic state and not an invented weighted score', () => {
  assert.match(migration, /v_atlas_source_operational_readiness_v1/);
  assert.match(migration, /operational_readiness_state/);
  assert.match(migration, /then 'ready'/);
  assert.match(migration, /then 'blocked'/);
  assert.doesNotMatch(migration, /readiness_score/);
  assert.doesNotMatch(migration, /0\.\d+\s*\*/);
});

test('browser roles cannot write source health substrate', () => {
  assert.match(migration, /force row level security/);
  assert.match(migration, /revoke all on public\.atlas_source_health_event from anon, authenticated/);
  assert.match(migration, /revoke all on public\.atlas_source_schema_snapshot from anon, authenticated/);
  assert.match(migration, /revoke all on public\.atlas_source_fallback_binding from anon, authenticated/);
});

test('Senate LDA ingestion uses the registered canonical stream identity', () => {
  assert.match(openSecretsAdapter, /sourceId:\s*'senate_lda'/);
  assert.match(openSecretsAdapter, /jurisdictionId:\s*'us_federal'/);
  assert.match(openSecretsAdapter, /moduleHint:\s*'lobbying'/);
  assert.doesNotMatch(openSecretsAdapter, /sourceId:\s*'opensecrets_lda'/);
  assert.doesNotMatch(openSecretsAdapter, /signals:\s*\[\.\.\.lobbying,\s*\.\.\.donors\]/);
});

test('FARA ingestion uses the documented active-registrant endpoint and registered source identity', () => {
  assert.match(faraAdapter, /\/Registrants\/json\/Active/);
  assert.match(faraAdapter, /REGISTRANTS_ACTIVE\?\.ROW/);
  assert.match(faraAdapter, /sourceId:\s*'fara'/);
  assert.match(faraAdapter, /moduleHint:\s*'foreign_influence'/);
  assert.doesNotMatch(faraAdapter, /sourceId:\s*'doj_fara'/);
});

test('readiness view revokes public browser grants and enforces invoker security', () => {
  assert.match(migration, /create or replace view public\.v_atlas_source_operational_readiness_v1\s+with \(security_invoker = true\)/);
  assert.match(migration, /revoke all on public\.v_atlas_source_operational_readiness_v1 from public, anon, authenticated/);
  assert.match(upgrade, /alter view public\.v_atlas_source_operational_readiness_v1\s+set \(security_invoker = true\)/);
  assert.match(upgrade, /revoke all on public\.v_atlas_source_operational_readiness_v1\s+from public, anon, authenticated/);
  assert.match(upgrade, /grant select on public\.v_atlas_source_operational_readiness_v1 to service_role/);
  assert.match(packageJson.scripts['schema:apply:source-health'], /20261018_source_health_readiness_view_security\.sql/);
});

test('historical reconciliation command drains every page and exposes operator cursor', () => {
  assert.match(reconcileScript, /while \(after_id !== null\)/);
  assert.match(reconcileScript, /reconcileIngestJobSourceHealth\(\{ limit, after_id \}\)/);
  assert.match(operatorSource, /reconcileIngestJobSourceHealth\(\{ limit, after_id: req\.body\?\.after_id \?\? null \}\)/);
  assert.match(operatorSource, /next_cursor: result\.next_cursor/);
});
