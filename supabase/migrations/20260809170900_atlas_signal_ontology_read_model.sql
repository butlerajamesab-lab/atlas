-- Restore the canonical Atlas ontology at the read-model boundary.
--
-- The compatibility table public.signal_events is the normalized observation
-- event store used by the streaming runtime. A row in that table is not, by
-- itself, a derived civic signal. Derived signal populations and convergence
-- outputs remain separately counted and separately receipted here.

create or replace view public.v_atlas_observation_type_summary_v1
with (security_invoker = true)
as
select
  event.stream_id,
  event.signal_type as observation_classification,
  event.module_hint,
  event.jurisdiction_id,
  count(*)::bigint as observation_count,
  count(event.event_identity_hash)::bigint as identity_bound_observation_count,
  min(event.timestamp) as first_observed_at,
  max(event.timestamp) as latest_observed_at,
  max(event.ingested_at) as latest_ingested_at
from public.signal_events as event
group by
  event.stream_id,
  event.signal_type,
  event.module_hint,
  event.jurisdiction_id;

create or replace view public.v_atlas_canonical_signal_type_summary_v1
with (security_invoker = true)
as
with extraction_receipts as (
  select
    extraction.signal_id,
    count(*)::bigint as extraction_receipt_count
  from atlas.signal_extractions as extraction
  group by extraction.signal_id
)
select
  type.type_code as signal_type_code,
  type.type_name as signal_type_name,
  type.category,
  type.detection_method,
  signal.source_domain,
  signal.source_table,
  count(*)::bigint as signal_count,
  count(*) filter (where signal.fingerprint_hash is not null)::bigint as fingerprinted_signal_count,
  count(*) filter (where signal.is_suppressed)::bigint as suppressed_signal_count,
  count(*) filter (where coalesce(receipt.extraction_receipt_count, 0) > 0)::bigint as receipted_signal_count,
  coalesce(sum(receipt.extraction_receipt_count), 0)::bigint as extraction_receipt_count,
  round(avg(signal.normalized_score), 6) as mean_normalized_score,
  round(avg(signal.confidence), 6) as mean_confidence,
  min(signal.detected_at) as first_detected_at,
  max(signal.detected_at) as latest_detected_at
from atlas.signals as signal
join atlas.signal_types as type
  on type.id = signal.signal_type_id
left join extraction_receipts as receipt
  on receipt.signal_id = signal.id
group by
  type.type_code,
  type.type_name,
  type.category,
  type.detection_method,
  signal.source_domain,
  signal.source_table;

create or replace view public.v_atlas_signal_candidate_rule_summary_v1
with (security_invoker = true)
as
select
  rule.rule_id,
  rule.rule_version,
  rule.signal_type,
  rule.engine_id,
  rule.engine_version,
  rule.rule_contract_hash,
  rule.rule_contract,
  rule.is_active,
  count(candidate.candidate_id)::bigint as candidate_count,
  count(candidate.candidate_id) filter (where candidate.verification_state = 'verified')::bigint as verified_candidate_count,
  count(candidate.candidate_id) filter (where candidate.lighthouse_status = 'bridged')::bigint as bridged_candidate_count,
  count(candidate.candidate_id) filter (where candidate.lighthouse_status = 'pending')::bigint as pending_candidate_count,
  count(candidate.candidate_id) filter (where candidate.lighthouse_status = 'failed')::bigint as failed_candidate_count,
  min(candidate.detected_at) as first_detected_at,
  max(candidate.detected_at) as latest_detected_at
from atlas.live_data_signal_rule as rule
left join atlas.live_data_signal_candidate as candidate
  on candidate.rule_id = rule.rule_id
 and candidate.rule_version = rule.rule_version
group by
  rule.rule_id,
  rule.rule_version,
  rule.signal_type,
  rule.engine_id,
  rule.engine_version,
  rule.rule_contract_hash,
  rule.rule_contract,
  rule.is_active;

create or replace view public.v_atlas_signal_candidate_detail_v1
with (security_invoker = true)
as
select
  candidate.candidate_id,
  candidate.candidate_hash,
  candidate.rule_id,
  candidate.rule_version,
  candidate.rule_contract_hash,
  candidate.engine_id,
  candidate.engine_version,
  candidate.signal_type,
  candidate.title,
  candidate.description,
  candidate.primary_stream_id,
  candidate.source_event_refs,
  candidate.entity_ids,
  candidate.entity_resolution_status,
  candidate.jurisdiction_id,
  candidate.severity,
  candidate.confidence_score,
  candidate.verification_state,
  candidate.supporting_statistics,
  candidate.evidence_refs,
  candidate.source_freshness_at,
  candidate.detected_at,
  candidate.source_input_hash,
  candidate.lighthouse_status,
  candidate.lighthouse_record_id,
  candidate.lighthouse_bridged_at
from atlas.live_data_signal_candidate as candidate;

create or replace view public.v_atlas_convergence_run_summary_v1
with (security_invoker = true)
as
select
  manifest.run_key,
  manifest.engine_version,
  manifest.as_of,
  manifest.time_window_ms,
  manifest.temporal_bucket_ms,
  manifest.geography_registry_version,
  manifest.analysis_registry_hash,
  manifest.analysis_level,
  manifest.rule_manifest_hash,
  manifest.configuration_hash,
  manifest.source_population_hash,
  manifest.transformed_population_hash,
  manifest.deduplicated_population_hash,
  manifest.total_source_rows,
  manifest.total_signals_raw as transformed_signal_count,
  manifest.total_signals_deduplicated as deduplicated_signal_count,
  manifest.total_geographies,
  manifest.receipt_count,
  coalesce(receipt.detected_convergence_count, 0)::bigint as detected_convergence_count,
  coalesce(receipt.resolved_receipt_count, 0)::bigint as resolved_receipt_count,
  coalesce(receipt.unresolved_receipt_count, 0)::bigint as unresolved_receipt_count,
  manifest.output_hash,
  manifest.persisted_at
from atlas.convergence_run_manifest as manifest
left join lateral (
  select
    count(*) filter (where item.convergence_detected)::bigint as detected_convergence_count,
    count(*) filter (where item.status = 'resolved')::bigint as resolved_receipt_count,
    count(*) filter (where item.status <> 'resolved')::bigint as unresolved_receipt_count
  from atlas.convergence_receipt as item
  where item.run_key = manifest.run_key
) as receipt on true;

create or replace view public.v_atlas_signal_derivation_summary_v1
with (security_invoker = true)
as
with latest_convergence as (
  select *
  from public.v_atlas_convergence_run_summary_v1
  order by persisted_at desc, run_key
  limit 1
)
select
  (select count(*)::bigint from public.signal_events) as normalized_observations,
  (select count(event_identity_hash)::bigint from public.signal_events) as identity_bound_observations,
  (select count(distinct signal_type)::bigint from public.signal_events) as observation_classifications,
  (select count(distinct stream_id)::bigint from public.signal_events) as streams_with_observations,
  (select max(timestamp) from public.signal_events) as latest_observation_at,
  (select max(ingested_at) from public.signal_events) as latest_observation_ingested_at,
  (select count(*)::bigint from atlas.signals) as canonical_signals,
  (select count(distinct signal_type_id)::bigint from atlas.signals) as canonical_signal_types,
  (
    select count(*)::bigint
    from atlas.signals as signal
    where exists (
      select 1 from atlas.signal_extractions as extraction where extraction.signal_id = signal.id
    )
  ) as receipted_canonical_signals,
  (
    select count(*)::bigint
    from atlas.signals as signal
    where not exists (
      select 1 from atlas.signal_extractions as extraction where extraction.signal_id = signal.id
    )
  ) as unreceipted_canonical_signals,
  (select count(*)::bigint from atlas.signal_extractions) as signal_extraction_receipts,
  (select max(detected_at) from atlas.signals) as latest_canonical_signal_at,
  (select count(*)::bigint from atlas.live_data_signal_candidate) as signal_candidates,
  (select count(*)::bigint from atlas.live_data_signal_candidate where verification_state = 'verified') as verified_signal_candidates,
  (select count(*)::bigint from atlas.live_data_signal_candidate where lighthouse_status = 'bridged') as bridged_signal_candidates,
  (select count(*)::bigint from atlas.live_data_signal_candidate where lighthouse_status = 'pending') as pending_signal_candidates,
  (select count(*)::bigint from atlas.live_data_signal_rule) as signal_rule_versions,
  (select count(*)::bigint from atlas.live_data_signal_rule where is_active) as active_signal_rules,
  (select max(detected_at) from atlas.live_data_signal_candidate) as latest_signal_candidate_at,
  (select count(*)::bigint from atlas.convergence_run_manifest) as convergence_runs,
  (select count(*)::bigint from atlas.convergence_receipt) as convergence_receipts,
  (select count(*)::bigint from atlas.convergence_events) as convergence_events,
  (select run_key from latest_convergence) as latest_convergence_run_key,
  (select total_source_rows from latest_convergence) as latest_convergence_source_rows,
  (select transformed_signal_count from latest_convergence) as latest_convergence_transformed_signals,
  (select deduplicated_signal_count from latest_convergence) as latest_convergence_deduplicated_signals,
  (select detected_convergence_count from latest_convergence) as latest_detected_convergences,
  (select persisted_at from latest_convergence) as latest_convergence_at,
  (select count(*)::bigint from public.prime_patterns) as legacy_investigation_outputs,
  (select count(*)::bigint from public.prime_patterns where pattern_type = 'stream_health_alert') as stream_health_alerts,
  (select count(*)::bigint from public.prime_patterns where pattern_type <> 'stream_health_alert') as non_health_legacy_patterns,
  (select count(*)::bigint from public.investigative_jobs) as legacy_investigation_jobs,
  now() as observed_at;

create or replace view public.v_atlas_ui_overview_v3
with (security_invoker = true)
as
select
  now() as observed_at,
  coalesce(
    (select jsonb_agg(to_jsonb(stream_row) order by stream_row.stream_id)
       from public.v_atlas_stream_runtime_summary_v1 as stream_row),
    '[]'::jsonb
  ) as streams,
  coalesce(
    (select jsonb_agg(to_jsonb(source_row) order by source_row.source_name)
       from public.v_atlas_source_operational_readiness_v1 as source_row),
    '[]'::jsonb
  ) as sources,
  (select to_jsonb(summary_row)
     from public.v_atlas_signal_derivation_summary_v1 as summary_row) as derivation;

create or replace view public.v_atlas_ui_signal_derivation_v3
with (security_invoker = true)
as
select
  now() as observed_at,
  (select to_jsonb(summary_row)
     from public.v_atlas_signal_derivation_summary_v1 as summary_row) as summary,
  coalesce(
    (select jsonb_agg(to_jsonb(type_row) order by type_row.observation_count desc, type_row.stream_id, type_row.observation_classification)
       from (
         select *
         from public.v_atlas_observation_type_summary_v1
         order by observation_count desc, stream_id, observation_classification
         limit 250
       ) as type_row),
    '[]'::jsonb
  ) as observation_classifications,
  coalesce(
    (select jsonb_agg(to_jsonb(signal_row) order by signal_row.signal_count desc, signal_row.signal_type_code, signal_row.source_table)
       from public.v_atlas_canonical_signal_type_summary_v1 as signal_row),
    '[]'::jsonb
  ) as canonical_signal_types,
  coalesce(
    (select jsonb_agg(to_jsonb(rule_row) order by rule_row.rule_id, rule_row.rule_version)
       from public.v_atlas_signal_candidate_rule_summary_v1 as rule_row),
    '[]'::jsonb
  ) as candidate_rules,
  coalesce(
    (select jsonb_agg(to_jsonb(run_row) order by run_row.persisted_at desc, run_row.run_key)
       from (
         select *
         from public.v_atlas_convergence_run_summary_v1
         order by persisted_at desc, run_key
         limit 25
       ) as run_row),
    '[]'::jsonb
  ) as convergence_runs;

comment on view public.v_atlas_observation_type_summary_v1 is
  'Normalized observation classifications from the legacy-named signal_events compatibility store; rows are not derived civic signals.';
comment on view public.v_atlas_signal_derivation_summary_v1 is
  'Separates observation volume, canonical signals, governed candidates, convergence receipts, and legacy investigation outputs.';
comment on view public.v_atlas_ui_signal_derivation_v3 is
  'Compact Atlas UI read model preserving the source -> observation -> signal -> convergence ontology.';

revoke all on public.v_atlas_observation_type_summary_v1 from public, anon, authenticated;
revoke all on public.v_atlas_canonical_signal_type_summary_v1 from public, anon, authenticated;
revoke all on public.v_atlas_signal_candidate_rule_summary_v1 from public, anon, authenticated;
revoke all on public.v_atlas_signal_candidate_detail_v1 from public, anon, authenticated;
revoke all on public.v_atlas_convergence_run_summary_v1 from public, anon, authenticated;
revoke all on public.v_atlas_signal_derivation_summary_v1 from public, anon, authenticated;
revoke all on public.v_atlas_ui_overview_v3 from public, anon, authenticated;
revoke all on public.v_atlas_ui_signal_derivation_v3 from public, anon, authenticated;

grant select on public.v_atlas_observation_type_summary_v1 to service_role;
grant select on public.v_atlas_canonical_signal_type_summary_v1 to service_role;
grant select on public.v_atlas_signal_candidate_rule_summary_v1 to service_role;
grant select on public.v_atlas_signal_candidate_detail_v1 to service_role;
grant select on public.v_atlas_convergence_run_summary_v1 to service_role;
grant select on public.v_atlas_signal_derivation_summary_v1 to service_role;
grant select on public.v_atlas_ui_overview_v3 to service_role;
grant select on public.v_atlas_ui_signal_derivation_v3 to service_role;
