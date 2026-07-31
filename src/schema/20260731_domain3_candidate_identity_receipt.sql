-- Stabilize Domain 3 candidate identity and transport receipts.
--
-- Candidate identity is based on unique source records, exact entity identity,
-- deterministic statistics, and a versioned rule contract. Adapter replay time
-- is excluded. Source freshness uses the source-record timestamp, not the time
-- an identical record was seen again.

update atlas.live_data_signal_rule
   set is_active = false
 where rule_id = 'atlas.propublica_unresolved_filing_metadata_rate'
   and rule_version = '1.0.0';

insert into atlas.live_data_signal_rule (
  rule_id,
  rule_version,
  signal_type,
  engine_id,
  engine_version,
  rule_contract,
  rule_contract_hash,
  is_active
)
select
  'atlas.propublica_unresolved_filing_metadata_rate',
  '1.1.0',
  'elevated_unresolved_record_rate',
  'atlas.live_data_signal_exact',
  '1.1.0',
  jsonb_build_object(
    'source_stream', 'pro_publica',
    'source_signal_type', 'nonprofit_990_filing',
    'identity_unit', 'unique external_id plus pdf_url',
    'source_freshness', 'maximum stable source event timestamp',
    'candidate_identity', 'entity plus unique source records plus deterministic statistics',
    'unresolved_when', jsonb_build_array(
      'tax_period is null',
      'form_type is null',
      'external_id ends with -unknown'
    ),
    'minimum_unique_records', 10,
    'minimum_unresolved_rate', 0.5,
    'severity', jsonb_build_object(
      'critical', 'rate >= 0.95 and unique records >= 100',
      'high', 'rate >= 0.80 and unique records >= 10',
      'medium', 'rate >= 0.50 and unique records >= 10'
    ),
    'entity_resolution', 'one exact active entity_registry.primary_name match',
    'confidence', '1.0 only after exact aggregation and exact entity resolution',
    'interpretation_boundary', 'data-quality observation; not misconduct or legal finding'
  ),
  encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'source_stream', 'pro_publica',
          'source_signal_type', 'nonprofit_990_filing',
          'identity_unit', 'unique external_id plus pdf_url',
          'source_freshness', 'maximum stable source event timestamp',
          'minimum_unique_records', 10,
          'minimum_unresolved_rate', 0.5,
          'engine_id', 'atlas.live_data_signal_exact',
          'engine_version', '1.1.0'
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  ),
  true
on conflict (rule_id, rule_version) do update set
  signal_type = excluded.signal_type,
  engine_id = excluded.engine_id,
  engine_version = excluded.engine_version,
  rule_contract = excluded.rule_contract,
  rule_contract_hash = excluded.rule_contract_hash,
  is_active = true;

create or replace view atlas.v_propublica_unresolved_metadata_candidate_v1
with (security_invoker = true)
as
with canonical_events as (
  select
    event.stream_id,
    event."offset",
    event.timestamp as source_observed_at,
    event.payload,
    event.provenance,
    identity.event_identity_hash,
    identity.source_record_key,
    lower(trim(coalesce(event.payload->>'organization_name', ''))) as normalized_entity_name,
    (
      event.payload->>'tax_period' is null
      or event.payload->>'form_type' is null
      or coalesce(event.payload->>'external_id', '') like '%-unknown'
    ) as unresolved
  from atlas.signal_event_identity identity
  join public.signal_events event
    on event.stream_id = identity.stream_id
   and event."offset" = identity.canonical_offset
  where identity.stream_id = 'pro_publica'
    and identity.signal_type = 'nonprofit_990_filing'
    and coalesce(event.payload->>'organization_name', '') <> ''
),
unique_records as (
  select
    normalized_entity_name,
    source_record_key,
    min("offset") as representative_offset,
    max(source_observed_at) as source_freshness_at,
    bool_or(unresolved) as unresolved,
    max(payload->>'organization_name') as organization_name,
    max(payload->>'pdf_url') as source_url
  from canonical_events
  group by normalized_entity_name, source_record_key
),
aggregates as (
  select
    normalized_entity_name,
    max(organization_name) as organization_name,
    count(*)::integer as unique_record_count,
    count(*) filter (where unresolved)::integer as unresolved_unique_record_count,
    round(
      count(*) filter (where unresolved)::numeric / nullif(count(*), 0),
      6
    ) as unresolved_unique_rate,
    max(source_freshness_at) as source_freshness_at
  from unique_records
  group by normalized_entity_name
),
exact_entities as (
  select
    aggregate.*,
    entity.entity_id,
    entity.entity_type,
    entity.primary_name,
    entity.last_verified,
    entity.match_count
  from aggregates aggregate
  cross join lateral (
    select
      min(registry.entity_id) as entity_id,
      min(registry.entity_type) as entity_type,
      min(registry.primary_name) as primary_name,
      max(registry.last_verified) as last_verified,
      count(*)::integer as match_count
    from atlas.entity_registry registry
    where registry.is_active
      and lower(trim(registry.primary_name)) = aggregate.normalized_entity_name
  ) entity
  where entity.match_count = 1
),
with_refs as (
  select
    exact.*,
    case
      when unresolved_unique_rate >= 0.95 and unique_record_count >= 100 then 'critical'
      when unresolved_unique_rate >= 0.80 and unique_record_count >= 10 then 'high'
      else 'medium'
    end as severity,
    (
      select jsonb_agg(
        jsonb_build_object(
          'stream_id', 'pro_publica',
          'offset', reference.representative_offset,
          'source_record_key', reference.source_record_key,
          'source_url', reference.source_url
        )
        order by reference.source_record_key
      )
      from (
        select
          record.source_record_key,
          record.representative_offset,
          record.source_url
        from unique_records record
        where record.normalized_entity_name = exact.normalized_entity_name
        order by record.source_record_key
        limit 25
      ) reference
    ) as source_event_refs
  from exact_entities exact
)
select
  with_refs.*,
  jsonb_build_object(
    'candidate_identity_version', '1.1.0',
    'unique_source_record_count', unique_record_count,
    'unresolved_unique_record_count', unresolved_unique_record_count,
    'unresolved_unique_rate', unresolved_unique_rate,
    'identity_unit', 'unique external_id plus pdf_url',
    'source_freshness_basis', 'maximum stable source event timestamp',
    'entity_resolution_method', 'entity_registry_primary_name_exact',
    'entity_resolution_match_count', match_count,
    'entity_registry_last_verified', last_verified,
    'historical_raw_event_count', (
      select count(*)
      from public.signal_events event
      where event.stream_id = 'pro_publica'
        and event.signal_type = 'nonprofit_990_filing'
        and lower(trim(coalesce(event.payload->>'organization_name', ''))) = with_refs.normalized_entity_name
    ),
    'canonical_event_count', (
      select count(*)
      from canonical_events event
      where event.normalized_entity_name = with_refs.normalized_entity_name
    )
  ) as supporting_statistics,
  encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'candidate_identity_version', '1.1.0',
          'stream_id', 'pro_publica',
          'entity_id', entity_id,
          'unique_record_count', unique_record_count,
          'unresolved_unique_record_count', unresolved_unique_record_count,
          'unresolved_unique_rate', unresolved_unique_rate,
          'source_event_refs', source_event_refs,
          'entity_resolution_method', 'entity_registry_primary_name_exact'
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  ) as source_input_hash
from with_refs;

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
  select rule_contract_hash
    into v_rule_hash
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

    with eligible as (
      select *
      from atlas.v_propublica_unresolved_metadata_candidate_v1
      where unique_record_count >= greatest(p_min_unique_records, 1)
        and unresolved_unique_rate >= greatest(p_min_unresolved_rate, 0)
      order by unresolved_unique_rate desc, unique_record_count desc, entity_id
      limit least(greatest(p_limit, 1), 1000)
    ),
    inserted as (
      insert into atlas.live_data_signal_candidate (
        candidate_hash,
        rule_id,
        rule_version,
        rule_contract_hash,
        engine_id,
        engine_version,
        signal_type,
        title,
        description,
        primary_stream_id,
        source_event_refs,
        entity_ids,
        entity_resolution_status,
        jurisdiction_id,
        severity,
        confidence_score,
        verification_state,
        supporting_statistics,
        evidence_refs,
        source_freshness_at,
        detected_at,
        source_input_hash,
        first_run_id,
        last_run_id
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
          'minimum_unresolved_rate', greatest(p_min_unresolved_rate, 0)
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

update atlas.live_data_signal_candidate
   set lighthouse_status = 'failed',
       lighthouse_last_error = case
         when lighthouse_status = 'pending' then
           'superseded_by_candidate_identity_version_1.1.0'
         else coalesce(lighthouse_last_error, 'superseded_by_candidate_identity_version_1.1.0')
       end
 where rule_id = 'atlas.propublica_unresolved_filing_metadata_rate'
   and rule_version = '1.0.0'
   and lighthouse_status <> 'bridged';

comment on view atlas.v_propublica_unresolved_metadata_candidate_v1 is
  'Stable unique-record candidate input. Adapter replay timestamps are excluded from candidate identity.';
comment on function public.detect_propublica_unresolved_metadata_v1(integer, numeric, integer) is
  'Deterministic Domain 3 detector using stable candidate identity version 1.1.0.';