create extension if not exists pgcrypto with schema extensions;
create schema if not exists atlas;

create table if not exists atlas.geography_registry_snapshot (
  registry_hash text primary key check (registry_hash ~ '^[a-f0-9]{64}$'),
  registry_version text not null,
  jurisdiction text not null,
  analysis_level text not null,
  source_id text not null,
  source_version text,
  source_url text,
  record_count integer not null check (record_count > 0),
  entries_json jsonb not null,
  provenance_records jsonb not null,
  persisted_at timestamptz not null default now()
);

create table if not exists atlas.convergence_run_manifest (
  run_key text primary key check (run_key ~ '^[a-f0-9]{64}$'),
  engine_version text not null,
  as_of bigint not null,
  time_window_ms bigint not null check (time_window_ms > 0),
  temporal_bucket_ms bigint not null check (temporal_bucket_ms > 0),
  geography_registry_version text not null check (geography_registry_version ~ '^[a-f0-9]{64}$'),
  analysis_registry_hash text not null check (analysis_registry_hash ~ '^[a-f0-9]{64}$'),
  analysis_level text not null,
  rule_manifest_hash text not null check (rule_manifest_hash ~ '^[a-f0-9]{64}$'),
  configuration_hash text not null check (configuration_hash ~ '^[a-f0-9]{64}$'),
  configuration_json jsonb not null,
  source_population_hash text not null check (source_population_hash ~ '^[a-f0-9]{64}$'),
  transformed_population_hash text not null check (transformed_population_hash ~ '^[a-f0-9]{64}$'),
  deduplicated_population_hash text not null check (deduplicated_population_hash ~ '^[a-f0-9]{64}$'),
  total_source_rows integer not null check (total_source_rows >= 0),
  total_signals_raw integer not null check (total_signals_raw >= 0),
  total_signals_deduplicated integer not null check (total_signals_deduplicated >= 0),
  total_geographies integer not null check (total_geographies > 0),
  receipt_count integer not null check (receipt_count = total_geographies),
  output_hash text not null check (output_hash ~ '^[a-f0-9]{64}$'),
  persisted_at timestamptz not null default now(),
  foreign key (analysis_registry_hash) references atlas.geography_registry_snapshot(registry_hash)
);

create table if not exists atlas.convergence_signal_snapshot (
  run_key text not null references atlas.convergence_run_manifest(run_key),
  snapshot_type text not null check (snapshot_type in ('source', 'transformed', 'deduplicated')),
  population_hash text not null check (population_hash ~ '^[a-f0-9]{64}$'),
  record_count integer not null check (record_count >= 0),
  records_json jsonb not null,
  persisted_at timestamptz not null default now(),
  primary key (run_key, snapshot_type)
);

create table if not exists atlas.convergence_receipt (
  run_key text not null references atlas.convergence_run_manifest(run_key),
  geography_id text not null,
  receipt_identity text not null unique check (receipt_identity ~ '^[a-f0-9]{64}$'),
  equation_id text not null,
  engine_version text not null,
  rule_manifest_hash text not null check (rule_manifest_hash ~ '^[a-f0-9]{64}$'),
  as_of bigint not null,
  configuration_hash text not null check (configuration_hash ~ '^[a-f0-9]{64}$'),
  source_population_hash text not null check (source_population_hash ~ '^[a-f0-9]{64}$'),
  input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
  output_hash text not null check (output_hash ~ '^[a-f0-9]{64}$'),
  source_signal_ids jsonb not null,
  geography_registry_version text not null check (geography_registry_version ~ '^[a-f0-9]{64}$'),
  expected_count numeric,
  observed_count integer not null check (observed_count >= 0),
  z_score numeric,
  convergence_detected boolean not null,
  status text not null check (status in ('resolved', 'unresolved', 'below_threshold')),
  reason_unresolved text,
  computed_outputs jsonb not null,
  timestamp_computed bigint not null,
  persisted_at timestamptz not null default now(),
  primary key (run_key, geography_id)
);

create table if not exists atlas.convergence_result_payload (
  run_key text primary key references atlas.convergence_run_manifest(run_key),
  output_hash text not null check (output_hash ~ '^[a-f0-9]{64}$'),
  payload_json jsonb not null,
  receipt_count integer not null check (receipt_count > 0),
  persisted_at timestamptz not null default now()
);

create or replace function atlas.prevent_convergence_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, atlas
as $$
begin
  raise exception 'Atlas convergence persistence is immutable';
end;
$$;

create or replace function atlas.install_immutable_trigger(p_table regclass, p_name text)
returns void
language plpgsql
set search_path = pg_catalog, atlas
as $$
begin
  execute format('drop trigger if exists %I on %s', p_name, p_table);
  execute format(
    'create trigger %I before update or delete on %s for each row execute function atlas.prevent_convergence_mutation()',
    p_name,
    p_table
  );
end;
$$;

select atlas.install_immutable_trigger('atlas.geography_registry_snapshot', 'geography_registry_snapshot_immutable');
select atlas.install_immutable_trigger('atlas.convergence_run_manifest', 'convergence_run_manifest_immutable');
select atlas.install_immutable_trigger('atlas.convergence_signal_snapshot', 'convergence_signal_snapshot_immutable');
select atlas.install_immutable_trigger('atlas.convergence_receipt', 'convergence_receipt_immutable');
select atlas.install_immutable_trigger('atlas.convergence_result_payload', 'convergence_result_payload_immutable');
drop function atlas.install_immutable_trigger(regclass, text);

alter table atlas.geography_registry_snapshot enable row level security;
alter table atlas.geography_registry_snapshot force row level security;
alter table atlas.convergence_run_manifest enable row level security;
alter table atlas.convergence_run_manifest force row level security;
alter table atlas.convergence_signal_snapshot enable row level security;
alter table atlas.convergence_signal_snapshot force row level security;
alter table atlas.convergence_receipt enable row level security;
alter table atlas.convergence_receipt force row level security;
alter table atlas.convergence_result_payload enable row level security;
alter table atlas.convergence_result_payload force row level security;

revoke all privileges on table atlas.geography_registry_snapshot from public, anon, authenticated, service_role;
revoke all privileges on table atlas.convergence_run_manifest from public, anon, authenticated, service_role;
revoke all privileges on table atlas.convergence_signal_snapshot from public, anon, authenticated, service_role;
revoke all privileges on table atlas.convergence_receipt from public, anon, authenticated, service_role;
revoke all privileges on table atlas.convergence_result_payload from public, anon, authenticated, service_role;

create or replace function public.atlas_convergence_source_population_page_v1(
  p_from_timestamp timestamptz,
  p_to_timestamp timestamptz,
  p_after_stream_id text default null,
  p_after_offset bigint default null,
  p_limit integer default 1000
)
returns table(row_json jsonb)
language sql
security definer
set search_path = pg_catalog, public, atlas
as $$
  select jsonb_build_object(
    'stream_id', event.stream_id,
    'offset', event.offset::text,
    'timestamp', event.timestamp,
    'signal_type', event.signal_type,
    'spacetime', event.spacetime,
    'provenance', event.provenance,
    'payload', event.payload,
    'source_id', event.source_id,
    'jurisdiction_id', event.jurisdiction_id,
    'module_hint', event.module_hint,
    'ingested_at', event.ingested_at,
    'event_identity_hash', identity.event_identity_hash,
    'canonical_identity', jsonb_build_object(
      'canonical_offset', identity.canonical_offset::text,
      'latest_historical_offset', identity.latest_historical_offset::text,
      'historical_event_count', identity.historical_event_count::text,
      'replay_count', identity.replay_count::text,
      'source_record_key', identity.source_record_key,
      'first_seen_at', identity.first_seen_at,
      'last_seen_at', identity.last_seen_at,
      'source_timestamp', identity.source_timestamp
    )
  ) as row_json
  from public.signal_events event
  join atlas.signal_event_identity identity
    on identity.stream_id = event.stream_id
   and identity.canonical_offset = event.offset
   and identity.event_identity_hash = event.event_identity_hash
  where event.timestamp >= p_from_timestamp
    and event.timestamp <= p_to_timestamp
    and (
      p_after_stream_id is null
      or event.stream_id > p_after_stream_id
      or (event.stream_id = p_after_stream_id and event.offset > p_after_offset)
    )
  order by event.stream_id, event.offset
  limit least(greatest(coalesce(p_limit, 1000), 1), 1000)
$$;

create or replace function public.atlas_convergence_persist_run_v1(p_bundle jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, atlas
as $$
declare
  v_registry jsonb := p_bundle->'registry';
  v_manifest jsonb := p_bundle->'manifest';
  v_result jsonb := p_bundle->'result';
  v_snapshot jsonb;
  v_receipt jsonb;
  v_run_key text := v_manifest->>'run_key';
  v_existing_manifest atlas.convergence_run_manifest%rowtype;
  v_existing_registry atlas.geography_registry_snapshot%rowtype;
  v_existing_result atlas.convergence_result_payload%rowtype;
  v_expected_receipts integer := jsonb_array_length(coalesce(p_bundle->'receipts', '[]'::jsonb));
  v_expected_snapshots integer := jsonb_array_length(coalesce(p_bundle->'snapshots', '[]'::jsonb));
begin
  if p_bundle->>'bundle_version' <> 'atlas_convergence_persistence.v2.1.0' then
    raise exception 'unsupported convergence persistence bundle version';
  end if;
  if v_run_key is null or v_run_key !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid convergence run_key';
  end if;
  if v_expected_receipts < 1 or v_expected_receipts <> (v_manifest->>'receipt_count')::integer then
    raise exception 'receipt count does not match manifest';
  end if;
  if v_expected_snapshots <> 3 then
    raise exception 'exactly three source/transformed/deduplicated snapshots are required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_run_key, 0));

  select * into v_existing_manifest
  from atlas.convergence_run_manifest
  where run_key = v_run_key;

  if found then
    select * into v_existing_result
    from atlas.convergence_result_payload
    where run_key = v_run_key;

    if v_existing_manifest.output_hash is distinct from v_result->>'output_hash'
       or v_existing_manifest.configuration_json is distinct from v_manifest->'configuration_json'
       or v_existing_manifest.source_population_hash is distinct from v_manifest->>'source_population_hash'
       or v_existing_manifest.receipt_count is distinct from v_expected_receipts
       or v_existing_result.output_hash is distinct from v_result->>'output_hash'
       or v_existing_result.payload_json is distinct from v_result->'payload_json'
       or v_existing_result.receipt_count is distinct from v_expected_receipts then
      raise exception 'run_key % already exists with different governed content', v_run_key;
    end if;

    return jsonb_build_object(
      'status', 'idempotent',
      'run_key', v_run_key,
      'output_hash', v_existing_result.output_hash,
      'receipt_count', v_existing_result.receipt_count
    );
  end if;

  insert into atlas.geography_registry_snapshot (
    registry_hash, registry_version, jurisdiction, analysis_level,
    source_id, source_version, source_url, record_count,
    entries_json, provenance_records
  ) values (
    v_registry->>'registry_hash',
    v_registry->>'registry_version',
    v_registry->>'jurisdiction',
    v_registry->>'analysis_level',
    v_registry->>'source_id',
    v_registry->>'source_version',
    v_registry->>'source_url',
    jsonb_array_length(v_registry->'entries_json'->'entries'),
    v_registry->'entries_json',
    v_registry->'provenance_records'
  ) on conflict (registry_hash) do nothing;

  select * into v_existing_registry
  from atlas.geography_registry_snapshot
  where registry_hash = v_registry->>'registry_hash';

  if not found
     or v_existing_registry.registry_version is distinct from v_registry->>'registry_version'
     or v_existing_registry.analysis_level is distinct from v_registry->>'analysis_level'
     or v_existing_registry.entries_json is distinct from v_registry->'entries_json'
     or v_existing_registry.provenance_records is distinct from v_registry->'provenance_records' then
    raise exception 'geography registry hash conflict';
  end if;

  insert into atlas.convergence_run_manifest (
    run_key, engine_version, as_of, time_window_ms, temporal_bucket_ms,
    geography_registry_version, analysis_registry_hash, analysis_level,
    rule_manifest_hash, configuration_hash, configuration_json,
    source_population_hash, transformed_population_hash,
    deduplicated_population_hash, total_source_rows, total_signals_raw,
    total_signals_deduplicated, total_geographies, receipt_count, output_hash
  ) values (
    v_run_key,
    v_manifest->>'engine_version',
    (v_manifest->>'as_of')::bigint,
    (v_manifest->>'time_window_ms')::bigint,
    (v_manifest->>'temporal_bucket_ms')::bigint,
    v_manifest->>'geography_registry_version',
    v_manifest->>'analysis_registry_hash',
    v_manifest->>'analysis_level',
    v_manifest->>'rule_manifest_hash',
    v_manifest->>'configuration_hash',
    v_manifest->'configuration_json',
    v_manifest->>'source_population_hash',
    v_manifest->>'transformed_population_hash',
    v_manifest->>'deduplicated_population_hash',
    (v_manifest->>'total_source_rows')::integer,
    (v_manifest->>'total_signals_raw')::integer,
    (v_manifest->>'total_signals_deduplicated')::integer,
    (v_manifest->>'total_geographies')::integer,
    (v_manifest->>'receipt_count')::integer,
    v_manifest->>'output_hash'
  );

  for v_snapshot in select value from jsonb_array_elements(p_bundle->'snapshots')
  loop
    insert into atlas.convergence_signal_snapshot (
      run_key, snapshot_type, population_hash, record_count, records_json
    ) values (
      v_run_key,
      v_snapshot->>'snapshot_type',
      v_snapshot->>'population_hash',
      jsonb_array_length(v_snapshot->'records'),
      v_snapshot->'records'
    );
  end loop;

  for v_receipt in select value from jsonb_array_elements(p_bundle->'receipts')
  loop
    if v_receipt->>'run_key' is distinct from v_run_key then
      raise exception 'receipt run_key mismatch';
    end if;
    insert into atlas.convergence_receipt (
      run_key, geography_id, receipt_identity, equation_id, engine_version,
      rule_manifest_hash, as_of, configuration_hash, source_population_hash,
      input_hash, output_hash, source_signal_ids, geography_registry_version,
      expected_count, observed_count, z_score, convergence_detected, status,
      reason_unresolved, computed_outputs, timestamp_computed
    ) values (
      v_run_key,
      v_receipt->>'geography_id',
      v_receipt->>'receipt_identity',
      v_receipt->>'equation_id',
      v_receipt->>'engine_version',
      v_receipt->>'rule_manifest_hash',
      (v_receipt->>'as_of')::bigint,
      v_receipt->>'configuration_hash',
      v_receipt->>'source_population_hash',
      v_receipt->>'input_hash',
      v_receipt->>'output_hash',
      v_receipt->'source_signal_ids',
      v_receipt->>'geography_registry_version',
      nullif(v_receipt->>'expected_count', '')::numeric,
      (v_receipt->>'observed_count')::integer,
      nullif(v_receipt->>'z_score', '')::numeric,
      (v_receipt->>'convergence_detected')::boolean,
      v_receipt->>'status',
      v_receipt->>'reason_unresolved',
      v_receipt->'computed_outputs',
      (v_receipt->>'timestamp_computed')::bigint
    );
  end loop;

  insert into atlas.convergence_result_payload (
    run_key, output_hash, payload_json, receipt_count
  ) values (
    v_run_key,
    v_result->>'output_hash',
    v_result->'payload_json',
    (v_result->>'receipt_count')::integer
  );

  return jsonb_build_object(
    'status', 'created',
    'run_key', v_run_key,
    'output_hash', v_result->>'output_hash',
    'receipt_count', v_expected_receipts
  );
end;
$$;

create or replace function public.atlas_convergence_get_run_v1(p_run_key text)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, atlas
as $$
  select jsonb_build_object(
    'manifest', to_jsonb(manifest) - 'persisted_at',
    'result', to_jsonb(result) - 'persisted_at',
    'receipts', coalesce((
      select jsonb_agg(to_jsonb(receipt) - 'persisted_at' order by receipt.geography_id)
      from atlas.convergence_receipt receipt
      where receipt.run_key = manifest.run_key
    ), '[]'::jsonb)
  )
  from atlas.convergence_run_manifest manifest
  join atlas.convergence_result_payload result using (run_key)
  where manifest.run_key = p_run_key
$$;

create or replace function public.atlas_convergence_get_replay_bundle_v1(p_run_key text)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, atlas
as $$
  select jsonb_build_object(
    'manifest', to_jsonb(manifest) - 'persisted_at',
    'registry', jsonb_build_object(
      'registry_hash', registry.registry_hash,
      'registry_version', registry.registry_version,
      'jurisdiction', registry.jurisdiction,
      'analysis_level', registry.analysis_level,
      'source_id', registry.source_id,
      'source_version', registry.source_version,
      'source_url', registry.source_url,
      'entries_json', registry.entries_json,
      'provenance_records', registry.provenance_records
    ),
    'snapshots', coalesce((
      select jsonb_agg(to_jsonb(snapshot) - 'persisted_at' order by snapshot.snapshot_type)
      from atlas.convergence_signal_snapshot snapshot
      where snapshot.run_key = manifest.run_key
    ), '[]'::jsonb),
    'receipts', coalesce((
      select jsonb_agg(to_jsonb(receipt) - 'persisted_at' order by receipt.geography_id)
      from atlas.convergence_receipt receipt
      where receipt.run_key = manifest.run_key
    ), '[]'::jsonb),
    'result', to_jsonb(result) - 'persisted_at'
  )
  from atlas.convergence_run_manifest manifest
  join atlas.geography_registry_snapshot registry
    on registry.registry_hash = manifest.analysis_registry_hash
  join atlas.convergence_result_payload result using (run_key)
  where manifest.run_key = p_run_key
$$;

revoke all on function public.atlas_convergence_source_population_page_v1(timestamptz, timestamptz, text, bigint, integer)
  from public, anon, authenticated;
revoke all on function public.atlas_convergence_persist_run_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.atlas_convergence_get_run_v1(text)
  from public, anon, authenticated;
revoke all on function public.atlas_convergence_get_replay_bundle_v1(text)
  from public, anon, authenticated;

grant execute on function public.atlas_convergence_source_population_page_v1(timestamptz, timestamptz, text, bigint, integer)
  to service_role;
grant execute on function public.atlas_convergence_persist_run_v1(jsonb)
  to service_role;
grant execute on function public.atlas_convergence_get_run_v1(text)
  to service_role;
grant execute on function public.atlas_convergence_get_replay_bundle_v1(text)
  to service_role;

revoke execute on function atlas.prevent_convergence_mutation()
  from public, anon, authenticated, service_role;
