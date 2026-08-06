begin;

create extension if not exists pgcrypto;
create schema if not exists atlas;

-- Atlas connector registry previously lacked an HMAC transport classification.
-- Add the exact auth type rather than mislabeling the Civic Genome handoff.
alter table public.connector_registry drop constraint if exists connector_registry_auth_type_check;
alter table public.connector_registry add constraint connector_registry_auth_type_check
  check (auth_type::text = any (array['none','bearer','api_key','oauth2','basic','hmac_sha256']::text[]));

create table if not exists atlas.civic_genome_external_snapshot (
  source_snapshot_id text primary key,
  source_snapshot_hash text not null unique check (source_snapshot_hash ~ '^[0-9a-f]{64}$'),
  source_schema_id text not null,
  source_contract_id text not null,
  source_contract_version text not null,
  source_owner text not null check (source_owner = 'lighthouse/civic_genome'),
  snapshot_kind text not null check (snapshot_kind = 'baseline_export'),
  source_as_of timestamptz not null,
  methodology_version text not null,
  scope_json jsonb not null,
  component_count integer not null check (component_count >= 0),
  completeness_state text not null,
  unresolved_conditions jsonb not null,
  excluded_component_types jsonb not null,
  source_export_receipt_id text not null,
  source_export_receipt_hash text not null check (source_export_receipt_hash ~ '^[0-9a-f]{64}$'),
  deterministic_replay_key text not null check (deterministic_replay_key ~ '^[0-9a-f]{64}$'),
  source_commit_sha text,
  snapshot_json jsonb not null,
  atlas_binding_hash text not null check (atlas_binding_hash ~ '^[0-9a-f]{64}$'),
  delivery_key_id text not null,
  delivery_receipt_hash text not null check (delivery_receipt_hash ~ '^[0-9a-f]{64}$'),
  received_at timestamptz not null default now()
);

create index if not exists idx_atlas_civic_genome_snapshot_as_of
  on atlas.civic_genome_external_snapshot(source_as_of desc);
create index if not exists idx_atlas_civic_genome_snapshot_scope
  on atlas.civic_genome_external_snapshot using gin(scope_json);

create or replace function atlas.prevent_civic_genome_snapshot_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, atlas
as $$
begin
  raise exception 'Atlas Civic Genome external snapshots are immutable';
end;
$$;

drop trigger if exists civic_genome_external_snapshot_immutable on atlas.civic_genome_external_snapshot;
create trigger civic_genome_external_snapshot_immutable
before update or delete on atlas.civic_genome_external_snapshot
for each row execute function atlas.prevent_civic_genome_snapshot_mutation();

alter table atlas.civic_genome_external_snapshot enable row level security;
alter table atlas.civic_genome_external_snapshot force row level security;
revoke all privileges on atlas.civic_genome_external_snapshot from public, anon, authenticated, service_role;

create or replace function public.atlas_civic_genome_snapshot_persist_v1(p_record jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, atlas
as $$
declare
  v_snapshot jsonb := p_record->'snapshot';
  v_existing atlas.civic_genome_external_snapshot%rowtype;
  v_snapshot_id text := v_snapshot->>'snapshot_id';
  v_snapshot_hash text := v_snapshot->>'snapshot_hash';
  v_component_count integer := (v_snapshot->>'component_count')::integer;
begin
  if p_record->>'source_schema_id' <> 'https://luminari.org/civic-genome/contracts/external-snapshot.v1.schema.json' then
    raise exception 'atlas_civic_genome_source_schema_mismatch';
  end if;
  if v_snapshot->>'contract_id' <> 'civic_genome.external_snapshot.v1'
     or v_snapshot->>'contract_version' <> '1.0.0'
     or v_snapshot->>'canonical_owner' <> 'lighthouse/civic_genome'
     or v_snapshot->>'snapshot_kind' <> 'baseline_export'
     or coalesce((v_snapshot->>'immutable')::boolean, false) is distinct from true then
    raise exception 'atlas_civic_genome_source_contract_mismatch';
  end if;
  if v_snapshot_id is null or v_snapshot_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'atlas_civic_genome_snapshot_identity_invalid';
  end if;
  if jsonb_typeof(v_snapshot->'components') <> 'array'
     or jsonb_array_length(v_snapshot->'components') <> v_component_count then
    raise exception 'atlas_civic_genome_component_count_mismatch';
  end if;
  if p_record->>'atlas_binding_hash' !~ '^[0-9a-f]{64}$'
     or p_record->>'delivery_receipt_hash' !~ '^[0-9a-f]{64}$' then
    raise exception 'atlas_civic_genome_delivery_identity_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_snapshot_id, 0));
  select * into v_existing from atlas.civic_genome_external_snapshot
   where source_snapshot_id = v_snapshot_id;

  if found then
    if v_existing.source_snapshot_hash is distinct from v_snapshot_hash
       or v_existing.source_export_receipt_hash is distinct from v_snapshot->'export_receipt'->>'export_receipt_hash'
       or v_existing.atlas_binding_hash is distinct from p_record->>'atlas_binding_hash'
       or v_existing.snapshot_json is distinct from v_snapshot then
      raise exception 'atlas_civic_genome_snapshot_identity_collision';
    end if;
    return jsonb_build_object(
      'status','idempotent',
      'source_snapshot_id',v_existing.source_snapshot_id,
      'source_snapshot_hash',v_existing.source_snapshot_hash,
      'atlas_binding_hash',v_existing.atlas_binding_hash,
      'received_at',v_existing.received_at
    );
  end if;

  insert into atlas.civic_genome_external_snapshot (
    source_snapshot_id, source_snapshot_hash, source_schema_id,
    source_contract_id, source_contract_version, source_owner, snapshot_kind,
    source_as_of, methodology_version, scope_json, component_count,
    completeness_state, unresolved_conditions, excluded_component_types,
    source_export_receipt_id, source_export_receipt_hash, deterministic_replay_key,
    source_commit_sha, snapshot_json, atlas_binding_hash, delivery_key_id,
    delivery_receipt_hash
  ) values (
    v_snapshot_id,
    v_snapshot_hash,
    p_record->>'source_schema_id',
    v_snapshot->>'contract_id',
    v_snapshot->>'contract_version',
    v_snapshot->>'canonical_owner',
    v_snapshot->>'snapshot_kind',
    (v_snapshot->>'as_of')::timestamptz,
    v_snapshot->>'methodology_version',
    v_snapshot->'scope',
    v_component_count,
    v_snapshot->>'completeness_state',
    coalesce(v_snapshot->'unresolved_conditions','[]'::jsonb),
    coalesce(v_snapshot->'excluded_component_types','[]'::jsonb),
    v_snapshot->'export_receipt'->>'export_receipt_id',
    v_snapshot->'export_receipt'->>'export_receipt_hash',
    v_snapshot->'export_receipt'->>'deterministic_replay_key',
    nullif(v_snapshot->'export_receipt'->>'source_commit_sha',''),
    v_snapshot,
    p_record->>'atlas_binding_hash',
    p_record->>'delivery_key_id',
    p_record->>'delivery_receipt_hash'
  );

  return jsonb_build_object(
    'status','inserted',
    'source_snapshot_id',v_snapshot_id,
    'source_snapshot_hash',v_snapshot_hash,
    'atlas_binding_hash',p_record->>'atlas_binding_hash'
  );
end;
$$;

revoke all on function public.atlas_civic_genome_snapshot_persist_v1(jsonb) from public, anon, authenticated;
grant execute on function public.atlas_civic_genome_snapshot_persist_v1(jsonb) to service_role;

-- Register the external snapshot as a canonical Atlas source/adapter binding.
insert into public.schema_registry (
  name, version, target_table, source_type, field_mappings,
  validation_rules, transform_logic, entity_extraction_config,
  signal_generation_config, active
) values (
  'civic_genome_external_snapshot', '1.0', 'atlas.civic_genome_external_snapshot',
  'governed_external_snapshot',
  '{"contract":"civic_genome.external_snapshot.v1","ownership":"lighthouse/civic_genome"}'::jsonb,
  '{"immutable":true,"component_hash_required":true,"snapshot_hash_required":true,"source_native_verification_preserved":true}'::jsonb,
  '{"mode":"no_mutation_source_binding"}'::jsonb,
  '{"mode":"component_identity_only_until_declared_adapter_mapping"}'::jsonb,
  '{"mode":"disabled_until_legislative_module_mapping_declared"}'::jsonb,
  true
)
on conflict (name, version) do update set
  target_table=excluded.target_table,
  source_type=excluded.source_type,
  field_mappings=excluded.field_mappings,
  validation_rules=excluded.validation_rules,
  transform_logic=excluded.transform_logic,
  entity_extraction_config=excluded.entity_extraction_config,
  signal_generation_config=excluded.signal_generation_config,
  active=true,
  updated_at=now();

insert into public.connector_registry (
  name, api_base_url, adapter_class, auth_type, auth_config,
  rate_limit_rpm, pagination_type, pagination_config,
  schedule_cron, jurisdiction_filter, schema_id, active
)
select
  'lighthouse_civic_genome_snapshot',
  'https://lighthouse.columbiacitycustomllc.com',
  'civicGenomeExternalSnapshotAdapter',
  'hmac_sha256',
  '{"transport":"push","receiver_path":"/v1/civic-genome/snapshots","secret_storage":"environment_only"}'::jsonb,
  60,
  'none',
  '{}'::jsonb,
  null,
  '{"scope":"governed_by_snapshot"}'::jsonb,
  schema_row.id,
  true
from public.schema_registry schema_row
where schema_row.name='civic_genome_external_snapshot' and schema_row.version='1.0'
on conflict (name) do update set
  api_base_url=excluded.api_base_url,
  adapter_class=excluded.adapter_class,
  auth_type=excluded.auth_type,
  auth_config=excluded.auth_config,
  pagination_type=excluded.pagination_type,
  pagination_config=excluded.pagination_config,
  schema_id=excluded.schema_id,
  active=true,
  updated_at=now();

commit;
