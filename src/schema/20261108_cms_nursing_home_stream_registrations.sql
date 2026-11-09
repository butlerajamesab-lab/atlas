-- =====================================================================
-- CMS nursing-home stream registrations (2026-11-08)
-- =====================================================================
-- Purpose: register the four Washington-first CMS Provider Data
-- Catalog streams the nursing-home adapter
-- (src/adapters/cmsNursingHomeAdapter.js) posts to, under the tuple
-- family (source_id 'cms_nh', jurisdiction_id 'us_state_WA'):
--
--   cms_nh_provider_info              module nursing_home_provider
--   cms_nh_health_deficiencies        module nursing_home_deficiency
--   cms_nh_fire_safety_deficiencies   module nursing_home_fire_safety
--   cms_nh_penalties                  module nursing_home_penalty
--
-- Source class: graded inspector findings from the federal Care
-- Compare program (health + fire-safety deficiency citations with
-- scope/severity grades and correction state, penalties, and the
-- facility registry with ratings and staffing) — the WHD class of
-- source, for the nursing-home side. Scope and first-hand field
-- verification: CMS-NURSING-HOME-SCOPE-2026-11-08.md in the
-- Luminari recovery workspace (2026-11-08).
--
-- Placement rule (UI in Lighthouse, data API in Atlas): these rows
-- live in Atlas public.streams. Applying this migration is a
-- separate approved step, sequenced BEFORE the adapter's first
-- scheduled run, so the adapter's first posts resolve their tuples.
-- =====================================================================

begin;

insert into public.streams (
  stream_id, source_id, jurisdiction_id, module_hint,
  throughput_profile, safety_profile, governance_contract_id, status
) values
  ('cms_nh_provider_info', 'cms_nh', 'us_state_WA', 'nursing_home_provider',
   'low', 'default', 'cms-nursing-home-provider-v1', 'active'),
  ('cms_nh_health_deficiencies', 'cms_nh', 'us_state_WA', 'nursing_home_deficiency',
   'low', 'default', 'cms-nursing-home-health-deficiencies-v1', 'active'),
  ('cms_nh_fire_safety_deficiencies', 'cms_nh', 'us_state_WA', 'nursing_home_fire_safety',
   'low', 'default', 'cms-nursing-home-fire-safety-v1', 'active'),
  ('cms_nh_penalties', 'cms_nh', 'us_state_WA', 'nursing_home_penalty',
   'low', 'default', 'cms-nursing-home-penalties-v1', 'active')
on conflict (stream_id) do update set
  source_id = excluded.source_id,
  jurisdiction_id = excluded.jurisdiction_id,
  module_hint = excluded.module_hint,
  throughput_profile = excluded.throughput_profile,
  safety_profile = excluded.safety_profile,
  governance_contract_id = excluded.governance_contract_id,
  status = excluded.status;

commit;
