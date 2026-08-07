begin;

create or replace function public.atlas_convergence_explorer_v1(
  p_run_key text default null,
  p_history_limit integer default 12
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, atlas
as $$
with bounds as (
  select least(greatest(coalesce(p_history_limit, 12), 1), 25) as history_limit
), history_runs as materialized (
  select m.*
  from atlas.convergence_run_manifest m
  order by m.persisted_at desc, m.run_key desc
  limit (select history_limit from bounds)
), history_json as (
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'run_key', h.run_key,
      'engine_version', h.engine_version,
      'as_of', h.as_of,
      'analysis_level', h.analysis_level,
      'total_source_rows', h.total_source_rows,
      'total_signals_raw', h.total_signals_raw,
      'total_signals_deduplicated', h.total_signals_deduplicated,
      'total_geographies', h.total_geographies,
      'receipt_count', h.receipt_count,
      'output_hash', h.output_hash,
      'source_population_hash', h.source_population_hash,
      'persisted_at', h.persisted_at,
      'convergence_detected_count', coalesce((
        select count(*) from atlas.convergence_receipt r
        where r.run_key = h.run_key and r.convergence_detected
      ), 0),
      'resolved_count', coalesce((
        select count(*) from atlas.convergence_receipt r
        where r.run_key = h.run_key and r.status = 'resolved'
      ), 0),
      'unresolved_count', coalesce((
        select count(*) from atlas.convergence_receipt r
        where r.run_key = h.run_key and r.status = 'unresolved'
      ), 0),
      'below_threshold_count', coalesce((
        select count(*) from atlas.convergence_receipt r
        where r.run_key = h.run_key and r.status = 'below_threshold'
      ), 0)
    ) order by h.persisted_at desc, h.run_key desc
  ), '[]'::jsonb) as rows
  from history_runs h
), selected_manifest as (
  select m.*
  from atlas.convergence_run_manifest m
  where m.run_key = coalesce(
    p_run_key,
    (select hr.run_key from history_runs hr order by hr.persisted_at desc, hr.run_key desc limit 1)
  )
  limit 1
), selected_receipts as (
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'geography_id', r.geography_id,
      'receipt_identity', r.receipt_identity,
      'equation_id', r.equation_id,
      'engine_version', r.engine_version,
      'as_of', r.as_of,
      'expected_count', r.expected_count,
      'observed_count', r.observed_count,
      'z_score', r.z_score,
      'convergence_detected', r.convergence_detected,
      'status', r.status,
      'reason_unresolved', r.reason_unresolved,
      'input_hash', r.input_hash,
      'output_hash', r.output_hash,
      'source_signal_count', jsonb_array_length(r.source_signal_ids),
      'computed_summary', jsonb_build_object(
        'dominant_type', r.computed_outputs->>'dominant_type',
        'distinct_types', r.computed_outputs->'distinct_types',
        'recency_factor', r.computed_outputs->'recency_factor',
        'mean_confidence', r.computed_outputs->'mean_confidence',
        'multiplicative_score', r.computed_outputs->'multiplicative_score',
        'null_model_id', r.computed_outputs->'null_model'->>'model_id'
      )
    ) order by r.geography_id
  ), '[]'::jsonb) as rows
  from atlas.convergence_receipt r
  join selected_manifest m on m.run_key = r.run_key
), dedup_snapshot as (
  select s.population_hash, s.record_count, s.records_json
  from atlas.convergence_signal_snapshot s
  join selected_manifest m on m.run_key = s.run_key
  where s.snapshot_type = 'deduplicated'
  limit 1
), transformed_snapshot as (
  select s.population_hash, s.record_count
  from atlas.convergence_signal_snapshot s
  join selected_manifest m on m.run_key = s.run_key
  where s.snapshot_type = 'transformed'
  limit 1
), source_snapshot as (
  select s.population_hash, s.record_count
  from atlas.convergence_signal_snapshot s
  join selected_manifest m on m.run_key = s.run_key
  where s.snapshot_type = 'source'
  limit 1
), signal_type_counts as (
  select coalesce(jsonb_agg(
    jsonb_build_object('signal_type', signal_type, 'count', signal_count)
    order by signal_count desc, signal_type
  ), '[]'::jsonb) as rows
  from (
    select coalesce(item->>'signal_type', 'unknown') as signal_type, count(*) as signal_count
    from dedup_snapshot d
    cross join lateral jsonb_array_elements(d.records_json) item
    group by coalesce(item->>'signal_type', 'unknown')
  ) grouped
), source_stream_counts as (
  select coalesce(jsonb_agg(
    jsonb_build_object('source_stream', source_stream, 'count', signal_count)
    order by signal_count desc, source_stream
  ), '[]'::jsonb) as rows
  from (
    select coalesce(
      item->'source_event'->>'stream_id',
      item->'characteristics'->>'source_id',
      'unknown'
    ) as source_stream,
    count(*) as signal_count
    from dedup_snapshot d
    cross join lateral jsonb_array_elements(d.records_json) item
    group by coalesce(
      item->'source_event'->>'stream_id',
      item->'characteristics'->>'source_id',
      'unknown'
    )
  ) grouped
), selected_json as (
  select jsonb_build_object(
    'run_key', m.run_key,
    'engine_version', m.engine_version,
    'as_of', m.as_of,
    'analysis_level', m.analysis_level,
    'time_window_ms', m.time_window_ms,
    'temporal_bucket_ms', m.temporal_bucket_ms,
    'geography_registry_version', m.geography_registry_version,
    'analysis_registry_hash', m.analysis_registry_hash,
    'rule_manifest_hash', m.rule_manifest_hash,
    'configuration_hash', m.configuration_hash,
    'configuration', m.configuration_json,
    'source_population_hash', m.source_population_hash,
    'transformed_population_hash', m.transformed_population_hash,
    'deduplicated_population_hash', m.deduplicated_population_hash,
    'total_source_rows', m.total_source_rows,
    'total_signals_raw', m.total_signals_raw,
    'total_signals_deduplicated', m.total_signals_deduplicated,
    'total_geographies', m.total_geographies,
    'receipt_count', m.receipt_count,
    'output_hash', m.output_hash,
    'persisted_at', m.persisted_at,
    'receipts', (select rows from selected_receipts),
    'signal_type_counts', (select rows from signal_type_counts),
    'source_stream_counts', (select rows from source_stream_counts),
    'pipeline', jsonb_build_array(
      jsonb_build_object(
        'stage_id', 'source_population',
        'label', 'Source population',
        'count', coalesce((select record_count from source_snapshot), m.total_source_rows),
        'hash', coalesce((select population_hash from source_snapshot), m.source_population_hash)
      ),
      jsonb_build_object(
        'stage_id', 'transformed',
        'label', 'Transformed signals',
        'count', coalesce((select record_count from transformed_snapshot), m.total_signals_raw),
        'hash', coalesce((select population_hash from transformed_snapshot), m.transformed_population_hash)
      ),
      jsonb_build_object(
        'stage_id', 'deduplicated',
        'label', 'Deduplicated signals',
        'count', coalesce((select record_count from dedup_snapshot), m.total_signals_deduplicated),
        'hash', coalesce((select population_hash from dedup_snapshot), m.deduplicated_population_hash)
      ),
      jsonb_build_object(
        'stage_id', 'domain_space',
        'label', 'Domain space',
        'count', m.total_geographies,
        'space_type', 'geographic',
        'analysis_level', m.analysis_level,
        'registry_hash', m.analysis_registry_hash
      ),
      jsonb_build_object(
        'stage_id', 'receipts',
        'label', 'Convergence receipts',
        'count', m.receipt_count,
        'convergence_detected_count', coalesce((
          select count(*) from atlas.convergence_receipt r
          where r.run_key = m.run_key and r.convergence_detected
        ), 0)
      ),
      jsonb_build_object(
        'stage_id', 'output',
        'label', 'Complete output',
        'count', m.receipt_count,
        'hash', m.output_hash
      )
    ),
    'context_bindings', jsonb_build_object(
      'domain_space', 'geographic_v2_1_bound',
      'filter_stack', 'not_bound_on_legacy_convergence_run',
      'structural_lens_stack', 'not_bound_on_legacy_convergence_run'
    ),
    'semantics', 'Convergence receipts report deterministic mathematical state. A resolved receipt with convergence_detected=false is a valid result, not a failure.'
  ) as row
  from selected_manifest m
)
select jsonb_build_object(
  'read_model_version', 'atlas.convergence_explorer.v1',
  'history', (select rows from history_json),
  'selected', (select row from selected_json),
  'requested_run_key', p_run_key
);
$$;

revoke all on function public.atlas_convergence_explorer_v1(text, integer)
  from public, anon, authenticated;
grant execute on function public.atlas_convergence_explorer_v1(text, integer)
  to service_role;

comment on function public.atlas_convergence_explorer_v1(text, integer) is
  'Atlas public-UI server read model for immutable convergence manifests and receipts. Returns bounded aggregate history and selected-run summaries without exposing raw source payloads or unrestricted signal records.';

commit;
