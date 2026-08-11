-- Current Atlas ontology projection after Domain 3 semantic-version repair.
--
-- Existing view column order is preserved for runtime compatibility. New
-- currentness/history diagnostics are appended only after the established
-- contract columns.

update atlas.signals
   set is_suppressed = true,
       suppression_reason = 'legacy_pre_domain3_receipt_model'
 where is_suppressed is distinct from true
   and not exists (
     select 1
     from atlas.signal_extractions extraction
     where extraction.signal_id = atlas.signals.id
   );

create or replace view public.v_atlas_canonical_signal_type_summary_v1
with (security_invoker = true)
as
with extraction_receipts as (
  select extraction.signal_id, count(*)::bigint as extraction_receipt_count
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
join atlas.signal_types as type on type.id = signal.signal_type_id
left join extraction_receipts as receipt on receipt.signal_id = signal.id
where signal.is_suppressed is false
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
  min(candidate.first_detected_at) as first_detected_at,
  max(candidate.detected_at) as latest_detected_at
from atlas.live_data_signal_rule as rule
left join atlas.live_data_signal_candidate as candidate
  on candidate.rule_id = rule.rule_id
 and candidate.rule_version = rule.rule_version
 and candidate.is_current is true
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
  -- Established v1 columns, unchanged and in the original order.
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
  candidate.lighthouse_bridged_at,
  -- Additive currentness/history fields.
  candidate.semantic_key,
  candidate.is_current,
  candidate.supersedes_candidate_id,
  candidate.retired_at,
  candidate.first_detected_at,
  candidate.last_replayed_at,
  candidate.first_run_id,
  candidate.last_run_id,
  candidate.lighthouse_last_error
from atlas.live_data_signal_candidate as candidate;

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
  -- Established v1 columns, unchanged and in original order.
  (select count(*)::bigint from public.signal_events) as normalized_observations,
  (select count(event_identity_hash)::bigint from public.signal_events) as identity_bound_observations,
  (select count(distinct signal_type)::bigint from public.signal_events) as observation_classifications,
  (select count(distinct stream_id)::bigint from public.signal_events) as streams_with_observations,
  (select max(timestamp) from public.signal_events) as latest_observation_at,
  (select max(ingested_at) from public.signal_events) as latest_observation_ingested_at,
  (select count(*)::bigint from atlas.signals where is_suppressed is false) as canonical_signals,
  (select count(distinct signal_type_id)::bigint from atlas.signals where is_suppressed is false) as canonical_signal_types,
  (
    select count(*)::bigint
    from atlas.signals as signal
    where signal.is_suppressed is false
      and exists (
        select 1 from atlas.signal_extractions as extraction where extraction.signal_id = signal.id
      )
  ) as receipted_canonical_signals,
  (
    select count(*)::bigint
    from atlas.signals as signal
    where signal.is_suppressed is false
      and not exists (
        select 1 from atlas.signal_extractions as extraction where extraction.signal_id = signal.id
      )
  ) as unreceipted_canonical_signals,
  (select count(*)::bigint from atlas.signal_extractions) as signal_extraction_receipts,
  (select max(detected_at) from atlas.signals where is_suppressed is false) as latest_canonical_signal_at,
  (select count(*)::bigint from atlas.live_data_signal_candidate where is_current is true) as signal_candidates,
  (select count(*)::bigint from atlas.live_data_signal_candidate where is_current is true and verification_state = 'verified') as verified_signal_candidates,
  (select count(*)::bigint from atlas.live_data_signal_candidate where is_current is true and lighthouse_status = 'bridged') as bridged_signal_candidates,
  (select count(*)::bigint from atlas.live_data_signal_candidate where is_current is true and lighthouse_status = 'pending') as pending_signal_candidates,
  (select count(*)::bigint from atlas.live_data_signal_rule) as signal_rule_versions,
  (select count(*)::bigint from atlas.live_data_signal_rule where is_active) as active_signal_rules,
  (select max(detected_at) from atlas.live_data_signal_candidate where is_current is true) as latest_signal_candidate_at,
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
  now() as observed_at,
  -- Additive currentness/history diagnostics.
  (select count(*)::bigint from atlas.signals where is_suppressed is true) as legacy_suppressed_canonical_signals,
  (select count(*)::bigint from atlas.live_data_signal_candidate where is_current is false) as historical_signal_candidate_versions,
  (select count(distinct semantic_key)::bigint from atlas.live_data_signal_candidate) as signal_candidate_semantic_patterns,
  (select count(*)::bigint from atlas.live_data_signal_candidate where is_current is true and lighthouse_status = 'failed') as failed_signal_candidates;

comment on view public.v_atlas_signal_candidate_rule_summary_v1 is
  'Current semantic Domain 3 candidate versions only; historical versions remain in candidate detail.';
comment on view public.v_atlas_signal_derivation_summary_v1 is
  'Current ontology summary with additive legacy/currentness diagnostics; established column order is preserved.';
