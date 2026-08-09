import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../src/schema/20260809_signal_ontology_read_model.sql', import.meta.url), 'utf8');
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

test('canonical documentation states the non-equivalence contract', () => {
  assert.match(contract, /source record[\s\S]*!= normalized observation[\s\S]*!= derived civic signal/);
  assert.match(contract, /One row is not automatically a civic signal/);
  assert.match(contract, /Convergence is not causation/);
  assert.match(contract, /Stream-health alerts remain separately counted/);
});
