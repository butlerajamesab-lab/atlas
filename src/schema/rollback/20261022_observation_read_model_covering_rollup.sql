-- Revert only the two read views and this repair-owned index. No source rows change.
begin;
set local lock_timeout='1s';
set local statement_timeout='15s';

do $preflight$
begin
  if md5(pg_get_viewdef('public.v_atlas_signal_derivation_summary_v1'::regclass,true)) <> '79d747295db7a2b9ec826e7155cc96e6'
     or md5(pg_get_viewdef('public.v_atlas_stream_runtime_summary_v1'::regclass,true)) <> '3e043c3d66e8c1313c66d962a0a855dc' then
    raise exception 'atlas_rollback_target_differs_from_verified_rollup_repair';
  end if;
end;
$preflight$;

create or replace view public.v_atlas_signal_derivation_summary_v1
with (security_invoker = true)
as
WITH observation_metrics AS MATERIALIZED (
  SELECT count(*)::bigint AS normalized_observations,
         count(event_identity_hash)::bigint AS identity_bound_observations,
         count(DISTINCT signal_type)::bigint AS observation_classifications,
         count(DISTINCT stream_id)::bigint AS streams_with_observations,
         max("timestamp") AS latest_observation_at,
         max(ingested_at) AS latest_observation_ingested_at
  FROM public.signal_events
),
latest_convergence AS (
         SELECT v_atlas_convergence_run_summary_v1.run_key,
            v_atlas_convergence_run_summary_v1.engine_version,
            v_atlas_convergence_run_summary_v1.as_of,
            v_atlas_convergence_run_summary_v1.time_window_ms,
            v_atlas_convergence_run_summary_v1.temporal_bucket_ms,
            v_atlas_convergence_run_summary_v1.geography_registry_version,
            v_atlas_convergence_run_summary_v1.analysis_registry_hash,
            v_atlas_convergence_run_summary_v1.analysis_level,
            v_atlas_convergence_run_summary_v1.rule_manifest_hash,
            v_atlas_convergence_run_summary_v1.configuration_hash,
            v_atlas_convergence_run_summary_v1.source_population_hash,
            v_atlas_convergence_run_summary_v1.transformed_population_hash,
            v_atlas_convergence_run_summary_v1.deduplicated_population_hash,
            v_atlas_convergence_run_summary_v1.total_source_rows,
            v_atlas_convergence_run_summary_v1.transformed_signal_count,
            v_atlas_convergence_run_summary_v1.deduplicated_signal_count,
            v_atlas_convergence_run_summary_v1.total_geographies,
            v_atlas_convergence_run_summary_v1.receipt_count,
            v_atlas_convergence_run_summary_v1.detected_convergence_count,
            v_atlas_convergence_run_summary_v1.resolved_receipt_count,
            v_atlas_convergence_run_summary_v1.unresolved_receipt_count,
            v_atlas_convergence_run_summary_v1.output_hash,
            v_atlas_convergence_run_summary_v1.persisted_at
           FROM v_atlas_convergence_run_summary_v1
          ORDER BY v_atlas_convergence_run_summary_v1.persisted_at DESC, v_atlas_convergence_run_summary_v1.run_key
         LIMIT 1
        )
 SELECT (SELECT normalized_observations FROM observation_metrics) AS normalized_observations,
    (SELECT identity_bound_observations FROM observation_metrics) AS identity_bound_observations,
    (SELECT observation_classifications FROM observation_metrics) AS observation_classifications,
    (SELECT streams_with_observations FROM observation_metrics) AS streams_with_observations,
    (SELECT latest_observation_at FROM observation_metrics) AS latest_observation_at,
    (SELECT latest_observation_ingested_at FROM observation_metrics) AS latest_observation_ingested_at,
    ( SELECT count(*) AS count
           FROM atlas.signals
          WHERE signals.is_suppressed IS FALSE) AS canonical_signals,
    ( SELECT count(DISTINCT signals.signal_type_id) AS count
           FROM atlas.signals
          WHERE signals.is_suppressed IS FALSE) AS canonical_signal_types,
    ( SELECT count(*) AS count
           FROM atlas.signals signal
          WHERE signal.is_suppressed IS FALSE AND (EXISTS ( SELECT 1
                   FROM atlas.signal_extractions extraction
                  WHERE extraction.signal_id = signal.id))) AS receipted_canonical_signals,
    ( SELECT count(*) AS count
           FROM atlas.signals signal
          WHERE signal.is_suppressed IS FALSE AND NOT (EXISTS ( SELECT 1
                   FROM atlas.signal_extractions extraction
                  WHERE extraction.signal_id = signal.id))) AS unreceipted_canonical_signals,
    ( SELECT count(*) AS count
           FROM atlas.signal_extractions) AS signal_extraction_receipts,
    ( SELECT max(signals.detected_at) AS max
           FROM atlas.signals
          WHERE signals.is_suppressed IS FALSE) AS latest_canonical_signal_at,
    ( SELECT count(*) AS count
           FROM atlas.live_data_signal_candidate
          WHERE live_data_signal_candidate.is_current IS TRUE) AS signal_candidates,
    ( SELECT count(*) AS count
           FROM atlas.live_data_signal_candidate
          WHERE live_data_signal_candidate.is_current IS TRUE AND live_data_signal_candidate.verification_state = 'verified'::text) AS verified_signal_candidates,
    ( SELECT count(*) AS count
           FROM atlas.live_data_signal_candidate
          WHERE live_data_signal_candidate.is_current IS TRUE AND live_data_signal_candidate.lighthouse_status = 'bridged'::text) AS bridged_signal_candidates,
    ( SELECT count(*) AS count
           FROM atlas.live_data_signal_candidate
          WHERE live_data_signal_candidate.is_current IS TRUE AND live_data_signal_candidate.lighthouse_status = 'pending'::text) AS pending_signal_candidates,
    ( SELECT count(*) AS count
           FROM atlas.live_data_signal_rule) AS signal_rule_versions,
    ( SELECT count(*) AS count
           FROM atlas.live_data_signal_rule
          WHERE live_data_signal_rule.is_active) AS active_signal_rules,
    ( SELECT max(live_data_signal_candidate.detected_at) AS max
           FROM atlas.live_data_signal_candidate
          WHERE live_data_signal_candidate.is_current IS TRUE) AS latest_signal_candidate_at,
    ( SELECT count(*) AS count
           FROM atlas.convergence_run_manifest) AS convergence_runs,
    ( SELECT count(*) AS count
           FROM atlas.convergence_receipt) AS convergence_receipts,
    ( SELECT count(*) AS count
           FROM atlas.convergence_events) AS convergence_events,
    ( SELECT latest_convergence.run_key
           FROM latest_convergence) AS latest_convergence_run_key,
    ( SELECT latest_convergence.total_source_rows
           FROM latest_convergence) AS latest_convergence_source_rows,
    ( SELECT latest_convergence.transformed_signal_count
           FROM latest_convergence) AS latest_convergence_transformed_signals,
    ( SELECT latest_convergence.deduplicated_signal_count
           FROM latest_convergence) AS latest_convergence_deduplicated_signals,
    ( SELECT latest_convergence.detected_convergence_count
           FROM latest_convergence) AS latest_detected_convergences,
    ( SELECT latest_convergence.persisted_at
           FROM latest_convergence) AS latest_convergence_at,
    ( SELECT count(*) AS count
           FROM prime_patterns) AS legacy_investigation_outputs,
    ( SELECT count(*) AS count
           FROM prime_patterns
          WHERE prime_patterns.pattern_type = 'stream_health_alert'::text) AS stream_health_alerts,
    ( SELECT count(*) AS count
           FROM prime_patterns
          WHERE prime_patterns.pattern_type <> 'stream_health_alert'::text) AS non_health_legacy_patterns,
    ( SELECT count(*) AS count
           FROM investigative_jobs) AS legacy_investigation_jobs,
    now() AS observed_at,
    ( SELECT count(*) AS count
           FROM atlas.signals
          WHERE signals.is_suppressed IS TRUE) AS legacy_suppressed_canonical_signals,
    ( SELECT count(*) AS count
           FROM atlas.live_data_signal_candidate
          WHERE live_data_signal_candidate.is_current IS FALSE) AS historical_signal_candidate_versions,
    ( SELECT count(DISTINCT live_data_signal_candidate.semantic_key) AS count
           FROM atlas.live_data_signal_candidate) AS signal_candidate_semantic_patterns,
    ( SELECT count(*) AS count
           FROM atlas.live_data_signal_candidate
          WHERE live_data_signal_candidate.is_current IS TRUE AND live_data_signal_candidate.lighthouse_status = 'failed'::text) AS failed_signal_candidates;


create or replace view public.v_atlas_stream_runtime_summary_v1
with (security_invoker = true)
as
select
  stream.stream_id,
  stream.source_id,
  stream.jurisdiction_id,
  stream.module_hint,
  stream.throughput_profile,
  stream.safety_profile,
  stream.governance_contract_id,
  stream.status,
  stream.created_at,
  stream.updated_at,
  coalesce(event_summary.event_count, 0::bigint) as event_count,
  coalesce(event_summary.identity_count, 0::bigint) as identity_count,
  coalesce(event_summary.signal_type_count, 0::bigint) as signal_type_count,
  event_summary.first_event_at,
  event_summary.latest_event_at,
  event_summary.latest_ingested_at
from public.streams as stream
left join (
  select
    event.stream_id,
    count(*)::bigint as event_count,
    count(event.event_identity_hash)::bigint as identity_count,
    count(distinct event.signal_type)::bigint as signal_type_count,
    min(event."timestamp") as first_event_at,
    max(event."timestamp") as latest_event_at,
    max(event.ingested_at) as latest_ingested_at
  from public.signal_events as event
  group by event.stream_id
) as event_summary on event_summary.stream_id = stream.stream_id;


drop index if exists public.idx_signal_events_observation_rollup_v1;
commit;
