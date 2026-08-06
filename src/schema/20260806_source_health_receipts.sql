begin;

create extension if not exists pgcrypto;

-- Extend the existing Atlas connector/schema authorities. Do not create a
-- second source registry or adapter registry.
create table if not exists public.atlas_source_health_event (
  health_event_id uuid primary key default gen_random_uuid(),
  connector_id uuid not null references public.connector_registry(id) on delete cascade,
  schema_id uuid references public.schema_registry(id) on delete set null,
  observed_at timestamptz not null,
  health_status text not null check (health_status in (
    'healthy', 'degraded', 'failing', 'paused', 'retired', 'unknown'
  )),
  freshness_status text not null check (freshness_status in (
    'fresh', 'stale', 'delayed', 'unknown'
  )),
  schema_status text not null check (schema_status in (
    'stable', 'changed', 'breaking_change', 'unknown'
  )),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  error_rate numeric(7,6) check (error_rate is null or (error_rate >= 0 and error_rate <= 1)),
  duplicate_rate numeric(7,6) check (duplicate_rate is null or (duplicate_rate >= 0 and duplicate_rate <= 1)),
  missing_required_field_rate numeric(7,6) check (
    missing_required_field_rate is null
    or (missing_required_field_rate >= 0 and missing_required_field_rate <= 1)
  ),
  records_observed integer check (records_observed is null or records_observed >= 0),
  source_state_hash text not null check (source_state_hash ~ '^[0-9a-f]{64}$'),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint atlas_source_health_event_identity_unique
    unique (connector_id, observed_at, source_state_hash)
);

create index if not exists idx_atlas_source_health_event_connector_observed
  on public.atlas_source_health_event(connector_id, observed_at desc);
create index if not exists idx_atlas_source_health_event_status
  on public.atlas_source_health_event(health_status, freshness_status, schema_status, observed_at desc);

create table if not exists public.atlas_source_schema_snapshot (
  schema_snapshot_id uuid primary key default gen_random_uuid(),
  connector_id uuid not null references public.connector_registry(id) on delete cascade,
  schema_id uuid references public.schema_registry(id) on delete set null,
  captured_at timestamptz not null,
  schema_version text,
  schema_hash text not null check (schema_hash ~ '^[0-9a-f]{64}$'),
  schema_payload jsonb not null,
  detected_change_type text not null check (detected_change_type in (
    'initial', 'none', 'additive', 'changed', 'breaking_change', 'unknown'
  )),
  created_at timestamptz not null default now(),
  constraint atlas_source_schema_snapshot_identity_unique
    unique (connector_id, schema_hash)
);

create index if not exists idx_atlas_source_schema_snapshot_connector_captured
  on public.atlas_source_schema_snapshot(connector_id, captured_at desc);

create table if not exists public.atlas_source_fallback_binding (
  connector_id uuid not null references public.connector_registry(id) on delete cascade,
  fallback_connector_id uuid not null references public.connector_registry(id) on delete cascade,
  fallback_priority integer not null check (fallback_priority > 0),
  fallback_reason text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (connector_id, fallback_connector_id),
  constraint atlas_source_fallback_not_self check (connector_id <> fallback_connector_id)
);

create unique index if not exists idx_atlas_source_fallback_active_priority
  on public.atlas_source_fallback_binding(connector_id, fallback_priority)
  where active;

create or replace function public.atlas_set_source_fallback_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists atlas_source_fallback_updated_at on public.atlas_source_fallback_binding;
create trigger atlas_source_fallback_updated_at
before update on public.atlas_source_fallback_binding
for each row execute function public.atlas_set_source_fallback_updated_at();

-- The readiness view does not invent a weighted score. It exposes a conservative
-- deterministic operational state from declared current registry state and the
-- latest observed health receipt.
create or replace view public.v_atlas_source_operational_readiness_v1 as
with latest_health as (
  select distinct on (h.connector_id)
    h.connector_id,
    h.health_event_id,
    h.observed_at as health_observed_at,
    h.health_status,
    h.freshness_status,
    h.schema_status,
    h.latency_ms,
    h.error_rate,
    h.duplicate_rate,
    h.missing_required_field_rate,
    h.records_observed,
    h.source_state_hash
  from public.atlas_source_health_event h
  order by h.connector_id, h.observed_at desc, h.health_event_id desc
), latest_job as (
  select distinct on (j.connector_id)
    j.connector_id,
    j.id as ingest_job_id,
    j.status as ingest_status,
    j.started_at as ingest_started_at,
    j.completed_at as ingest_completed_at,
    j.records_fetched,
    j.records_inserted,
    j.records_updated,
    j.records_failed,
    j.records_deduplicated
  from public.ingest_jobs j
  order by j.connector_id, j.started_at desc nulls last, j.id desc
), fallback_counts as (
  select f.connector_id, count(*) filter (where f.active) as active_fallback_count
  from public.atlas_source_fallback_binding f
  group by f.connector_id
)
select
  c.id as connector_id,
  c.name as source_name,
  c.adapter_class,
  c.active as connector_active,
  c.last_run_at,
  c.next_run_at,
  s.id as schema_id,
  s.name as schema_name,
  s.version as schema_version,
  s.active as schema_active,
  h.health_event_id,
  h.health_observed_at,
  h.health_status,
  h.freshness_status,
  h.schema_status,
  h.latency_ms,
  h.error_rate,
  h.duplicate_rate,
  h.missing_required_field_rate,
  h.records_observed,
  h.source_state_hash,
  j.ingest_job_id,
  j.ingest_status,
  j.ingest_started_at,
  j.ingest_completed_at,
  j.records_fetched,
  j.records_inserted,
  j.records_updated,
  j.records_failed,
  j.records_deduplicated,
  coalesce(f.active_fallback_count, 0) as active_fallback_count,
  case
    when not c.active or not coalesce(s.active, false) then 'not_active'
    when h.health_event_id is null then 'unknown'
    when h.health_status in ('failing', 'paused', 'retired') then 'blocked'
    when h.schema_status = 'breaking_change' then 'blocked'
    when h.health_status = 'healthy'
      and h.freshness_status = 'fresh'
      and h.schema_status = 'stable' then 'ready'
    else 'degraded'
  end as operational_readiness_state
from public.connector_registry c
left join public.schema_registry s on s.id = c.schema_id
left join latest_health h on h.connector_id = c.id
left join latest_job j on j.connector_id = c.id
left join fallback_counts f on f.connector_id = c.id;

alter table public.atlas_source_health_event enable row level security;
alter table public.atlas_source_health_event force row level security;
alter table public.atlas_source_schema_snapshot enable row level security;
alter table public.atlas_source_schema_snapshot force row level security;
alter table public.atlas_source_fallback_binding enable row level security;
alter table public.atlas_source_fallback_binding force row level security;

revoke all on public.atlas_source_health_event from anon, authenticated;
revoke all on public.atlas_source_schema_snapshot from anon, authenticated;
revoke all on public.atlas_source_fallback_binding from anon, authenticated;

-- Existing Atlas service-role operations may write these tables. Browser roles
-- cannot. No new public write path is introduced.
grant select, insert on public.atlas_source_health_event to service_role;
grant select, insert on public.atlas_source_schema_snapshot to service_role;
grant select, insert, update on public.atlas_source_fallback_binding to service_role;
grant select on public.v_atlas_source_operational_readiness_v1 to service_role;

commit;
