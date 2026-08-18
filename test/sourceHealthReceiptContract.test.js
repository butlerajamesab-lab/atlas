import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../src/schema/20260806_source_health_receipts.sql', import.meta.url),
  'utf8',
);
const openSecretsAdapter = readFileSync(
  new URL('../src/adapters/openSecretsAdapter.js', import.meta.url),
  'utf8',
);
const faraAdapter = readFileSync(
  new URL('../src/adapters/faraForeignAgentsAdapter.js', import.meta.url),
  'utf8',
);
const fecAdapter = readFileSync(
  new URL('../src/adapters/fecCampaignFinanceAdapter.js', import.meta.url),
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

test('FEC IE-only committee ingestion uses the financial totals endpoint and registered source identity', () => {
  assert.match(fecAdapter, /\/totals\/ie-only\//);
  assert.match(fecAdapter, /committee_state/);
  assert.match(fecAdapter, /sourceId:\s*'fec'/);
  assert.match(fecAdapter, /moduleHint:\s*'campaign_finance'/);
  assert.doesNotMatch(fecAdapter, /sourceId:\s*'fec_campaign_finance'/);
  assert.doesNotMatch(fecAdapter, /\/committees\/.*total_receipts/s);
});

test('FEC committee records do not label disclosed IE-only committees as dark money by themselves', () => {
  assert.match(fecAdapter, /signal_type:\s*isIndependentExpenditureOnly\s*\?\s*'independent_expenditure_committee'/);
  assert.match(fecAdapter, /dark_money_classification:\s*'not_determined_from_fec_committee_record'/);
  assert.doesNotMatch(fecAdapter, /signal_type:\s*isDarkMoney\s*\?\s*'dark_money_committee'/);
});
