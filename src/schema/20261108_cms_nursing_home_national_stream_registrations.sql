-- =====================================================================
-- CMS nursing-home NATIONAL stream registrations (2026-11-08)
-- =====================================================================
-- Purpose: register the four national CMS Provider Data Catalog
-- streams under the federal tuple (source_id 'cms_nh',
-- jurisdiction_id 'us_federal' — the WHD pattern), on Alexander's
-- direction "we want the whole country" (2026-11-08):
--
--   cms_nh_provider_info_national              nursing_home_provider
--   cms_nh_health_deficiencies_national        nursing_home_deficiency
--   cms_nh_fire_safety_deficiencies_national   nursing_home_fire_safety
--   cms_nh_penalties_national                  nursing_home_penalty
--
-- Washington is NOT posted into these streams: WA already lives in
-- the us_state_WA family registered by
-- 20261108_cms_nursing_home_stream_registrations.sql, and the whole
-- country is the union of the two families with zero double-count.
-- Every record carries its own state's spacetime jurisdiction and
-- the same cms_provider:<ccn> canonical identity (CCNs are
-- nationally unique).
--
-- These streams are JOB-DRIVEN (scripts/backfillCmsNational.mjs,
-- state-legged), not scheduler-driven: the source refreshes
-- monthly and a full national cycle is ~632k posts beyond WA.
-- Applying this migration is sequenced BEFORE the first national
-- leg, so the legs' posts resolve their tuples.
-- =====================================================================

begin;

insert into public.streams (
  stream_id, source_id, jurisdiction_id, module_hint,
  throughput_profile, safety_profile, governance_contract_id, status
) values
  ('cms_nh_provider_info_national', 'cms_nh', 'us_federal', 'nursing_home_provider',
   'low', 'default', 'cms-nursing-home-national-provider-v1', 'active'),
  ('cms_nh_health_deficiencies_national', 'cms_nh', 'us_federal', 'nursing_home_deficiency',
   'low', 'default', 'cms-nursing-home-national-health-deficiencies-v1', 'active'),
  ('cms_nh_fire_safety_deficiencies_national', 'cms_nh', 'us_federal', 'nursing_home_fire_safety',
   'low', 'default', 'cms-nursing-home-national-fire-safety-v1', 'active'),
  ('cms_nh_penalties_national', 'cms_nh', 'us_federal', 'nursing_home_penalty',
   'low', 'default', 'cms-nursing-home-national-penalties-v1', 'active')
on conflict (stream_id) do update set
  source_id = excluded.source_id,
  jurisdiction_id = excluded.jurisdiction_id,
  module_hint = excluded.module_hint,
  throughput_profile = excluded.throughput_profile,
  safety_profile = excluded.safety_profile,
  governance_contract_id = excluded.governance_contract_id,
  status = excluded.status;

commit;
