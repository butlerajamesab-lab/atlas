import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../src/schema/20260809_signal_ontology_read_model.sql', import.meta.url), 'utf8');
const performanceMigration = readFileSync(new URL('../src/schema/20261018_signal_derivation_single_pass.sql', import.meta.url), 'utf8');
const streamRuntimeMigration = readFileSync(new URL('../src/schema/20261019_stream_runtime_grouped_summary.sql', import.meta.url), 'utf8');
const scripts = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts;
const privileges = readFileSync(new URL('../src/schema/20260809_signal_ontology_read_model_privileges.sql', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../src/routes/ui.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/atlas-app.js', import.meta.url), 'utf8');
const contract = readFileSync(new URL('../docs/ATLAS_SIGNAL_ONTOLOGY_CONTRACT.md', import.meta.url), 'utf8');

test('signal ontology keeps normalized observations separate from derived signals', () => {
  assert.match(migration, /event\.signal_type as observation_classification/);
  assert.match(migration, /from public\.signal_events/);
  assert.match(migration, /from atlas\.signals/);
  assert.match(migration, /from atlas\.signal_extractions/);
  assert.match(migration, /from atlas\.live_data_signal_candidate/);
  assert.match(migration, /from atlas\.convergence_run_manifest/);
  assert.match(migration, /from atlas\.convergence_receipt/);
  assert.match(migration, /from atlas\.convergence_events/);
  assert.match(migration, /pattern_type = 'stream_health_alert'/);
});

test('new read models are caller-secured and service-role-only', () => {
  for (const view of [
    'v_atlas_observation_type_summary_v1',
    'v_atlas_canonical_signal_type_summary_v1',
    'v_atlas_signal_candidate_rule_summary_v1',
    'v_atlas_signal_candidate_detail_v1',
    'v_atlas_convergence_run_summary_v1',
    'v_atlas_signal_derivation_summary_v1',
    'v_atlas_ui_overview_v3',
    'v_atlas_ui_signal_derivation_v3',
  ]) {
    assert.match(migration, new RegExp(`${view}[\\s\\S]*security_invoker = true`));
    assert.match(migration, new RegExp(`revoke all on public\\.${view} from public, anon, authenticated`));
    assert.match(migration, new RegExp(`grant select on public\\.${view} to service_role`));
  }

  assert.match(privileges, /grant usage on schema atlas to service_role/);
  for (const table of [
    'signals',
    'signal_types',
    'signal_extractions',
    'live_data_signal_candidate',
    'live_data_signal_rule',
    'convergence_run_manifest',
    'convergence_receipt',
    'convergence_events',
  ]) {
    assert.match(privileges, new RegExp(`atlas\\.${table}`));
  }
  assert.match(privileges, /from public, anon, authenticated/);
});

test('ontology migration is additive and preserves compatibility identities', () => {
  assert.doesNotMatch(migration, /delete\s+from\s+public\.signal_events/i);
  assert.doesNotMatch(migration, /truncate\s+.*signal_events/i);
  assert.doesNotMatch(migration, /drop\s+(table|view)\s+.*signal_events/i);
  assert.doesNotMatch(migration, /alter\s+table\s+public\.signal_events/i);
});

test('public Atlas surface uses the v3 ontology instead of event-count substitution', () => {
  assert.match(ui, /FRONTEND_READ_MODEL_VERSION = 'atlas\.frontend_read_model\.v3'/);
  assert.match(ui, /from\('v_atlas_ui_overview_v3'\)/);
  assert.match(ui, /from\('v_atlas_ui_signal_derivation_v3'\)/);
  assert.match(ui, /ui-api\/signal-derivation/);
  assert.match(ui, /An observation is not automatically a civic signal/);
  assert.doesNotMatch(app, /label:'Signal Events'/);
  assert.doesNotMatch(app, /data\.counts\.signal_events/);
  assert.match(app, /Normalized Observations/);
  assert.match(app, /Canonical Signals/);
  assert.match(app, /Convergence Receipts/);
  assert.match(app, /Adapter classifications—not derived signal counts/);
});

test('deprecated signal-substrate route preserves the complete v2 response contract', () => {
  assert.match(ui, /LEGACY_SIGNAL_SUBSTRATE_READ_MODEL_VERSION = 'atlas\.frontend_read_model\.v2'/);
  assert.match(ui, /from\('v_atlas_ui_signal_substrate_v2'\)/);
  assert.match(ui, /summary: data\.summary/);
  assert.match(ui, /signal_types: data\.signal_types \?\? \[\]/);
  assert.match(ui, /semantics: 'Signal events are observations\./);
  assert.match(ui, /LEGACY_SIGNAL_SUBSTRATE_DEPRECATED_AT = '@1786295808'/);
  assert.match(ui, /res\.set\('Deprecation', LEGACY_SIGNAL_SUBSTRATE_DEPRECATED_AT\)/);
  assert.match(ui, /rel="successor-version"/);
  assert.doesNotMatch(ui, /\.\.\.\(await signalDerivationRead\(\)\)/);
  assert.doesNotMatch(ui, /deprecated_alias:/);
  assert.doesNotMatch(ui, /canonical_route:/);
});

test('canonical documentation states the non-equivalence contract', () => {
  assert.match(contract, /source record[\s\S]*!= normalized observation[\s\S]*!= derived civic signal/);
  assert.match(contract, /One row is not automatically a civic signal/);
  assert.match(contract, /Convergence is not causation/);
  assert.match(contract, /Stream-health alerts remain separately counted/);
});

test('production ontology summary reads observation table once while retaining installed authority fields', () => {
  const singlePass = performanceMigration.split('create or replace view public.v_atlas_signal_derivation_summary_v1')[1];
  assert.ok(singlePass, 'optimize the installed authority view in place');
  assert.match(singlePass, /WITH observation_metrics AS MATERIALIZED/i);
  assert.equal((singlePass.match(/FROM public\.signal_events/g) ?? []).length, 1);
  assert.equal((singlePass.match(/\bFROM signal_events\b/g) ?? []).length, 0);
  for (const field of [
    'normalized_observations', 'identity_bound_observations',
    'observation_classifications', 'streams_with_observations',
    'latest_observation_at', 'latest_observation_ingested_at',
    'legacy_suppressed_canonical_signals',
    'historical_signal_candidate_versions',
    'signal_candidate_semantic_patterns', 'failed_signal_candidates',
  ]) {
    assert.match(singlePass, new RegExp('\\b' + field + '\\b'));
  }
  assert.match(singlePass, /is_suppressed IS FALSE/);
  assert.match(singlePass, /is_current IS TRUE/);
  assert.match(singlePass, /security_invoker = true/);
  assert.match(singlePass, /revoke all on public\.v_atlas_signal_derivation_summary_v1/);
  assert.match(singlePass, /grant select on public\.v_atlas_signal_derivation_summary_v1 to service_role/);
  assert.doesNotMatch(singlePass, /\b(delete|truncate|drop table|drop view)\b/i);
  assert.match(scripts['schema:apply:signal-ontology-performance'], /20261018_signal_derivation_single_pass\.sql/);
  assert.doesNotMatch(scripts['schema:apply:signal-ontology-performance'], /20260809_signal_ontology_read_model\.sql/);
});

test('installed stream runtime read model retains all 16 public columns and zero-event semantics', () => {
  const sql = streamRuntimeMigration.toLowerCase();
  assert.match(sql, /create or replace view public\.v_atlas_stream_runtime_summary_v1/);
  assert.match(sql, /left join\s*\(/);
  assert.match(sql, /group by event\.stream_id/);
  assert.equal((sql.match(/from public\.signal_events as event/g) ?? []).length, 1);
  assert.doesNotMatch(sql, /cross join lateral/);
  for (const column of [
    'stream_id', 'source_id', 'jurisdiction_id', 'module_hint',
    'throughput_profile', 'safety_profile', 'governance_contract_id',
    'status', 'created_at', 'updated_at',
    'event_count', 'identity_count', 'signal_type_count',
    'first_event_at', 'latest_event_at', 'latest_ingested_at',
  ]) {
    assert.match(sql, new RegExp('\\b' + column + '\\b'));
  }
  assert.match(sql, /coalesce\(event_summary\.event_count,\s*0::bigint\)/);
  assert.match(sql, /coalesce\(event_summary\.identity_count,\s*0::bigint\)/);
  assert.match(sql, /coalesce\(event_summary\.signal_type_count,\s*0::bigint\)/);
  assert.match(sql, /min\(event\."timestamp"\)/);
  assert.match(sql, /max\(event\."timestamp"\)/);
  assert.match(sql, /max\(event\.ingested_at\)/);
  assert.match(sql, /security_invoker = true/);
  assert.match(sql, /revoke all on public\.v_atlas_stream_runtime_summary_v1 from public, anon, authenticated/);
  assert.match(sql, /grant select on public\.v_atlas_stream_runtime_summary_v1 to service_role/);
  assert.doesNotMatch(sql, /\b(delete|truncate|drop table|drop view)\b/);
  assert.match(scripts['schema:apply:stream-runtime-performance'], /20261019_stream_runtime_grouped_summary\.sql/);
});
