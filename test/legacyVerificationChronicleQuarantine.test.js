import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../src/schema/20260804_legacy_verification_chronicle_quarantine.sql', import.meta.url),
  'utf8',
);

const legacyTables = [
  'extraction_candidates',
  'verification_claims',
  'verification_evidence',
  'verification_sources',
  'verified_chronicle',
  'canonical_extracted_records',
];

const legacyViews = [
  'v_chronicle_verification_status',
  'v_canonical_record_quality',
  'v_actionable_canonical_records',
];

test('legacy verification tables are preserved and removed from browser circulation', () => {
  for (const table of legacyTables) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
    assert.match(
      migration,
      new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`, 'i'),
    );
    assert.match(
      migration,
      new RegExp(`grant select, insert, update, delete on table public\\.${table} to service_role`, 'i'),
    );
  }

  assert.doesNotMatch(migration, /\bdrop\s+(table|view)\b/i);
  assert.doesNotMatch(migration, /\btruncate\b/i);
  assert.doesNotMatch(migration, /\bdelete\s+from\b/i);
});

test('legacy views are invoker-owned and service-role-only', () => {
  for (const view of legacyViews) {
    assert.match(migration, new RegExp(`alter view public\\.${view} set \\(security_invoker = true\\)`, 'i'));
    assert.match(
      migration,
      new RegExp(`revoke all on table public\\.${view} from public, anon, authenticated`, 'i'),
    );
    assert.match(migration, new RegExp(`grant select on table public\\.${view} to service_role`, 'i'));
  }
});

test('legacy helper and mutation functions are pinned and service-role-only', () => {
  for (const name of [
    'evaluate_canonical_payload_usefulness',
    'ingest_canonical_extracted_record',
    'ingest_canonical_extracted_record_batch',
    'ingest_extraction_candidate_batch',
    'jsonb_array_count',
    'promote_verified_chronicle',
    'set_updated_at',
  ]) {
    assert.match(migration, new RegExp(`alter function public\\.${name}`, 'i'));
    assert.match(migration, new RegExp(`revoke execute on function public\\.${name}`, 'i'));
    assert.match(migration, new RegExp(`grant execute on function public\\.${name}`, 'i'));
  }
});

test('allowlisted Lighthouse stream export RPCs remain outside this quarantine', () => {
  assert.doesNotMatch(migration, /alter function public\.get_lighthouse_signal_events/i);
  assert.doesNotMatch(migration, /alter function public\.get_lighthouse_stream_definition/i);
});
