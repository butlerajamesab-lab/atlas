import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const currentness = readFileSync(
  new URL('../src/schema/20260811_domain3_candidate_semantic_currentness.sql', import.meta.url),
  'utf8',
);
const trigger = readFileSync(
  new URL('../src/schema/20260811_domain3_candidate_semantic_currentness_trigger.sql', import.meta.url),
  'utf8',
);
const reviewFixes = readFileSync(
  new URL('../src/schema/20260812_domain3_semantic_currentness_review_fixes.sql', import.meta.url),
  'utf8',
);
const readModel = readFileSync(
  new URL('../src/schema/20260811_signal_ontology_currentness_read_model.sql', import.meta.url),
  'utf8',
);

test('candidate content versions retain one current semantic pattern', () => {
  assert.match(currentness, /semantic_key text/);
  assert.match(currentness, /is_current boolean not null default true/);
  assert.match(currentness, /supersedes_candidate_id uuid/);
  assert.match(currentness, /live_data_signal_candidate_one_current_semantic_idx/);
  assert.match(currentness, /where is_current/);
  assert.match(currentness, /v_live_data_signal_candidate_current_v1/);
});

test('candidate persistence preserves first detection time on exact replay', () => {
  assert.match(trigger, /new\.detected_at := old\.detected_at/);
  assert.match(trigger, /new\.first_detected_at := old\.first_detected_at/);
  assert.match(trigger, /new\.last_run_id is not distinct from old\.last_run_id/);
  assert.match(trigger, /new\.supersedes_candidate_id := v_prior_current_id/);
});

test('cross-stream patterns use stable rule-specific semantic identity', () => {
  assert.match(reviewFixes, /p_rule_id = 'atlas\.domain3\.cross_category_entity' then ''/);
  assert.match(reviewFixes, /where rule_id = 'atlas\.domain3\.cross_category_entity'/);
  assert.match(reviewFixes, /create unique index live_data_signal_candidate_one_current_semantic_idx/);
});

test('historical exact-content reactivation cannot reverse the supersession chain', () => {
  assert.match(reviewFixes, /v_reactivation := old\.is_current is false/);
  assert.match(reviewFixes, /new\.last_replayed_at is distinct from old\.last_replayed_at/);
  assert.match(reviewFixes, /new\.supersedes_candidate_id := old\.supersedes_candidate_id/);
  assert.match(reviewFixes, /retired_at = v_transition_at/);
});

test('Lighthouse bridge sends Atlas candidate version and semantic identity', () => {
  assert.match(currentness, /'atlas_candidate_id', v_candidate\.candidate_id/);
  assert.match(currentness, /'atlas_candidate_hash', v_candidate\.candidate_hash/);
  assert.match(currentness, /'atlas_semantic_key', v_candidate\.semantic_key/);
  assert.match(currentness, /candidate\.is_current is true/);
  assert.match(currentness, /coalesce\(v_candidate\.first_detected_at, v_candidate\.detected_at\)/);
});

test('ontology summary excludes legacy unreceipted canonical signals but preserves their count', () => {
  assert.match(readModel, /legacy_pre_domain3_receipt_model/);
  assert.match(readModel, /legacy_suppressed_canonical_signals/);
  assert.match(readModel, /historical_signal_candidate_versions/);
  assert.match(readModel, /signal_candidate_semantic_patterns/);
  assert.match(readModel, /candidate\.is_current is true/);
});
