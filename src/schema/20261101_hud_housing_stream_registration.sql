-- =====================================================================
-- HUD housing stream registration (repair, 2026-11-01)
-- =====================================================================
-- Problem: since the 2026-11-01 repair merge (PR #84) cleared the
-- adapter's fetch-stage defect (FIPS '53' -> 'WA' on the HUD statedata
-- call), every hud_housing run now reaches ingest and fails there:
--   "atlas_ingest_failed batch=0 status=404 detail=No uniquely
--    registered stream found for signal index 0 source=hud_fmr
--    jurisdiction=us_state_WA module=housing"
-- First observed on the post-merge startup run, 2026-11-01 11:21:55Z,
-- Atlas action receipt fe94933982497d0686eef51188bac11828d99377804dece87e77471b14339cbd.
--
-- Cause (src/services/streamStore.js, findStream): the resolver looks
-- up public.streams first by stream_id = the adapter's source_id, then
-- by rows carrying that source_id. The HUD adapter
-- (src/adapters/hudHousingAdapter.js, ingestHudSignals) posts
--   source_id       = 'hud_fmr'
--   jurisdiction_id = 'us_state_WA'   (via resolveStateAbbr)
--   module_hint     = 'housing'
-- A public.streams row for this stream EXISTS (verified live
-- 2026-11-01 against the Atlas Supabase project), but it carries a
-- different tuple:
--   stream_id = 'hud_housing', source_id = 'hud',
--   jurisdiction_id = 'us_national', module_hint = 'housing'
-- stream_id 'hud_fmr' does not exist and no row carries source_id
-- 'hud_fmr', so the resolver fails closed, by design. Same defect
-- class as the BLS registration gap
-- (src/schema/20261031_bls_employment_stream_registration.sql).
--
-- Fix: retarget the existing hud_housing row to the adapter's exact
-- tuple, preserving the row's existing throughput_profile ('medium'),
-- safety_profile ('default'), governance_contract_id
-- ('atlas-hud-housing-v1') and status ('active') — all verified live
-- 2026-11-01. Nothing else posts as source 'hud' to the governed
-- ingest path (the row's old tuple appears to be a pre-adapter
-- registration), so retargeting strands no other writer.
--
-- Placement: this file belongs in src/schema/ with the other dated
-- migrations and is applied through the repo's normal migration
-- pipeline (e.g. scripts/apply-sql-management-api.mjs) against the
-- Atlas Supabase project. It has NOT been applied; it is a prepared,
-- merge-ready artifact. Applying it is a separate approved step,
-- together with the BLS registration.
-- =====================================================================

begin;

insert into public.streams (
  stream_id, source_id, jurisdiction_id, module_hint,
  throughput_profile, safety_profile, governance_contract_id, status
) values (
  'hud_housing',
  'hud_fmr',
  'us_state_WA',
  'housing',
  'medium',
  'default',
  'atlas-hud-housing-v1',
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
