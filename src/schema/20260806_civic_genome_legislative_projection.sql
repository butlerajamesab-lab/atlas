begin;

create schema if not exists atlas;

insert into public.streams (
  stream_id, source_id, jurisdiction_id, module_hint,
  throughput_profile, safety_profile, governance_contract_id, status
) values (
  'civic_genome_legislative_versions',
  'lighthouse_civic_genome_snapshot',
  'WA',
  'legislative_history',
  'low',
  'critical',
  'atlas.civic_genome_legislative_version_observation@1.0.0',
  'active'
)
on conflict (stream_id) do update set
  source_id = excluded.source_id,
  jurisdiction_id = excluded.jurisdiction_id,
  module_hint = excluded.module_hint,
  throughput_profile = excluded.throughput_profile,
  safety_profile = excluded.safety_profile,
  governance_contract_id = excluded.governance_contract_id,
  status = excluded.status;

create table if not exists atlas.civic_genome_legislative_projection_run (
  projection_key text primary key check (projection_key ~ '^[0-9a-f]{64}$'),
  mapping_rule_id text not null,
  mapping_rule_version text not null,
  mapping_rule_hash text not null check (mapping_rule_hash ~ '^[0-9a-f]{64}$'),
  source_snapshot_id text not null references atlas.civic_genome_external_snapshot(source_snapshot_id),
  source_snapshot_hash text not null check (source_snapshot_hash ~ '^[0-9a-f]{64}$'),
  version_manifest_hash text not null check (version_manifest_hash ~ '^[0-9a-f]{64}$'),
  source_version_count integer not null check (source_version_count >= 0),
  observation_count integer not null check (observation_count >= 0),
  observation_hash text not null check (observation_hash ~ '^[0-9a-f]{64}$'),
  ingest_run_id uuid,
  events_inserted integer not null check (events_inserted >= 0),
  replays_suppressed integer not null check (replays_suppressed >= 0),
  status text not null check (status in ('completed')),
  receipt_json jsonb not null,
  persisted_at timestamptz not null default now()
);

create or replace function atlas.prevent_civic_genome_legislative_projection_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, atlas
as $$
begin
  raise exception 'Atlas Civic Genome legislative projection receipts are immutable';
end;
$$;

drop trigger if exists civic_genome_legislative_projection_immutable
  on atlas.civic_genome_legislative_projection_run;
create trigger civic_genome_legislative_projection_immutable
before update or delete on atlas.civic_genome_legislative_projection_run
for each row execute function atlas.prevent_civic_genome_legislative_projection_mutation();

alter table atlas.civic_genome_legislative_projection_run enable row level security;
alter table atlas.civic_genome_legislative_projection_run force row level security;
revoke all privileges on atlas.civic_genome_legislative_projection_run
  from public, anon, authenticated, service_role;

create or replace function public.atlas_civic_genome_snapshot_get_v1(p_snapshot_id text)
returns jsonb
language sql
security definer
set search_path = pg_catalog, atlas
as $$
  select snapshot_json
  from atlas.civic_genome_external_snapshot
  where source_snapshot_id = p_snapshot_id
$$;
revoke all on function public.atlas_civic_genome_snapshot_get_v1(text)
  from public, anon, authenticated;
grant execute on function public.atlas_civic_genome_snapshot_get_v1(text) to service_role;

create or replace function public.atlas_civic_genome_legislative_projection_persist_v1(p_bundle jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, atlas
as $$
declare
  v_projection_key text := p_bundle->>'projection_key';
  v_snapshot_id text := p_bundle->>'source_snapshot_id';
  v_snapshot_hash text := p_bundle->>'source_snapshot_hash';
  v_observation_count integer := (p_bundle->>'observation_count')::integer;
  v_existing atlas.civic_genome_legislative_projection_run%rowtype;
  v_source atlas.civic_genome_external_snapshot%rowtype;
  v_observation jsonb;
  v_ingest jsonb;
  v_receipt jsonb;
begin
  if p_bundle->>'bundle_version' <> 'atlas_civic_genome_legislative_projection.v1' then
    raise exception 'atlas_civic_genome_projection_bundle_version_invalid';
  end if;
  if v_projection_key !~ '^[0-9a-f]{64}$'
     or p_bundle->>'mapping_rule_hash' !~ '^[0-9a-f]{64}$'
     or p_bundle->>'version_manifest_hash' !~ '^[0-9a-f]{64}$'
     or p_bundle->>'observation_hash' !~ '^[0-9a-f]{64}$' then
    raise exception 'atlas_civic_genome_projection_hash_invalid';
  end if;
  if jsonb_typeof(p_bundle->'observations') <> 'array'
     or jsonb_array_length(p_bundle->'observations') <> v_observation_count then
    raise exception 'atlas_civic_genome_projection_observation_count_mismatch';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_projection_key, 0));
  select * into v_existing
  from atlas.civic_genome_legislative_projection_run
  where projection_key = v_projection_key;
  if found then
    if v_existing.source_snapshot_hash is distinct from v_snapshot_hash
       or v_existing.observation_hash is distinct from p_bundle->>'observation_hash'
       or v_existing.version_manifest_hash is distinct from p_bundle->>'version_manifest_hash'
       or v_existing.observation_count is distinct from v_observation_count then
      raise exception 'atlas_civic_genome_projection_identity_collision';
    end if;
    return jsonb_build_object(
      'status','idempotent',
      'projection_key',v_existing.projection_key,
      'source_snapshot_id',v_existing.source_snapshot_id,
      'observation_count',v_existing.observation_count,
      'events_inserted',v_existing.events_inserted,
      'replays_suppressed',v_existing.replays_suppressed,
      'persisted_at',v_existing.persisted_at
    );
  end if;

  select * into v_source
  from atlas.civic_genome_external_snapshot
  where source_snapshot_id = v_snapshot_id;
  if not found or v_source.source_snapshot_hash is distinct from v_snapshot_hash then
    raise exception 'atlas_civic_genome_projection_source_snapshot_mismatch';
  end if;
  if v_source.methodology_version <> 'civic_genome_external_family_snapshot.1.1.0' then
    raise exception 'atlas_civic_genome_projection_source_methodology_invalid';
  end if;

  for v_observation in select value from jsonb_array_elements(p_bundle->'observations')
  loop
    if v_observation->>'stream_id' <> 'civic_genome_legislative_versions'
       or v_observation->>'source_id' <> 'lighthouse_civic_genome_snapshot'
       or v_observation->>'module_hint' <> 'legislative_history'
       or v_observation->'payload'->>'source_snapshot_id' <> v_snapshot_id
       or v_observation->'payload'->>'source_snapshot_hash' <> v_snapshot_hash
       or v_observation->'payload'->>'mapping_rule_hash' <> p_bundle->>'mapping_rule_hash' then
      raise exception 'atlas_civic_genome_projection_observation_boundary_invalid';
    end if;
  end loop;

  select public.persist_signal_event_batch_v2(p_bundle->'observations') into v_ingest;
  if v_ingest->>'status' <> 'completed'
     or coalesce((v_ingest->>'records_failed')::integer, 0) <> 0 then
    raise exception 'atlas_civic_genome_projection_signal_ingest_failed: %', v_ingest::text;
  end if;

  v_receipt := jsonb_build_object(
    'projection_key',v_projection_key,
    'mapping_rule_id',p_bundle->'mapping_rule'->>'rule_id',
    'mapping_rule_version',p_bundle->'mapping_rule'->>'rule_version',
    'mapping_rule_hash',p_bundle->>'mapping_rule_hash',
    'source_snapshot_id',v_snapshot_id,
    'source_snapshot_hash',v_snapshot_hash,
    'version_manifest_hash',p_bundle->>'version_manifest_hash',
    'source_version_count',(p_bundle->>'source_version_count')::integer,
    'observation_count',v_observation_count,
    'observation_hash',p_bundle->>'observation_hash',
    'ingest',v_ingest,
    'no_upstream_mutation',true,
    'no_consequence_interpretation',true
  );

  insert into atlas.civic_genome_legislative_projection_run (
    projection_key,mapping_rule_id,mapping_rule_version,mapping_rule_hash,
    source_snapshot_id,source_snapshot_hash,version_manifest_hash,
    source_version_count,observation_count,observation_hash,ingest_run_id,
    events_inserted,replays_suppressed,status,receipt_json
  ) values (
    v_projection_key,
    p_bundle->'mapping_rule'->>'rule_id',
    p_bundle->'mapping_rule'->>'rule_version',
    p_bundle->>'mapping_rule_hash',
    v_snapshot_id,v_snapshot_hash,p_bundle->>'version_manifest_hash',
    (p_bundle->>'source_version_count')::integer,
    v_observation_count,p_bundle->>'observation_hash',(v_ingest->>'run_id')::uuid,
    (v_ingest->>'events_inserted')::integer,
    (v_ingest->>'replays_suppressed')::integer,
    'completed',v_receipt
  );

  return jsonb_build_object(
    'status','inserted',
    'projection_key',v_projection_key,
    'source_snapshot_id',v_snapshot_id,
    'source_version_count',(p_bundle->>'source_version_count')::integer,
    'observation_count',v_observation_count,
    'events_inserted',(v_ingest->>'events_inserted')::integer,
    'replays_suppressed',(v_ingest->>'replays_suppressed')::integer,
    'ingest_run_id',v_ingest->>'run_id'
  );
end;
$$;
revoke all on function public.atlas_civic_genome_legislative_projection_persist_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.atlas_civic_genome_legislative_projection_persist_v1(jsonb)
  to service_role;

commit;
