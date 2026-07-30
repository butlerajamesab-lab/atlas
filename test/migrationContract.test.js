import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationPath = new URL('../src/schema/20260726_event_entity_resolution.sql', import.meta.url);
const verifyPath = new URL('../src/schema/20260726_event_entity_resolution_verify.sql', import.meta.url);

async function sql() {
  return readFile(migrationPath, 'utf8');
}

test('migration is additive and contains no destructive SQL statement', async () => {
  const text = await sql();
  assert.doesNotMatch(text, /^\s*DELETE\s+FROM\b/im);
  assert.doesNotMatch(text, /^\s*DROP\s+(TABLE|VIEW|SCHEMA|FUNCTION|TRIGGER|INDEX)\b/im);
  assert.doesNotMatch(text, /^\s*TRUNCATE\b/im);
});

test('migration creates the resolution ledger, run ledger, and resolved correlation contracts', async () => {
  const text = await sql();
  for (const required of [
    'atlas.signal_event_entity_resolution_rule',
    'atlas.signal_event_entity_resolution_run',
    'atlas.signal_event_entity_resolution',
    'public.v_atlas_signal_event_entity_resolution_v1',
    'public.v_atlas_resolved_signal_event_entities_v1',
    'public.v_atlas_entity_cross_stream_summary_v1',
    'public.v_atlas_event_entity_resolution_coverage_v1',
    'public.v_atlas_event_entity_resolution_review_v1',
    'public.fetch_atlas_entity_cross_stream_correlations_v1',
    'public.fetch_atlas_resolved_entity_events_v1',
    'public.fetch_atlas_event_entity_resolution_review_v1',
  ]) {
    assert.match(text, new RegExp(required.replaceAll('.', '\\.'), 'i'));
  }
});

test('migration persists rule, source-field, resolver, and input-state identity', async () => {
  const text = await sql();
  for (const column of [
    'rule_id',
    'rule_version',
    'candidate_key',
    'source_field',
    'source_field_value',
    'source_identifier_field',
    'event_input_hash',
    'entity_index_hash',
    'rule_manifest_hash',
    'resolver_id',
    'resolver_version',
    'resolution_hash',
  ]) {
    assert.match(text, new RegExp(`\\b${column}\\b`));
  }
});

test('migration enforces exact outcomes and immutable rows', async () => {
  const text = await sql();
  assert.match(text, /resolved.*ambiguous.*unresolved.*ignored/s);
  assert.match(text, /no fuzzy matching/i);
  assert.match(text, /no silent merge/i);
  assert.match(text, /guard_signal_event_entity_resolution_immutable_v1/);
  assert.match(text, /candidate key mismatch/);
  assert.match(text, /event input hash mismatch/);
  assert.match(text, /source field provenance mismatch/);
  assert.match(text, /deterministic replay violation/);
});

test('migration exposes only bounded service-role RPC execution', async () => {
  const text = await sql();
  assert.match(text, /p_batch_size integer DEFAULT 500/);
  assert.match(text, /LEAST\(COALESCE\(p_batch_size, 500\), 5000\)/);
  assert.match(text, /p_rows exceeds 10000-row safety bound/);
  assert.match(text, /GRANT EXECUTE ON FUNCTION public\.fetch_atlas_signal_events_for_entity_resolution_v1/);
  assert.match(text, /GRANT EXECUTE ON FUNCTION public\.fetch_atlas_entity_cross_stream_correlations_v1/);
  assert.match(text, /GRANT EXECUTE ON FUNCTION public\.fetch_atlas_resolved_entity_events_v1/);
  assert.match(text, /GRANT EXECUTE ON FUNCTION public\.fetch_atlas_event_entity_resolution_review_v1/);
  assert.match(text, /LEAST\(COALESCE\(p_limit, 100\), 5000\)/);
  assert.doesNotMatch(text, /GRANT\s+(INSERT|UPDATE|DELETE).*signal_event_entity_resolution\s+TO\s+service_role/i);
});

test('cross-stream consumer reads canonical resolved entities rather than presentation titles', async () => {
  const text = await sql();
  const start = text.indexOf('CREATE OR REPLACE FUNCTION public.fetch_atlas_entity_cross_stream_correlations_v1');
  const end = text.indexOf('-- --------------------------------------------------------------------------\n-- Bounded event reader', start);
  const consumer = text.slice(start, end);
  assert.match(consumer, /v_atlas_entity_cross_stream_summary_v1/);
  assert.match(consumer, /v_atlas_resolved_signal_event_entities_v1/);
  assert.doesNotMatch(consumer, /title|description|plain_language/i);
});

test('review contract is deterministic, bounded, read-only, and limited to unresolved states', async () => {
  const text = await sql();
  const start = text.indexOf('CREATE OR REPLACE VIEW public.v_atlas_event_entity_resolution_review_v1');
  const end = text.indexOf('-- --------------------------------------------------------------------------\n-- Bounded event reader', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const review = text.slice(start, end);

  assert.match(review, /resolution_status IN \('ambiguous', 'unresolved'\)/);
  assert.match(review, /digest\(/);
  assert.match(review, /'sha256'/);
  assert.match(review, /rule_manifest_hash/);
  assert.match(review, /entity_index_hash/);
  assert.match(review, /candidate_sets/);
  assert.match(review, /p_resolution_status IN \('ambiguous', 'unresolved'\)/);
  assert.match(review, /LIMIT GREATEST\(1, LEAST\(COALESCE\(p_limit, 100\), 5000\)\)/);
  assert.match(review, /never creates, merges, aliases, or resolves an entity/i);
  assert.doesNotMatch(review, /\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO|FROM|atlas\.entity_registry)/i);
});

test('PostgreSQL independently recomputes the exact match result before persistence', async () => {
  const text = await sql();
  for (const required of [
    'atlas.resolve_signal_event_entity_candidate_exact_v1',
    'atlas.infer_entity_identifier_type_v1',
    'atlas.entity_type_compatible_v1',
    'SQL exact-match recomputation mismatch',
    'expected_candidate_entity_ids',
    'duplicate_external_identifier',
    'identifier_name_conflict',
    'duplicate_exact_name',
    'exact_match_entity_type_mismatch',
  ]) {
    assert.match(text, new RegExp(required.replaceAll('.', '\\.'), 'i'));
  }
  assert.match(text, /REVOKE ALL ON FUNCTION atlas\.resolve_signal_event_entity_candidate_exact_v1/);
});

test('migration locks source-specific rules and independently validates extraction normalization', async () => {
  const text = await sql();
  for (const required of [
    'signal_event_entity_resolution_rule_immutable_v1',
    'atlas_normalize_entity_name_v1',
    'atlas_normalize_entity_identifier_v1',
    'atlas_event_entity_source_value_v1',
    'source entity extraction mismatch',
    'normalized entity value mismatch',
    'normalized identifier value mismatch',
    'input manifest rule_ids do not equal the active locked rule set',
    'signal_event_entity_resolution_method_state_check',
  ]) {
    assert.match(text, new RegExp(required.replaceAll('.', '\\.'), 'i'));
  }
  assert.match(text, /d6c15b4bae26b4fb9c87f4173fcd8f880e59b1ff17e0d2e046aaeedaee9695dd/);
});

test('migration text has balanced function blocks and no duplicate SET assignment syntax', async () => {
  const text = await sql();
  const functionDelimiters = text.match(/\$function\$/g) ?? [];
  const blockDelimiters = text.match(/\$block\$/g) ?? [];
  assert.equal(functionDelimiters.length % 2, 0);
  assert.equal(blockDelimiters.length % 2, 0);
  assert.doesNotMatch(text, /SET\s+[a-z_]+\s*=.*?,\s*SET\s+[a-z_]+\s*=/is);
});

test('post-migration verification includes JS/SQL hash, normalization, extraction, and timezone parity', async () => {
  const text = await readFile(verifyPath, 'utf8');
  assert.match(text, /candidate-key JS\/SQL parity failure/);
  assert.match(text, /resolution-hash JS\/SQL parity failure/);
  assert.match(text, /event hash changes with session timezone/);
  assert.match(text, /entity-name normalization parity failure/);
  assert.match(text, /EIN normalization parity failure/);
  assert.match(text, /USAspending recipient extraction parity failure/);
  assert.match(text, /locked rule manifest row count\/hash mismatch/);
  assert.match(text, /missing bounded canonical cross-stream correlation function/);
  assert.match(text, /missing bounded resolved-entity event function/);
  assert.match(text, /missing bounded event-entity review function/);
  assert.match(text, /missing independent PostgreSQL exact-match verifier/);
  assert.match(text, /exact-match verifier base-state parity failure/);
  assert.match(text, /entity-type compatibility parity failure/);
  assert.match(text, /event-entity review projection contains an invalid status or review key/);
  assert.match(text, /duplicate deterministic review keys detected/);
  assert.match(text, /BEGIN READ ONLY/);
  assert.match(text, /ROLLBACK/);
});
