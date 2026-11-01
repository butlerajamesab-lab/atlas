-- =====================================================================
-- BLS employment stream registration (repair, 2026-10-31)
-- =====================================================================
-- Problem: the governed ingest path fails every bls_employment run
-- with HTTP 404:
--   "No uniquely registered stream found for signal index 0
--    source=bls_laus jurisdiction=us_state_WA module=employment"
--
-- Cause (src/services/streamStore.js, findStream): the resolver looks
-- up public.streams first by stream_id = the adapter's source_id,
-- then by rows carrying that source_id. The BLS adapter
-- (src/adapters/blsEmploymentAdapter.js) posts
--   source_id      = 'bls_laus'
--   jurisdiction_id = 'us_state_WA'
--   module_hint     = 'employment'
-- but NO registration for it exists anywhere registrations live:
-- not in scripts/register-streams.mjs (8 rows), not in
-- src/services/publicStreamCatalog.js (6 rows), and not in any SQL
-- migration (the civic_genome migration is the only stream insert).
-- With zero candidate rows the resolver fails closed, by design.
-- (The 5 historical BLS observations arrived via
-- scripts/run-all-direct.mjs, which writes signal_events directly
-- with an explicit stream_id and bypasses the resolver entirely.)
--
-- Fix: register the stream with the adapter's exact tuple, following
-- the civic_genome migration's insert pattern. stream_id matches the
-- scheduler's ADAPTER_STREAM_IDS entry ('bls_employment').
--
-- Placement: this file belongs in src/schema/ with the other dated
-- migrations and is applied through the repo's normal migration
-- pipeline (e.g. scripts/apply-sql-management-api.mjs) against the
-- Atlas Supabase project. It has NOT been applied by the repair
-- batch; it is a prepared, merge-ready artifact.
-- =====================================================================

begin;

insert into public.streams (
  stream_id, source_id, jurisdiction_id, module_hint,
  throughput_profile, safety_profile, governance_contract_id, status
) values (
  'bls_employment',
  'bls_laus',
  'us_state_WA',
  'employment',
  'low',
  'default',
  'atlas-bls-employment-v1',
  'active'
)
on conflict (stream_id) do update set
  source_id = excluded.source_id,
  jurisdiction_id = excluded.jurisdiction_id,
  module_hint = excluded.module_hint,
  throughput_profile = excluded.throughput_profile,
  safety_profile = excluded.safety_profile,
  governance_contract_id = excluded.governance_contract_id,
  status = excluded.status;

commit;
