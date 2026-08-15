-- Production ledger parity: 20260815090211_domain3_propublica_sequential_candidate_upsert

create or replace function public.detect_propublica_unresolved_metadata_v1(
  p_min_unique_records integer default 10,
  p_min_unresolved_rate numeric default 0.5,
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'atlas', 'extensions'
as $function$
declare
  v_run_id uuid := gen_random_uuid();
  v_rule_hash text;
  v_scanned bigint := 0;
  v_entities bigint := 0;
  v_candidates bigint := 0;
  v_result jsonb := '[]'::jsonb;
  v_error text;
  v_row record;
  v_candidate_hash text;
  v_candidate_id uuid;
  v_candidate_status text;
  v_candidate_lighthouse_id uuid;
begin
  select rule_contract_hash into v_rule_hash
  from atlas.live_data_signal_rule
  where rule_id = 'atlas.propublica_unresolved_filing_metadata_rate'
    and rule_version = '1.1.0'
    and is_active;

  if v_rule_hash is null then
    raise exception 'active ProPublica unresolved-metadata rule 1.1.0 is not registered';
  end if;

  insert into atlas.live_data_signal_run (
    run_id, rule_id, rule_version, rule_contract_hash, status
  ) values (
    v_run_id,
    'atlas.propublica_unresolved_filing_metadata_rate',
    '1.1.0',
    v_rule_hash,
    'running'
  );

  begin
    select count(*) into v_scanned
    from atlas.signal_event_identity
    where stream_id = 'pro_publica'
      and signal_type = 'nonprofit_990_filing';

    select count(*) into v_entities
    from atlas.v_propublica_unresolved_metadata_candidate_v1;

    for v_row in
      with eligible_raw as (
        select *
        from atlas.v_propublica_unresolved_metadata_candidate_v1
        where unique_record_count >= greatest(p_min_unique_records, 1)
          and unresolved_unique_rate >= greatest(p_min_unresolved_rate, 0)
      ), ranked as (
        select eligible_raw.*,
               row_number() over (
                 partition by entity_id, source_input_hash
                 order by unresolved_unique_rate desc,
                          unique_record_count desc,
                          primary_name,
                          normalized_entity_name
               ) as identity_rank
        from eligible_raw
      )
      select *
      from ranked
      where identity_rank = 1
      order by unresolved_unique_rate desc, unique_record_count desc, entity_id
      limit least(greatest(p_limit, 1), 1000)
    loop
      v_candidate_hash := encode(
        extensions.digest(
          convert_to(
            jsonb_build_object(
              'domain', 'live_data',
              'candidate_identity_version', '1.1.0',
              'signal_type', 'elevated_unresolved_record_rate',
              'entity_id', v_row.entity_id,
              'source_input_hash', v_row.source_input_hash,
              'rule_contract_hash', v_rule_hash
            )::text,
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      );

      insert into atlas.live_data_signal_candidate (
        candidate_hash, rule_id, rule_version, rule_contract_hash,
        engine_id, engine_version, signal_type, title, description,
        primary_stream_id, source_event_refs, entity_ids,
        entity_resolution_status, jurisdiction_id, severity, confidence_score,
        verification_state, supporting_statistics, evidence_refs,
        source_freshness_at, detected_at, source_input_hash,
        first_run_id, last_run_id
      ) values (
        v_candidate_hash,
        'atlas.propublica_unresolved_filing_metadata_rate',
        '1.1.0',
        v_rule_hash,
        'atlas.live_data_signal_exact',
        '1.1.0',
        'elevated_unresolved_record_rate',
        'Elevated unresolved nonprofit filing metadata rate',
        format(
          'Atlas observed %s of %s unique ProPublica filing records for %s with unresolved tax-period, form-type, or external-identity metadata. This is a data-quality observation, not a misconduct or legal finding.',
          v_row.unresolved_unique_record_count,
          v_row.unique_record_count,
          v_row.primary_name
        ),
        'pro_publica',
        v_row.source_event_refs,
        array[v_row.entity_id]::text[],
        'resolved',
        'us_federal',
        v_row.severity,
        1.0,
        'verified',
        v_row.supporting_statistics || jsonb_build_object(
          'minimum_unique_records', greatest(p_min_unique_records, 1),
          'minimum_unresolved_rate', greatest(p_min_unresolved_rate, 0),
          'candidate_identity_deduplicated', true,
          'persistence_mode', 'sequential_idempotent_upsert'
        ),
        v_row.source_event_refs,
        v_row.source_freshness_at,
        clock_timestamp(),
        v_row.source_input_hash,
        v_run_id,
        v_run_id
      )
      on conflict (candidate_hash) do update set
        last_run_id = excluded.last_run_id,
        last_replayed_at = clock_timestamp(),
        source_event_refs = excluded.source_event_refs,
        supporting_statistics = excluded.supporting_statistics,
        evidence_refs = excluded.evidence_refs,
        source_freshness_at = excluded.source_freshness_at
      returning candidate_id, lighthouse_status, lighthouse_record_id
      into v_candidate_id, v_candidate_status, v_candidate_lighthouse_id;

      v_candidates := v_candidates + 1;
      v_result := v_result || jsonb_build_array(
        jsonb_build_object(
          'candidate_id', v_candidate_id,
          'candidate_hash', v_candidate_hash,
          'lighthouse_record', jsonb_build_object(
            'signal_type', 'elevated_unresolved_record_rate',
            'title', 'Elevated unresolved nonprofit filing metadata rate',
            'description', format(
              'Atlas observed %s of %s unique ProPublica filing records for %s with unresolved tax-period, form-type, or external-identity metadata. This is a data-quality observation, not a misconduct or legal finding.',
              v_row.unresolved_unique_record_count,
              v_row.unique_record_count,
              v_row.primary_name
            ),
            'primary_stream_id', 'pro_publica',
            'source_event_refs', v_row.source_event_refs,
            'entity_ids', jsonb_build_array(v_row.entity_id),
            'entity_resolution_status', 'resolved',
            'jurisdiction_id', 'us_federal',
            'severity', v_row.severity,
            'confidence_score', 1.0,
            'verification_state', 'verified',
            'supporting_statistics', v_row.supporting_statistics,
            'evidence_refs', v_row.source_event_refs,
            'detection_rule_id', 'atlas.propublica_unresolved_filing_metadata_rate',
            'detection_rule_version', '1.1.0',
            'engine_id', 'atlas.live_data_signal_exact',
            'engine_version', '1.1.0',
            'source_freshness_at', v_row.source_freshness_at,
            'detected_at', clock_timestamp(),
            'governance_status', 'observation_candidate'
          ),
          'lighthouse_status', v_candidate_status,
          'lighthouse_record_id', v_candidate_lighthouse_id
        )
      );
    end loop;

    update atlas.live_data_signal_run
    set status = 'completed',
        canonical_events_scanned = v_scanned,
        entities_evaluated = v_entities,
        candidates_produced = v_candidates,
        completed_at = clock_timestamp()
    where run_id = v_run_id;
  exception when others then
    get stacked diagnostics v_error = message_text;
    update atlas.live_data_signal_run
    set status = 'failed',
        canonical_events_scanned = v_scanned,
        entities_evaluated = v_entities,
        candidates_produced = v_candidates,
        error_message = left(v_error, 2000),
        completed_at = clock_timestamp()
    where run_id = v_run_id;
    return jsonb_build_object(
      'run_id', v_run_id,
      'status', 'failed',
      'error_message', v_error,
      'candidates', '[]'::jsonb
    );
  end;

  return jsonb_build_object(
    'run_id', v_run_id,
    'status', 'completed',
    'rule_id', 'atlas.propublica_unresolved_filing_metadata_rate',
    'rule_version', '1.1.0',
    'rule_contract_hash', v_rule_hash,
    'canonical_events_scanned', v_scanned,
    'entities_evaluated', v_entities,
    'candidates_produced', v_candidates,
    'candidates', v_result
  );
end
$function$;

comment on function public.detect_propublica_unresolved_metadata_v1(integer,numeric,integer) is
  'Runs the governed ProPublica unresolved-metadata seed detector using entity-aware semantic currentness and sequential idempotent candidate upserts so one detector run cannot trip PostgreSQL multi-row ON CONFLICT cardinality errors.';
