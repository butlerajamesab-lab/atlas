import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const route = readFileSync(new URL('../src/routes/convergence.js', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../src/services/convergenceRunner.js', import.meta.url), 'utf8');

test('run endpoint requires every governed mathematical input explicitly', () => {
  for (const field of [
    'as_of',
    'time_window_ms',
    'temporal_bucket_ms',
    'geography_registry_version',
    'analysis_level',
    'rule_manifest_hash',
    'engine_version',
    'min_signals_for_analysis',
    'z_score_threshold',
    'persist',
  ]) {
    assert.match(route, new RegExp(`['\\"]${field}['\\"]`));
  }
  assert.doesNotMatch(route, /min_signals_for_analysis:\s*[^,]+\?\?/);
  assert.doesNotMatch(route, /z_score_threshold:\s*[^,]+\?\?/);
  assert.doesNotMatch(route, /persist:\s*[^,]+\?\?/);
});

test('route and runner use governed RPCs rather than direct atlas table access', () => {
  assert.match(runner, /atlas_convergence_source_population_page_v1/);
  assert.match(runner, /atlas_convergence_persist_run_v1/);
  assert.match(runner, /atlas_convergence_get_run_v1/);
  assert.match(runner, /atlas_convergence_get_replay_bundle_v1/);
  assert.doesNotMatch(runner, /\.from\(['\"]convergence_/);
  assert.doesNotMatch(route, /\.from\(['\"]convergence_/);
});

test('production persistence uses receipt_identity rather than input_hash as identity', () => {
  assert.match(runner, /receipt_identity/);
  assert.doesNotMatch(runner, /p_receipt_identity:\s*receipt\.input_hash/);
});

test('runtime never injects Date.now into governed convergence execution', () => {
  assert.doesNotMatch(route, /Date\.now\(/);
  assert.doesNotMatch(runner, /Date\.now\(/);
  assert.doesNotMatch(runner, /new Date\(\)\.toISOString/);
});
