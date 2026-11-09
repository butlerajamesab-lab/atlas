-- =====================================================================
-- WA DSHS residential-care directory stream registrations (2026-11-09)
-- =====================================================================
-- Purpose: register the two Washington DSHS fortress directory
-- streams the WA DSHS adapter (src/adapters/waDshsAdapter.js) posts
-- to, under the tuple (source_id 'wa_dshs_rcs', jurisdiction_id
-- 'us_state_WA'), on Alexander's direction to build the WA AFH/ALF
-- family (2026-11-09):
--
--   wa_dshs_afh_directory   adult_family_home
--   wa_dshs_alf_directory   assisted_living_facility
--
-- The state license number is the canonical facility identity
-- (payload canonical_entity_id 'wa_dshs_license:<CLASS>:<number>'),
-- as the CCN is for the CMS nursing-home family. Directory rows
-- carry source-supplied street addresses (Civic-Map eligible);
-- coordinates are not in this source and are never invented.
--
-- These streams are JOB-DRIVEN (scripts/loadWaDshsDirectory.mjs):
-- one fortress form pull per class yields the whole state CSV,
-- and fortress generation takes minutes, so the pull runs as a
-- monthly one-off job, not a scheduler draw. Applying this
-- migration is sequenced BEFORE the first load, so the loader's
-- posts resolve their tuples.
-- =====================================================================

begin;

insert into public.streams (
  stream_id, source_id, jurisdiction_id, module_hint,
  throughput_profile, safety_profile, governance_contract_id, status
) values
  ('wa_dshs_afh_directory', 'wa_dshs_rcs', 'us_state_WA', 'adult_family_home',
   'low', 'default', 'wa-dshs-afh-directory-v1', 'active'),
  ('wa_dshs_alf_directory', 'wa_dshs_rcs', 'us_state_WA', 'assisted_living_facility',
   'low', 'default', 'wa-dshs-alf-directory-v1', 'active')
on conflict (stream_id) do update set
  source_id = excluded.source_id,
  jurisdiction_id = excluded.jurisdiction_id,
  module_hint = excluded.module_hint,
  throughput_profile = excluded.throughput_profile,
  safety_profile = excluded.safety_profile,
  governance_contract_id = excluded.governance_contract_id,
  status = excluded.status;

commit;
