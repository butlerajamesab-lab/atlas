begin;

create schema if not exists atlas;

create table if not exists atlas.civic_genome_legislative_trait_binding_accounting (
  accounting_hash text primary key check (accounting_hash ~ '^[0-9a-f]{64}$'),
  accounting_rule_id text not null,
  accounting_rule_version text not null,
  accounting_rule_hash text not null check (accounting_rule_hash ~ '^[0-9a-f]{64}$'),
  projection_key text not null references atlas.civic_genome_legislative_projection_run(projection_key),
  source_snapshot_id text not null references atlas.civic_genome_external_snapshot(source_snapshot_id),
  source_snapshot_hash text not null check (source_snapshot_hash ~ '^[0-9a-f]{64}$'),
  total_trait_count integer not null check (total_trait_count >= 0),
  exact_version_bound_trait_count integer not null check (exact_version_bound_trait_count >= 0),
  historical_same_source_trait_count integer not null check (historical_same_source_trait_count >= 0),
  unresolved_trait_count integer not null check (unresolved_trait_count >= 0),
  completeness_state text not null check (completeness_state in ('complete','incomplete')),
  receipt_json jsonb not null,
  persisted_at timestamptz not null default now(),
  constraint civic_genome_trait_accounting_counts_match check (
    total_trait_count = exact_version_bound_trait_count + historical_same_source_trait_count + unresolved_trait_count
  ),
  unique (projection_key, accounting_rule_hash)
);

create or replace function atlas.prevent_civic_genome_trait_accounting_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, atlas
as $$
begin
  raise exception 'Atlas Civic Genome trait accounting receipts are immutable';
end;
$$;

drop trigger if exists civic_genome_trait_accounting_immutable
  on atlas.civic_genome_legislative_trait_binding_accounting;
create trigger civic_genome_trait_accounting_immutable
before update or delete on atlas.civic_genome_legislative_trait_binding_accounting
for each row execute function atlas.prevent_civic_genome_trait_accounting_mutation();

alter table atlas.civic_genome_legislative_trait_binding_accounting enable row level security;
alter table atlas.civic_genome_legislative_trait_binding_accounting force row level security;
revoke all privileges on atlas.civic_genome_legislative_trait_binding_accounting
  from public, anon, authenticated, service_role;

create or replace function public.atlas_civic_genome_legislative_trait_accounting_persist_v1(p_receipt jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, atlas
as $$
declare
  v_existing atlas.civic_genome_legislative_trait_binding_accounting%rowtype;
  v_projection atlas.civic_genome_legislative_projection_run%rowtype;
  v_source atlas.civic_genome_external_snapshot%rowtype;
  v_projection_key text := p_receipt->>'projection_key';
  v_snapshot_id text := p_receipt->>'source_snapshot_id';
  v_accounting_hash text := p_receipt->>'accounting_hash';
begin
  if v_accounting_hash !~ '^[0-9a-f]{64}$'
     or p_receipt->>'accounting_rule_hash' !~ '^[0-9a-f]{64}$'
     or p_receipt->>'source_snapshot_hash' !~ '^[0-9a-f]{64}$' then
    raise exception 'atlas_civic_genome_trait_accounting_hash_invalid';
  end if;
  if (p_receipt->>'total_trait_count')::integer
     <> (p_receipt->>'exact_version_bound_trait_count')::integer
      + (p_receipt->>'historical_same_source_trait_count')::integer
      + (p_receipt->>'unresolved_trait_count')::integer then
    raise exception 'atlas_civic_genome_trait_accounting_count_mismatch';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_projection_key || ':' || p_receipt->>'accounting_rule_hash',0));
  select * into v_existing
  from atlas.civic_genome_legislative_trait_binding_accounting
  where projection_key=v_projection_key
    and accounting_rule_hash=p_receipt->>'accounting_rule_hash';
  if found then
    if v_existing.accounting_hash is distinct from v_accounting_hash
       or v_existing.receipt_json is distinct from p_receipt then
      raise exception 'atlas_civic_genome_trait_accounting_identity_collision';
    end if;
    return jsonb_build_object(
      'status','idempotent',
      'accounting_hash',v_existing.accounting_hash,
      'projection_key',v_existing.projection_key,
      'total_trait_count',v_existing.total_trait_count,
      'exact_version_bound_trait_count',v_existing.exact_version_bound_trait_count,
      'historical_same_source_trait_count',v_existing.historical_same_source_trait_count,
      'unresolved_trait_count',v_existing.unresolved_trait_count,
      'completeness_state',v_existing.completeness_state,
      'persisted_at',v_existing.persisted_at
    );
  end if;

  select * into v_projection
  from atlas.civic_genome_legislative_projection_run
  where projection_key=v_projection_key;
  if not found or v_projection.source_snapshot_id is distinct from v_snapshot_id then
    raise exception 'atlas_civic_genome_trait_accounting_projection_mismatch';
  end if;
  select * into v_source
  from atlas.civic_genome_external_snapshot
  where source_snapshot_id=v_snapshot_id;
  if not found or v_source.source_snapshot_hash is distinct from p_receipt->>'source_snapshot_hash' then
    raise exception 'atlas_civic_genome_trait_accounting_source_mismatch';
  end if;

  insert into atlas.civic_genome_legislative_trait_binding_accounting (
    accounting_hash,accounting_rule_id,accounting_rule_version,accounting_rule_hash,
    projection_key,source_snapshot_id,source_snapshot_hash,total_trait_count,
    exact_version_bound_trait_count,historical_same_source_trait_count,
    unresolved_trait_count,completeness_state,receipt_json
  ) values (
    v_accounting_hash,
    p_receipt->'accounting_rule'->>'rule_id',
    p_receipt->'accounting_rule'->>'rule_version',
    p_receipt->>'accounting_rule_hash',
    v_projection_key,v_snapshot_id,p_receipt->>'source_snapshot_hash',
    (p_receipt->>'total_trait_count')::integer,
    (p_receipt->>'exact_version_bound_trait_count')::integer,
    (p_receipt->>'historical_same_source_trait_count')::integer,
    (p_receipt->>'unresolved_trait_count')::integer,
    p_receipt->>'completeness_state',p_receipt
  );

  return jsonb_build_object(
    'status','inserted',
    'accounting_hash',v_accounting_hash,
    'projection_key',v_projection_key,
    'total_trait_count',(p_receipt->>'total_trait_count')::integer,
    'exact_version_bound_trait_count',(p_receipt->>'exact_version_bound_trait_count')::integer,
    'historical_same_source_trait_count',(p_receipt->>'historical_same_source_trait_count')::integer,
    'unresolved_trait_count',(p_receipt->>'unresolved_trait_count')::integer,
    'completeness_state',p_receipt->>'completeness_state'
  );
end;
$$;

revoke all on function public.atlas_civic_genome_legislative_trait_accounting_persist_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.atlas_civic_genome_legislative_trait_accounting_persist_v1(jsonb)
  to service_role;

commit;
