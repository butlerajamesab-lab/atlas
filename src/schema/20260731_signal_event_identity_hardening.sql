-- Hardening for canonical Atlas event identity and Domain 3 detection.
-- Applied after 20260731_signal_event_identity_and_live_data_detection.sql.

create or replace function public.persist_signal_event_batch_v2(p_events jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'atlas', 'extensions'
as $function$
declare
  v_run_id uuid := gen_random_uuid();
  v_event jsonb;
  v_stream_id text;
  v_identity_hash text;
  v_source_record_key text;
  v_existing_offset bigint;
  v_next_offset bigint;
  v_inserted integer := 0;
  v_replayed integer := 0;
  v_seen integer := 0;
  v_failed integer := 0;
  v_cursor_before bigint;
  v_cursor_after bigint;
  v_stream_count integer;
  v_receipts jsonb := '[]'::jsonb;
  v_error text := null;
  v_status text;
begin
  if jsonb_typeof(p_events) <> 'array' then
    raise exception 'p_events must be a JSON array';
  end if;

  select count(distinct value->>'stream_id')
    into v_stream_count
    from jsonb_array_elements(p_events);

  if v_stream_count > 1 then
    raise exception 'one ingest batch may contain only one stream_id';
  end if;

  select nullif(value->>'stream_id', '')
    into v_stream_id
    from jsonb_array_elements(p_events)
    limit 1;

  select max("offset") into v_cursor_before
    from public.signal_events
   where stream_id = v_stream_id;

  insert into atlas.signal_event_ingest_run (
    run_id, stream_id, status, records_seen, cursor_before
  ) values (
    v_run_id, v_stream_id, 'running', jsonb_array_length(p_events), v_cursor_before
  );

  perform pg_advisory_xact_lock(hashtextextended(coalesce(v_stream_id, ''), 0));

  for v_event in
    select value from jsonb_array_elements(p_events)
  loop
    v_seen := v_seen + 1;
    v_existing_offset := null;

    begin
      if coalesce(v_event->>'stream_id', '') = ''
         or coalesce(v_event->>'timestamp', '') = ''
         or coalesce(v_event->>'signal_type', '') = ''
         or coalesce(v_event->>'source_id', '') = ''
         or coalesce(v_event->>'jurisdiction_id', '') = ''
         or coalesce(v_event->>'module_hint', '') = '' then
        raise exception 'event % is missing canonical identity fields', v_seen;
      end if;

      if jsonb_typeof(v_event->'spacetime') <> 'object'
         or jsonb_typeof(v_event->'provenance') <> 'object'
         or jsonb_typeof(v_event->'payload') <> 'object' then
        raise exception 'event % has invalid spacetime, provenance, or payload', v_seen;
      end if;

      v_identity_hash := atlas.signal_event_identity_hash_v1(
        v_event->>'stream_id',
        (v_event->>'timestamp')::timestamptz,
        v_event->>'signal_type',
        v_event->'spacetime',
        v_event->'provenance',
        v_event->'payload',
        v_event->>'source_id',
        v_event->>'jurisdiction_id',
        v_event->>'module_hint'
      );
      v_source_record_key := atlas.signal_event_source_record_key_v1(
        v_event->'payload',
        v_event->'provenance'
      );

      select canonical_offset
        into v_existing_offset
        from atlas.signal_event_identity
       where stream_id = v_event->>'stream_id'
         and event_identity_hash = v_identity_hash;

      if v_existing_offset is not null then
        update atlas.signal_event_identity
           set replay_count = replay_count + 1,
               last_seen_at = clock_timestamp(),
               updated_at = clock_timestamp()
         where stream_id = v_event->>'stream_id'
           and event_identity_hash = v_identity_hash;
        v_replayed := v_replayed + 1;
        if jsonb_array_length(v_receipts) < 50 then
          v_receipts := v_receipts || jsonb_build_array(jsonb_build_object(
            'event_identity_hash', v_identity_hash,
            'canonical_offset', v_existing_offset,
            'inserted', false,
            'replay_suppressed', true
          ));
        end if;
      else
        select coalesce(max("offset") + 1, 0)
          into v_next_offset
          from public.signal_events
         where stream_id = v_event->>'stream_id';

        insert into public.signal_events (
          stream_id,
          "offset",
          timestamp,
          signal_type,
          spacetime,
          provenance,
          payload,
          source_id,
          jurisdiction_id,
          module_hint,
          ingested_at,
          event_identity_hash
        ) values (
          v_event->>'stream_id',
          v_next_offset,
          (v_event->>'timestamp')::timestamptz,
          v_event->>'signal_type',
          v_event->'spacetime',
          v_event->'provenance',
          v_event->'payload',
          v_event->>'source_id',
          v_event->>'jurisdiction_id',
          v_event->>'module_hint',
          clock_timestamp(),
          v_identity_hash
        );

        insert into atlas.signal_event_identity (
          stream_id,
          event_identity_hash,
          canonical_offset,
          latest_historical_offset,
          historical_event_count,
          replay_count,
          source_record_key,
          first_seen_at,
          last_seen_at,
          source_timestamp,
          signal_type,
          source_id,
          jurisdiction_id,
          module_hint
        ) values (
          v_event->>'stream_id',
          v_identity_hash,
          v_next_offset,
          v_next_offset,
          1,
          0,
          v_source_record_key,
          clock_timestamp(),
          clock_timestamp(),
          (v_event->>'timestamp')::timestamptz,
          v_event->>'signal_type',
          v_event->>'source_id',
          v_event->>'jurisdiction_id',
          v_event->>'module_hint'
        );

        v_inserted := v_inserted + 1;
        if jsonb_array_length(v_receipts) < 50 then
          v_receipts := v_receipts || jsonb_build_array(jsonb_build_object(
            'event_identity_hash', v_identity_hash,
            'canonical_offset', v_next_offset,
            'inserted', true,
            'replay_suppressed', false
          ));
        end if;
      end if;
    exception when others then
      get stacked diagnostics v_error = message_text;
      v_failed := v_failed + 1;
      if jsonb_array_length(v_receipts) < 50 then
        v_receipts := v_receipts || jsonb_build_array(jsonb_build_object(
          'event_index', v_seen,
          'inserted', false,
          'replay_suppressed', false,
          'error', left(v_error, 1000)
        ));
      end if;
      exit;
    end;
  end loop;

  select max("offset") into v_cursor_after
    from public.signal_events
   where stream_id = v_stream_id;

  v_status := case
    when v_failed = 0 then 'completed'
    when v_inserted > 0 or v_replayed > 0 then 'partial'
    else 'failed'
  end;

  update atlas.signal_event_ingest_run
     set status = v_status,
         records_seen = v_seen,
         events_inserted = v_inserted,
         replays_suppressed = v_replayed,
         cursor_after = v_cursor_after,
         partial_completion = v_status = 'partial',
         error_message = case when v_failed > 0 then left(v_error, 2000) else null end,
         completed_at = clock_timestamp()
   where run_id = v_run_id;

  return jsonb_build_object(
    'run_id', v_run_id,
    'stream_id', v_stream_id,
    'status', v_status,
    'records_seen', v_seen,
    'events_inserted', v_inserted,
    'replays_suppressed', v_replayed,
    'records_failed', v_failed,
    'cursor_before', v_cursor_before,
    'cursor_after', v_cursor_after,
    'partial_completion', v_status = 'partial',
    'error_message', case when v_failed > 0 then v_error else null end,
    'receipts', v_receipts
  );
end
$function$;

create or replace view atlas.v_propublica_unresolved_metadata_candidate_v1
with (security_invoker = true)
as
with canonical_events as (
  select
    event.stream_id,
    event."offset",
    event.timestamp,
    identity.last_seen_at as source_freshness_at,
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
    max(source_freshness_at) as source_freshness_at,
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
    'unique_source_record_count', unique_record_count,
    'unresolved_unique_record_count', unresolved_unique_record_count,
    'unresolved_unique_rate', unresolved_unique_rate,
    'identity_unit', 'unique external_id plus pdf_url',
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
          'stream_id', 'pro_publica',
          'entity_id', entity_id,
          'unique_record_count', unique_record_count,
          'unresolved_unique_record_count', unresolved_unique_record_count,
          'unresolved_unique_rate', unresolved_unique_rate,
          'source_freshness_at', source_freshness_at,
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
     and rule_version = '1.0.0'
     and is_active;

  if v_rule_hash is null then
    raise exception 'active ProPublica unresolved-metadata rule is not registered';
  end if;

  insert into atlas.live_data_signal_run (
    run_id, rule_id, rule_version, rule_contract_hash, status
  ) values (
    v_run_id,
    'atlas.propublica_unresolved_filing_metadata_rate',
    '1.0.0',
    v_rule_hash,
    'running'
  );

  begin
    select count(*) into v_scanned
      from atlas.signal_event_identity identity
     where identity.stream_id = 'pro_publica'
       and identity.signal_type = 'nonprofit_990_filing';

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
        '1.0.0',
        v_rule_hash,
        'atlas.live_data_signal_exact',
        '1.0.0',
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
    'rule_version', '1.0.0',
    'rule_contract_hash', v_rule_hash,
    'canonical_events_scanned', v_scanned,
    'entities_evaluated', v_entities,
    'candidates_produced', v_candidates,
    'candidates', v_result
  );
end
$function$;

create or replace function public.get_lighthouse_signal_events(
  p_stream_id text,
  p_offset bigint default 0,
  p_limit integer default 1000
)
returns table(
  stream_id text,
  "offset" bigint,
  "timestamp" timestamptz,
  signal_type text,
  spacetime jsonb,
  provenance jsonb,
  payload jsonb,
  source_id text,
  jurisdiction_id text,
  module_hint text,
  ingested_at timestamptz
)
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'atlas'
as $function$
  select
    event.stream_id,
    event."offset",
    event."timestamp",
    event.signal_type,
    event.spacetime,
    event.provenance,
    event.payload,
    event.source_id,
    event.jurisdiction_id,
    event.module_hint,
    identity.last_seen_at as ingested_at
  from atlas.signal_event_identity identity
  join public.signal_events event
    on event.stream_id = identity.stream_id
   and event."offset" = identity.canonical_offset
  join private.lighthouse_stream_export_allowlist allowlist
    on allowlist.stream_id = event.stream_id
   and allowlist.export_enabled
  where event.stream_id = p_stream_id
    and event."offset" >= greatest(coalesce(p_offset, 0), 0)
  order by event."offset" asc
  limit least(greatest(coalesce(p_limit, 1000), 1), 1000)
$function$;

comment on view atlas.v_propublica_unresolved_metadata_candidate_v1 is
  'Deterministic unique-record candidate input with exact entity resolution and replay-aware source freshness.';
comment on function public.persist_signal_event_batch_v2(jsonb) is
  'Replay-safe event persistence. Per-event subtransactions preserve committed progress and a durable partial/failed run receipt.';