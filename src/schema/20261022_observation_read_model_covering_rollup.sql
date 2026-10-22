-- Atlas live read-model I/O repair. Original events remain unchanged.
-- The installed observation classifier needs four grouping fields; its existing
-- covering index omits module_hint and jurisdiction_id, forcing a 1.2 GB heap scan.
-- Reuse that exact classifier for metrics and stream rollups so no wide global
-- COUNT(DISTINCT) sort is required. Counts, NULL semantics and view identities remain.
begin;
set local lock_timeout = '1s';
-- Bounds this migration's index build, not application statement timeouts.
set local statement_timeout = '45s';

do $preflight$
begin
  if md5(pg_get_viewdef('public.v_atlas_observation_type_summary_v1'::regclass,true)) <> 'ed9b9d5d2e72fd35a2cb4463e1a6d582'
     or md5(pg_get_viewdef('public.v_atlas_signal_derivation_summary_v1'::regclass,true)) <> '3af40c8988b950d01d97ed6a7cca5bfa'
     or md5(pg_get_viewdef('public.v_atlas_stream_runtime_summary_v1'::regclass,true)) <> '2635c5a221bb3ad83947fc804c839e2f' then
    raise exception 'atlas_read_model_definition_differs_from_reviewed_prior';
  end if;
  if to_regclass('public.idx_signal_events_observation_rollup_v1') is not null then
    raise exception 'atlas_observation_rollup_index_already_exists_inspect_before_reapplying';
  end if;
end;
$preflight$;

create index idx_signal_events_observation_rollup_v1
on public.signal_events (stream_id, signal_type, module_hint, jurisdiction_id)
include (event_identity_hash, "timestamp", ingested_at);

create or replace view public.v_atlas_signal_derivation_summary_v1
with (security_invoker = true)
as
WITH observation_metrics AS MATERIALIZED (
  SELECT coalesce(sum(observation_count), 0)::bigint AS normalized_observations,
         coalesce(sum(identity_bound_observation_count), 0)::bigint AS identity_bound_observations,
         count(DISTINCT observation_classification)::bigint AS observation_classifications,
         count(DISTINCT stream_id)::bigint AS streams_with_observations,
         max(latest_observed_at) AS latest_observation_at,
         max(latest_ingested_at) AS latest_observation_ingested_at
  FROM public.v_atlas_observation_type_summary_v1
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
    sum(event.observation_count)::bigint as event_count,
    sum(event.identity_bound_observation_count)::bigint as identity_count,
    count(distinct event.observation_classification)::bigint as signal_type_count,
    min(event.first_observed_at) as first_event_at,
    max(event.latest_observed_at) as latest_event_at,
    max(event.latest_ingested_at) as latest_ingested_at
  from public.v_atlas_observation_type_summary_v1 as event
  group by event.stream_id
) as event_summary on event_summary.stream_id = stream.stream_id;


do $postflight$
begin
  if not exists (select 1 from pg_index where indexrelid='public.idx_signal_events_observation_rollup_v1'::regclass and indisvalid and indisready) then
    raise exception 'atlas_observation_rollup_index_not_valid';
  end if;
  if exists (select 1 from pg_class where oid in ('public.v_atlas_signal_derivation_summary_v1'::regclass,'public.v_atlas_stream_runtime_summary_v1'::regclass) and not ('security_invoker=true'=any(reloptions))) then
    raise exception 'atlas_read_model_invoker_security_changed';
  end if;
  if (select count(*) from pg_attribute where attrelid='public.v_atlas_signal_derivation_summary_v1'::regclass and attnum>0 and not attisdropped) <> 37
     or (select count(*) from pg_attribute where attrelid='public.v_atlas_stream_runtime_summary_v1'::regclass and attnum>0 and not attisdropped) <> 16 then
    raise exception 'atlas_read_model_column_count_changed';
  end if;
  if exists (
    select 1 from (values ('public.v_atlas_signal_derivation_summary_v1'),('public.v_atlas_stream_runtime_summary_v1')) v(name)
    cross join (values ('anon'),('authenticated')) r(name)
    where has_table_privilege(r.name,v.name,'SELECT')
  ) then
    raise exception 'atlas_read_model_browser_select_grant_present';
  end if;
end;
$postflight$;
commit;

