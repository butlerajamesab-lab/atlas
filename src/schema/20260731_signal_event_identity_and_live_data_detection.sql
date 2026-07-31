-- Canonical Atlas event identity and Domain 3 live-data signal detection.
--
-- Historical duplicate event rows are preserved as evidence. New ingestion is
-- replay-safe: an identical source observation resolves to its first canonical
-- offset and increments replay accounting instead of inserting another event.
--
-- Domain 3 candidates are generated only from canonical Atlas observations,
-- explicit exact entity resolution, declared deterministic thresholds, and
-- bounded source-event references. They remain observations, not findings.

create extension if not exists pgcrypto with schema extensions;
create schema if not exists atlas;

alter table public.signal_events
  add column if not exists event_identity_hash text;

alter table public.signal_events
  drop constraint if exists signal_events_event_identity_hash_check;
alter table public.signal_events
  add constraint signal_events_event_identity_hash_check
  check (event_identity_hash is null or event_identity_hash ~ '^[0-9a-f]{64}$');

create or replace function atlas.signal_event_identity_hash_v1(
  p_stream_id text,
  p_timestamp timestamptz,
  p_signal_type text,
  p_spacetime jsonb,
  p_provenance jsonb,
  p_payload jsonb,
  p_source_id text,
  p_jurisdiction_id text,
  p_module_hint text
)
returns text
language sql
immutable
strict
set search_path to 'pg_catalog', 'extensions'
as $function$
  select encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'stream_id', p_stream_id,
          'timestamp', to_char(p_timestamp at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'signal_type', p_signal_type,
          'spacetime', coalesce(p_spacetime, '{}'::jsonb),
          'provenance', coalesce(p_provenance, '{}'::jsonb) - 'received_at' - 'ingested_at',
          'payload', coalesce(p_payload, '{}'::jsonb) - 'provenance_tracking',
          'source_id', p_source_id,
          'jurisdiction_id', p_jurisdiction_id,
          'module_hint', p_module_hint
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$function$;

revoke all on function atlas.signal_event_identity_hash_v1(
  text, timestamptz, text, jsonb, jsonb, jsonb, text, text, text
) from public, anon, authenticated;
grant execute on function atlas.signal_event_identity_hash_v1(
  text, timestamptz, text, jsonb, jsonb, jsonb, text, text, text
) to service_role;

create or replace function atlas.signal_event_source_record_key_v1(
  p_payload jsonb,
  p_provenance jsonb
)
returns text
language sql
immutable
set search_path to 'pg_catalog', 'extensions'
as $function$
  select encode(
    extensions.digest(
      convert_to(
        concat_ws(
          '|',
          coalesce(p_payload->>'external_id', ''),
          coalesce(p_payload->>'opportunity_number', ''),
          coalesce(p_payload->>'pdf_url', ''),
          coalesce(p_payload->>'source_url', ''),
          coalesce(p_provenance->>'source_url', ''),
          coalesce(p_payload#>>'{raw,id}', ''),
          coalesce(p_payload#>>'{raw,ein}', ''),
          coalesce(p_payload#>>'{raw,updated}', '')
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$function$;

create table if not exists atlas.signal_event_identity (
  stream_id text not null,
  event_identity_hash text not null,
  canonical_offset bigint not null,
  latest_historical_offset bigint not null,
  historical_event_count bigint not null default 1,
  replay_count bigint not null default 0,
  source_record_key text not null,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  source_timestamp timestamptz not null,
  signal_type text not null,
  source_id text not null,
  jurisdiction_id text not null,
  module_hint text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (stream_id, event_identity_hash),
  unique (stream_id, canonical_offset),
  foreign key (stream_id, canonical_offset)
    references public.signal_events(stream_id, "offset"),
  constraint signal_event_identity_hash_check
    check (event_identity_hash ~ '^[0-9a-f]{64}$'),
  constraint signal_event_identity_source_record_key_check
    check (source_record_key ~ '^[0-9a-f]{64}$'),
  constraint signal_event_identity_count_check
    check (historical_event_count >= 1 and replay_count >= 0)
);

create index if not exists idx_signal_event_identity_source
  on atlas.signal_event_identity(source_id, signal_type, last_seen_at desc);
create index if not exists idx_signal_event_identity_record_key
  on atlas.signal_event_identity(stream_id, source_record_key);

with hashed as (
  select
    event.stream_id,
    event."offset",
    event.timestamp,
    event.signal_type,
    event.source_id,
    event.jurisdiction_id,
    event.module_hint,
    event.ingested_at,
    atlas.signal_event_identity_hash_v1(
      event.stream_id,
      event.timestamp,
      event.signal_type,
      event.spacetime,
      event.provenance,
      event.payload,
      event.source_id,
      event.jurisdiction_id,
      event.module_hint
    ) as event_identity_hash,
    atlas.signal_event_source_record_key_v1(event.payload, event.provenance)
      as source_record_key
  from public.signal_events event
),
ranked as (
  select
    hashed.*,
    row_number() over (
      partition by stream_id, event_identity_hash
      order by "offset" asc
    ) as identity_rank,
    count(*) over (
      partition by stream_id, event_identity_hash
    ) as historical_event_count,
    max("offset") over (
      partition by stream_id, event_identity_hash
    ) as latest_historical_offset,
    min(ingested_at) over (
      partition by stream_id, event_identity_hash
    ) as first_seen_at,
    max(ingested_at) over (
      partition by stream_id, event_identity_hash
    ) as last_seen_at
  from hashed
)
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
)
select
  stream_id,
  event_identity_hash,
  "offset",
  latest_historical_offset,
  historical_event_count,
  greatest(historical_event_count - 1, 0),
  source_record_key,
  first_seen_at,
  last_seen_at,
  timestamp,
  signal_type,
  source_id,
  jurisdiction_id,
  module_hint
from ranked
where identity_rank = 1
on conflict (stream_id, event_identity_hash) do update set
  latest_historical_offset = greatest(
    atlas.signal_event_identity.latest_historical_offset,
    excluded.latest_historical_offset
  ),
  historical_event_count = greatest(
    atlas.signal_event_identity.historical_event_count,
    excluded.historical_event_count
  ),
  replay_count = greatest(
    atlas.signal_event_identity.replay_count,
    excluded.replay_count
  ),
  first_seen_at = least(
    atlas.signal_event_identity.first_seen_at,
    excluded.first_seen_at
  ),
  last_seen_at = greatest(
    atlas.signal_event_identity.last_seen_at,
    excluded.last_seen_at
  ),
  updated_at = now();

update public.signal_events event
   set event_identity_hash = identity.event_identity_hash
  from atlas.signal_event_identity identity
 where identity.stream_id = event.stream_id
   and identity.canonical_offset = event."offset"
   and event.event_identity_hash is distinct from identity.event_identity_hash;

create unique index if not exists signal_events_identity_uidx
  on public.signal_events(stream_id, event_identity_hash)
  where event_identity_hash is not null;

create table if not exists atlas.signal_event_ingest_run (
  run_id uuid primary key default gen_random_uuid(),
  stream_id text,
  status text not null,
  records_seen integer not null default 0,
  events_inserted integer not null default 0,
  replays_suppressed integer not null default 0,
  cursor_before bigint,
  cursor_after bigint,
  partial_completion boolean not null default false,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint signal_event_ingest_run_status_check
    check (status in ('running', 'completed', 'partial', 'failed'))
);

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
  v_cursor_before bigint;
  v_cursor_after bigint;
  v_stream_count integer;
  v_receipts jsonb := '[]'::jsonb;
  v_error text;
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

  begin
    perform pg_advisory_xact_lock(hashtextextended(coalesce(v_stream_id, ''), 0));

    for v_event in
      select value from jsonb_array_elements(p_events)
    loop
      v_seen := v_seen + 1;

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
        continue;
      end if;

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
    end loop;

    select max("offset") into v_cursor_after
      from public.signal_events
     where stream_id = v_stream_id;

    update atlas.signal_event_ingest_run
       set status = 'completed',
           records_seen = v_seen,
           events_inserted = v_inserted,
           replays_suppressed = v_replayed,
           cursor_after = v_cursor_after,
           completed_at = clock_timestamp()
     where run_id = v_run_id;
  exception when others then
    get stacked diagnostics v_error = message_text;
    select max("offset") into v_cursor_after
      from public.signal_events
     where stream_id = v_stream_id;
    update atlas.signal_event_ingest_run
       set status = case when v_inserted > 0 then 'partial' else 'failed' end,
           records_seen = v_seen,
           events_inserted = v_inserted,
           replays_suppressed = v_replayed,
           cursor_after = v_cursor_after,
           partial_completion = v_inserted > 0,
           error_message = left(v_error, 2000),
           completed_at = clock_timestamp()
     where run_id = v_run_id;
    raise;
  end;

  return jsonb_build_object(
    'run_id', v_run_id,
    'stream_id', v_stream_id,
    'records_seen', v_seen,
    'events_inserted', v_inserted,
    'replays_suppressed', v_replayed,
    'cursor_before', v_cursor_before,
    'cursor_after', v_cursor_after,
    'partial_completion', false,
    'receipts', v_receipts
  );
end
$function$;

revoke all on function public.persist_signal_event_batch_v2(jsonb)
  from public, anon, authenticated;
grant execute on function public.persist_signal_event_batch_v2(jsonb)
  to service_role;

create table if not exists atlas.live_data_signal_rule (
  rule_id text not null,
  rule_version text not null,
  signal_type text not null,
  engine_id text not null,
  engine_version text not null,
  rule_contract jsonb not null,
  rule_contract_hash text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (rule_id, rule_version),
  constraint live_data_signal_rule_hash_check
    check (rule_contract_hash ~ '^[0-9a-f]{64}$')
);

insert into atlas.live_data_signal_rule (
  rule_id,
  rule_version,
  signal_type,
  engine_id,
  engine_version,
  rule_contract,
  rule_contract_hash
)
select
  'atlas.propublica_unresolved_filing_metadata_rate',
  '1.0.0',
  'elevated_unresolved_record_rate',
  'atlas.live_data_signal_exact',
  '1.0.0',
  jsonb_build_object(
    'source_stream', 'pro_publica',
    'source_signal_type', 'nonprofit_990_filing',
    'identity_unit', 'unique external_id plus pdf_url',
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
          'minimum_unique_records', 10,
          'minimum_unresolved_rate', 0.5,
          'engine_id', 'atlas.live_data_signal_exact',
          'engine_version', '1.0.0'
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
on conflict (rule_id, rule_version) do update set
  signal_type = excluded.signal_type,
  engine_id = excluded.engine_id,
  engine_version = excluded.engine_version,
  rule_contract = excluded.rule_contract,
  rule_contract_hash = excluded.rule_contract_hash,
  is_active = true;

create table if not exists atlas.live_data_signal_run (
  run_id uuid primary key default gen_random_uuid(),
  rule_id text not null,
  rule_version text not null,
  rule_contract_hash text not null,
  status text not null,
  canonical_events_scanned bigint not null default 0,
  entities_evaluated bigint not null default 0,
  candidates_produced bigint not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (rule_id, rule_version)
    references atlas.live_data_signal_rule(rule_id, rule_version),
  constraint live_data_signal_run_status_check
    check (status in ('running', 'completed', 'failed'))
);

create table if not exists atlas.live_data_signal_candidate (
  candidate_id uuid primary key default gen_random_uuid(),
  candidate_hash text not null unique,
  rule_id text not null,
  rule_version text not null,
  rule_contract_hash text not null,
  engine_id text not null,
  engine_version text not null,
  signal_type text not null,
  title text not null,
  description text not null,
  primary_stream_id text not null,
  source_event_refs jsonb not null,
  entity_ids text[] not null,
  entity_resolution_status text not null,
  jurisdiction_id text not null,
  severity text not null,
  confidence_score numeric(7,6) not null,
  verification_state text not null,
  supporting_statistics jsonb not null,
  evidence_refs jsonb not null,
  source_freshness_at timestamptz not null,
  detected_at timestamptz not null,
  source_input_hash text not null,
  first_run_id uuid not null references atlas.live_data_signal_run(run_id),
  last_run_id uuid not null references atlas.live_data_signal_run(run_id),
  first_detected_at timestamptz not null default now(),
  last_replayed_at timestamptz,
  lighthouse_status text not null default 'pending',
  lighthouse_record_id uuid,
  lighthouse_last_error text,
  lighthouse_bridged_at timestamptz,
  constraint live_data_signal_candidate_hash_check
    check (candidate_hash ~ '^[0-9a-f]{64}$'),
  constraint live_data_signal_candidate_input_hash_check
    check (source_input_hash ~ '^[0-9a-f]{64}$'),
  constraint live_data_signal_candidate_refs_check
    check (jsonb_typeof(source_event_refs) = 'array' and jsonb_array_length(source_event_refs) > 0),
  constraint live_data_signal_candidate_statistics_check
    check (jsonb_typeof(supporting_statistics) = 'object' and supporting_statistics <> '{}'::jsonb),
  constraint live_data_signal_candidate_severity_check
    check (severity in ('critical', 'high', 'medium')),
  constraint live_data_signal_candidate_confidence_check
    check (confidence_score >= 0 and confidence_score <= 1),
  constraint live_data_signal_candidate_bridge_status_check
    check (lighthouse_status in ('pending', 'bridged', 'failed'))
);

create index if not exists idx_live_data_signal_candidate_bridge
  on atlas.live_data_signal_candidate(lighthouse_status, detected_at desc);
create index if not exists idx_live_data_signal_candidate_entity
  on atlas.live_data_signal_candidate using gin(entity_ids);

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

    with canonical_events as (
      select
        event.stream_id,
        event."offset",
        event.timestamp,
        event.ingested_at,
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
        max(ingested_at) as source_freshness_at,
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
        entity.match_count
      from aggregates aggregate
      cross join lateral (
        select
          min(registry.entity_id) as entity_id,
          min(registry.entity_type) as entity_type,
          min(registry.primary_name) as primary_name,
          count(*)::integer as match_count
        from atlas.entity_registry registry
        where registry.is_active
          and lower(trim(registry.primary_name)) = aggregate.normalized_entity_name
      ) entity
      where entity.match_count = 1
    ),
    eligible as (
      select
        exact.*,
        case
          when unresolved_unique_rate >= 0.95 and unique_record_count >= 100 then 'critical'
          when unresolved_unique_rate >= 0.80 and unique_record_count >= greatest(p_min_unique_records, 10) then 'high'
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
      where unique_record_count >= greatest(p_min_unique_records, 1)
        and unresolved_unique_rate >= greatest(p_min_unresolved_rate, 0)
      order by unresolved_unique_rate desc, unique_record_count desc, entity_id
      limit least(greatest(p_limit, 1), 1000)
    ),
    prepared as (
      select
        eligible.*,
        jsonb_build_object(
          'unique_source_record_count', unique_record_count,
          'unresolved_unique_record_count', unresolved_unique_record_count,
          'unresolved_unique_rate', unresolved_unique_rate,
          'minimum_unique_records', greatest(p_min_unique_records, 1),
          'minimum_unresolved_rate', greatest(p_min_unresolved_rate, 0),
          'identity_unit', 'unique external_id plus pdf_url',
          'historical_raw_event_count', (
            select count(*)
            from public.signal_events event
            where event.stream_id = 'pro_publica'
              and event.signal_type = 'nonprofit_990_filing'
              and lower(trim(coalesce(event.payload->>'organization_name', ''))) = eligible.normalized_entity_name
          ),
          'canonical_event_count', (
            select count(*)
            from canonical_events event
            where event.normalized_entity_name = eligible.normalized_entity_name
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
                'rule_contract_hash', v_rule_hash
              )::text,
              'UTF8'
            ),
            'sha256'
          ),
          'hex'
        ) as source_input_hash
      from eligible
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
                'rule_id', 'atlas.propublica_unresolved_filing_metadata_rate',
                'rule_version', '1.0.0'
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
        supporting_statistics,
        source_event_refs,
        source_freshness_at,
        clock_timestamp(),
        source_input_hash,
        v_run_id,
        v_run_id
      from prepared
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
        )
        order by severity, candidate_id
      ), '[]'::jsonb),
      count(*)
    into v_result, v_candidates
    from inserted;

    select count(*) into v_entities
      from (
        select distinct lower(trim(payload->>'organization_name'))
        from public.signal_events
        where stream_id = 'pro_publica'
          and signal_type = 'nonprofit_990_filing'
          and coalesce(payload->>'organization_name', '') <> ''
      ) entity_names;

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
    raise;
  end;

  return jsonb_build_object(
    'run_id', v_run_id,
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

revoke all on function public.detect_propublica_unresolved_metadata_v1(
  integer, numeric, integer
) from public, anon, authenticated;
grant execute on function public.detect_propublica_unresolved_metadata_v1(
  integer, numeric, integer
) to service_role;

create or replace function public.mark_live_data_signal_candidate_bridge_v1(
  p_candidate_id uuid,
  p_status text,
  p_lighthouse_record_id uuid default null,
  p_error_message text default null
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
begin
  if p_status not in ('bridged', 'failed') then
    raise exception 'unsupported bridge status: %', p_status;
  end if;

  update atlas.live_data_signal_candidate
     set lighthouse_status = p_status,
         lighthouse_record_id = case
           when p_status = 'bridged' then p_lighthouse_record_id
           else lighthouse_record_id
         end,
         lighthouse_last_error = case
           when p_status = 'failed' then left(p_error_message, 2000)
           else null
         end,
         lighthouse_bridged_at = case
           when p_status = 'bridged' then clock_timestamp()
           else lighthouse_bridged_at
         end
   where candidate_id = p_candidate_id;

  if not found then
    raise exception 'live-data signal candidate not found: %', p_candidate_id;
  end if;
end
$function$;

revoke all on function public.mark_live_data_signal_candidate_bridge_v1(
  uuid, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.mark_live_data_signal_candidate_bridge_v1(
  uuid, text, uuid, text
) to service_role;

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
    event.ingested_at
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

alter table atlas.signal_event_identity enable row level security;
alter table atlas.signal_event_ingest_run enable row level security;
alter table atlas.live_data_signal_rule enable row level security;
alter table atlas.live_data_signal_run enable row level security;
alter table atlas.live_data_signal_candidate enable row level security;

revoke all on table atlas.signal_event_identity from public, anon, authenticated;
revoke all on table atlas.signal_event_ingest_run from public, anon, authenticated;
revoke all on table atlas.live_data_signal_rule from public, anon, authenticated;
revoke all on table atlas.live_data_signal_run from public, anon, authenticated;
revoke all on table atlas.live_data_signal_candidate from public, anon, authenticated;

grant select, insert, update on table atlas.signal_event_identity to service_role;
grant select, insert, update on table atlas.signal_event_ingest_run to service_role;
grant select on table atlas.live_data_signal_rule to service_role;
grant select, insert, update on table atlas.live_data_signal_run to service_role;
grant select, insert, update on table atlas.live_data_signal_candidate to service_role;

comment on table atlas.signal_event_identity is
  'Canonical replay-safe Atlas observation identity. Historical duplicate signal_events remain preserved but do not circulate as current unique observations.';
comment on table atlas.live_data_signal_candidate is
  'Atlas-owned Domain 3 output candidate. Contains explicit statistics, entity resolution, severity, confidence, rule, engine, source-event references, and Lighthouse bridge receipt.';
comment on function public.detect_propublica_unresolved_metadata_v1(integer, numeric, integer) is
  'Deterministic data-quality detector. Produces observation candidates only; it does not allege misconduct or create governed findings.';