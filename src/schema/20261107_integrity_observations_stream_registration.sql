-- =====================================================================
-- Integrity observations stream registration (2026-11-07)
-- =====================================================================
-- Purpose: give governed source adapters a door for DECLARED
-- integrity observations — the only input the Domain 3 integrity
-- engine (src/services/integrityPatternDetectorService.js, rules
-- atlas.domain3.integrity.*) will detect over. The engine reads
-- payload.integrity_observation declarations from signal_events
-- during the full replay; no adapter could lawfully feed it because
-- no stream was registered for declarations.
--
-- The WHD adapter (src/adapters/dolWhdAdapter.js) is the first
-- declarant: for each concluded case with a findings_end_date it
-- posts one declared_numeric_observation signal carrying the
-- findings period's declared range (dataset coverage start
-- 2005-01-01 .. the record's own load_dt). It posts with the tuple
--   source_id       = 'atlas_integrity'
--   jurisdiction_id = 'us_federal'
--   module_hint     = 'integrity_observation'
-- so this row must carry exactly that tuple under the stream_id
-- 'atlas_integrity_observations' (src/services/streamStore.js
-- findStream resolves by source tuple; no row currently carries
-- source_id 'atlas_integrity', so resolution is unique).
--
-- Naming note: the replay loads observations ordered by stream_id
-- under a 100,000-event cap, and chicago_311's volume closes that
-- window today. A stream_id sorting first keeps declared
-- observations — few, deliberate, and the integrity engine's only
-- lawful input — inside the scanned population by construction.
--
-- Placement: src/schema/ with the other dated migrations, applied
-- through the repo's normal migration pipeline against the Atlas
-- Supabase project (public.streams lives there; verified
-- 2026-11-07). Applying it is a separate approved step, sequenced
-- BEFORE the WHD declaration adapter deploys, so the adapter's
-- first declaration post resolves.
-- =====================================================================

begin;

insert into public.streams (
  stream_id, source_id, jurisdiction_id, module_hint,
  throughput_profile, safety_profile, governance_contract_id, status
) values (
  'atlas_integrity_observations',
  'atlas_integrity',
  'us_federal',
  'integrity_observation',
  'low',
  'default',
  'atlas-integrity-observations-v1',
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
