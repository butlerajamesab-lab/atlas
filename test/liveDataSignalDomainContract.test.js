import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(
  new URL('../src/schema/20260731_signal_event_identity_and_live_data_detection.sql', import.meta.url),
  'utf8',
);
const hardening = fs.readFileSync(
  new URL('../src/schema/20260731_signal_event_identity_hardening.sql', import.meta.url),
  'utf8',
);
const streamStore = fs.readFileSync(
  new URL('../src/services/streamStore.js', import.meta.url),
  'utf8',
);
const ingestRoute = fs.readFileSync(
  new URL('../src/routes/ingest.js', import.meta.url),
  'utf8',
);
const scheduler = fs.readFileSync(
  new URL('../src/services/scheduler.js', import.meta.url),
  'utf8',
);
const server = fs.readFileSync(
  new URL('../src/server.js', import.meta.url),
  'utf8',
);
const ingestClient = fs.readFileSync(
  new URL('../src/adapters/ingestClient.js', import.meta.url),
  'utf8',
);

test('event identity suppresses replay without deleting historical evidence', () => {
  assert.match(migration, /create table if not exists atlas\.signal_event_identity/i);
  assert.match(migration, /historical_event_count bigint/i);
  assert.match(migration, /replay_count bigint/i);
  assert.match(migration, /create unique index if not exists signal_events_identity_uidx/i);
  assert.match(migration, /replays_suppressed/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.signal_events/i);
  assert.doesNotMatch(migration, /truncate\s+.*signal_events/i);
  assert.doesNotMatch(migration, /drop\s+table\s+.*signal_events/i);
});

test('ingestion delegates offset allocation and replay decisions to one database transaction', () => {
  assert.match(streamStore, /persist_signal_event_batch_v2/);
  assert.doesNotMatch(streamStore, /nextOffsetForStream/);
  assert.match(ingestRoute, /replayed_count/);
  assert.match(ingestRoute, /cursor_before/);
  assert.match(ingestRoute, /cursor_after/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /select coalesce\(max\("offset"\) \+ 1, 0\)/);
});

test('partial-page failure preserves committed progress and a truthful run receipt', () => {
  assert.match(hardening, /begin\n      if coalesce\(v_event->>'stream_id'/);
  assert.match(hardening, /exception when others then/);
  assert.match(hardening, /v_status := case/);
  assert.match(hardening, /when v_inserted > 0 or v_replayed > 0 then 'partial'/);
  assert.match(hardening, /partial_completion = v_status = 'partial'/);
  assert.match(hardening, /'records_failed', v_failed/);
  assert.match(ingestRoute, /status === 'partial' \? 207/);
});

test('Lighthouse export reads only canonical unique identities and reports replay-aware freshness', () => {
  assert.match(migration, /create or replace function public\.get_lighthouse_signal_events/);
  assert.match(hardening, /from atlas\.signal_event_identity identity/);
  assert.match(hardening, /event\."offset" = identity\.canonical_offset/);
  assert.match(hardening, /identity\.last_seen_at as ingested_at/);
});

test('Domain 3 detector uses unique source records and exact entity resolution', () => {
  assert.match(migration, /identity_unit', 'unique external_id plus pdf_url'/);
  assert.match(hardening, /group by normalized_entity_name, source_record_key/);
  assert.match(hardening, /where entity\.match_count = 1/);
  assert.match(hardening, /unresolved_unique_record_count/);
  assert.match(hardening, /unresolved_unique_rate/);
  assert.match(hardening, /historical_raw_event_count/);
  assert.match(hardening, /canonical_event_count/);
  assert.match(hardening, /entity_registry_primary_name_exact/);
  assert.match(hardening, /data-quality observation, not a misconduct or legal finding/);
});

test('Domain 3 output requires explicit evidence, statistics, entity, severity, confidence, rule, and engine', () => {
  for (const token of [
    'source_event_refs jsonb not null',
    'entity_resolution_status text not null',
    'severity text not null',
    'confidence_score numeric(7,6) not null',
    'supporting_statistics jsonb not null',
    'rule_contract_hash text not null',
    'engine_id text not null',
    'engine_version text not null',
  ]) {
    assert.match(migration, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('canonical scheduler runs Domain 3 and quarantines legacy mixed transport', () => {
  assert.match(scheduler, /runLiveDataSignalBridge/);
  assert.match(scheduler, /Domain 3 detection\/bridge scheduled/);
  assert.match(scheduler, /legacy_mixed_signal_transport_disabled/);
  assert.doesNotMatch(scheduler, /import \{ runBridgeDrain \}/);
});

test('all non-health service routes require private bearer tokens', () => {
  assert.match(server, /requireBearerToken\('ATLAS_CONTROL_TOKEN'\)/);
  assert.match(server, /requireBearerToken\('ATLAS_INGEST_TOKEN'\)/);
  assert.match(server, /app\.use\('\/v1\/ingest', requireIngest\)/);
  assert.match(server, /app\.use\('\/scheduler', requireControl\)/);
  assert.match(ingestClient, /Authorization: `Bearer \$\{ingestToken\}`/);
  assert.match(ingestClient, /ATLAS_INGEST_TOKEN is required/);
});

test('new Atlas-owned tables are RLS enabled and not granted to browser roles', () => {
  for (const table of [
    'signal_event_identity',
    'signal_event_ingest_run',
    'live_data_signal_rule',
    'live_data_signal_run',
    'live_data_signal_candidate',
  ]) {
    assert.match(migration, new RegExp(`alter table atlas\\.${table} enable row level security`, 'i'));
    assert.match(migration, new RegExp(`revoke all on table atlas\\.${table} from public, anon, authenticated`, 'i'));
  }
});