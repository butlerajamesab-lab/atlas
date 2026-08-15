-- Production ledger parity: 20260815085914_domain3_propublica_seed_deduplication

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

    with eligible_raw as (
      select *
      from atlas.v_propublica_unresolved_metadata_candidate_v1
      where unique_record_count >= greatest(p_min_unique_records, 1)
        and unresolved_unique_rate >= greatest(p_min_unresolved_rate, 0)
    ),
    eligible as (
      select *
      from (
        select eligible_raw.*,
               row_number() over (
                 partition by entity_id, source_input_hash
                 order by unresolved_unique_rate desc,
                          unique_record_count desc,
                          primary_name,
                          normalized_entity_name
               ) as identity_rank
        from eligible_raw
      ) ranked
      where identity_rank = 1
      order by unresolved_unique_rate desc, unique_record_count desc, entity_id
      limit least(greatest(p_limit, 1), 1000)
    ),
    inserted as (
      insert into atlas.live_data_signal_candidate (
        candidate_hash, rule_id, rule_version, rule_contract_hash,
        engine_id, engine_version, signal_type, title, description,
        primary_stream_id, source_event_refs, entity_ids,
        entity_resolution_status, jurisdiction_id, severity, confidence_score,
        verification_state, supporting_statistics, evidence_refs,
        source_freshness_at, detected_at, source_input_hash,
        first_run_id, last_run_id
      )
      select
        encode(
          extensions.digest(
            convert_to(
              jsonb_build_object(
                'domain', 'live_data',
                'candidate_identity_version', '1.1.0',
                'signal_type', 'elevated_unresolved_record_rate',
                'entity_id', entity_id,
                'source_input_hash', source_input_hash,
                'rule_contract_hash', v_rule_hash
              )::text,
              'UTF8'
            ),
            'sha256'
          ),
          'hex'
        ),
        'atlas.propublica_unresolved_filing_metadata_rate',
        '1.1.0',
        v_rule_hash,
        'atlas.live_data_signal_exact',
        '1.1.0',
        'elevated_unresolved_record_rate',
        'Elevated unresolved nonprofit filing metadata rate',
        format(
          'Atlas observed %s of %s unique ProPublica filing records for %s with unresolved tax-period, form-type, or external-identity metadata. This is a data-quality observation, not a misconduct or legal finding.',
          unresolved_unique_record_count,
          unique_record_count,
          primary_name
        ),
        'pro_publica',
        source_event_refs,
        array[entity_id]::text[],
        'resolved',
        'us_federal',
        severity,
        1.0,
        'verified',
        supporting_statistics || jsonb_build_object(
          'minimum_unique_records', greatest(p_min_unique_records, 1),
          'minimum_unresolved_rate', greatest(p_min_unresolved_rate, 0),
          'candidate_identity_deduplicated', true
        ),
        source_event_refs,
        source_freshness_at,
        clock_timestamp(),
        source_input_hash,
        v_run_id,
        v_run_id
      from eligible
      on conflict (candidate_hash) do update set
        last_run_id = excluded.last_run_id,
        last_replayed_at = clock_timestamp()
      returning *
    )
    select
      coalesce(jsonb_agg(
        jsonb_build_object(
          'candidate_id', candidate_id,
          'candidate_hash', candidate_hash,
          'lighthouse_record', jsonb_build_object(
            'signal_type', signal_type,
            'title', title,
            'description', description,
            'primary_stream_id', primary_stream_id,
            'source_event_refs', source_event_refs,
            'entity_ids', to_jsonb(entity_ids),
            'entity_resolution_status', entity_resolution_status,
            'jurisdiction_id', jurisdiction_id,
            'severity', severity,
            'confidence_score', confidence_score,
            'verification_state', verification_state,
            'supporting_statistics', supporting_statistics,
            'evidence_refs', evidence_refs,
            'detection_rule_id', rule_id,
            'detection_rule_version', rule_version,
            'engine_id', engine_id,
            'engine_version', engine_version,
            'source_freshness_at', source_freshness_at,
            'detected_at', detected_at,
            'governance_status', 'observation_candidate'
          ),
          'lighthouse_status', lighthouse_status,
          'lighthouse_record_id', lighthouse_record_id
        ) order by candidate_id
      ), '[]'::jsonb),
      count(*)
    into v_result, v_candidates
    from inserted;

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
  'Runs the governed ProPublica unresolved-metadata seed detector with deterministic candidate-identity deduplication before candidate_hash upsert; the seed remains non-gating for the full Domain 3 population replay.';
