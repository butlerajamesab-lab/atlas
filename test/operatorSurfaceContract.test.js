import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../src/schema/20260809_live_operator_surface.sql', import.meta.url), 'utf8');
const securityMigration = readFileSync(new URL('../src/schema/20260809_live_operator_surface_security.sql', import.meta.url), 'utf8');
const compactReadMigration = readFileSync(new URL('../src/schema/20260809_live_operator_surface_compact_reads.sql', import.meta.url), 'utf8');
const ontologyMigration = readFileSync(new URL('../src/schema/20260809_signal_ontology_read_model.sql', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../src/routes/ui.js', import.meta.url), 'utf8');
const server = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const operator = readFileSync(new URL('../src/routes/operator.js', import.meta.url), 'utf8');
const scheduler = readFileSync(new URL('../src/services/scheduler.js', import.meta.url), 'utf8');

test('operator actions are mounted after the private control boundary', () => {
  const privateBoundary = server.indexOf('app.use(requireControl)');
  const operatorMount = server.indexOf('app.use(atlasOperatorRouter(routeContext))');
  assert.ok(privateBoundary >= 0 && operatorMount > privateBoundary);
});

test('action receipts are hash-bound, service-role-only, and RLS protected', () => {
  assert.match(migration, /create table if not exists public\.atlas_action_receipt/);
  assert.match(migration, /action_receipt_hash text primary key/);
  assert.match(migration, /force row level security/);
  assert.match(migration, /revoke all on public\.atlas_action_receipt from public, anon, authenticated/);
  assert.match(migration, /grant select, insert on public\.atlas_action_receipt to service_role/);
  assert.match(migration, /create policy atlas_action_receipt_service_role_all/);
});

test('source readiness view is caller-secured and browser roles remain revoked', () => {
  assert.match(securityMigration, /v_atlas_source_operational_readiness_v1[\s\S]*security_invoker = true/);
  assert.match(securityMigration, /revoke all on public\.v_atlas_source_operational_readiness_v1[\s\S]*public, anon, authenticated/);
  assert.match(securityMigration, /grant select on public\.v_atlas_source_operational_readiness_v1[\s\S]*service_role/);
});

test('aggregate views are invoker-secured and do not expose payload fields', () => {
  assert.match(migration, /v_atlas_stream_runtime_summary_v1[\s\S]*security_invoker = true/);
  assert.match(migration, /v_atlas_signal_type_summary_v1[\s\S]*security_invoker = true/);
  assert.match(migration, /v_atlas_signal_substrate_summary_v1[\s\S]*security_invoker = true/);
  assert.doesNotMatch(migration, /event\.payload/);
  assert.doesNotMatch(migration, /event\.provenance/);
});

test('compact UI reads preserve service-role boundaries and one database round trip per surface', () => {
  assert.match(compactReadMigration, /v_atlas_ui_overview_v2[\s\S]*security_invoker = true/);
  assert.match(compactReadMigration, /v_atlas_ui_signal_substrate_v2[\s\S]*security_invoker = true/);
  assert.match(compactReadMigration, /revoke all on public\.v_atlas_ui_overview_v2 from public, anon, authenticated/);
  assert.match(ontologyMigration, /v_atlas_ui_overview_v3[\s\S]*security_invoker = true/);
  assert.match(ontologyMigration, /v_atlas_ui_signal_derivation_v3[\s\S]*security_invoker = true/);
  assert.match(ui, /from\('v_atlas_ui_overview_v3'\)/);
  assert.match(ui, /from\('v_atlas_ui_signal_derivation_v3'\)/);
  assert.match(ui, /PUBLIC_READ_CACHE_TTL_MS = 15_000/);
  assert.match(ui, /existing\.expiresAt === null/);
});

test('compiled adapter mapping is explicit and database stream status gates execution', () => {
  assert.match(scheduler, /ADAPTER_STREAM_IDS/);
  assert.match(scheduler, /name: 'openstates',[\s\S]*args: \{ jurisdiction: STATE\.toLowerCase\(\) \}/);
  assert.match(scheduler, /\.from\('streams'\)/);
  assert.match(scheduler, /stream\.status !== 'active'/);
  assert.match(scheduler, /event_delta/);
  assert.match(scheduler, /recordActionReceipt/);
});

test('operator surface supports run, reconcile, register, status, and output inspection', () => {
  assert.match(operator, /operator-api\/streams\/:adapterName\/run/);
  assert.match(operator, /operator-api\/live-data-signals\/run/);
  assert.match(operator, /operator-api\/source-health\/reconcile/);
  assert.match(operator, /router\.post\('\/operator-api\/streams'/);
  assert.match(operator, /operator-api\/streams\/:streamId\/status/);
  assert.match(operator, /operator-api\/substrate/);
  assert.match(operator, /v_atlas_signal_candidate_detail_v1/);
  assert.match(operator, /signal_candidate_derivation_run/);
});
