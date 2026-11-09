-- =====================================================================
-- CMS Form 2567 document stream registration — WA pilot (2026-11-09)
-- =====================================================================
-- Purpose: register the document-layer stream the 2567 fetch
-- script (scripts/fetchCms2567.mjs) posts to, under the WA tuple
-- (source_id 'cms_nh', jurisdiction_id 'us_state_WA') — the pilot
-- runs against Kline Galland (CCN 505442) before the national
-- document family mirrors the deficiency families' split:
--
--   cms_nh_2567_documents   nursing_home_2567_document
--
-- A document signal carries the fetched PDF's SHA-256, byte count,
-- source URL and (CCN, survey_date, category, kind) key — the
-- join back to the deficiency events already in the reservoir on
-- cms_provider:<ccn>. Job-driven, like the other CMS loaders.
-- =====================================================================

begin;

insert into public.streams (
  stream_id, source_id, jurisdiction_id, module_hint,
  throughput_profile, safety_profile, governance_contract_id, status
) values
  ('cms_nh_2567_documents', 'cms_nh', 'us_state_WA', 'nursing_home_2567_document',
   'low', 'default', 'cms-form-2567-documents-v1', 'active')
on conflict (stream_id) do update set
  source_id = excluded.source_id,
  jurisdiction_id = excluded.jurisdiction_id,
  module_hint = excluded.module_hint,
  throughput_profile = excluded.throughput_profile,
  safety_profile = excluded.safety_profile,
  governance_contract_id = excluded.governance_contract_id,
  status = excluded.status;

commit;
