begin;
set local lock_timeout = '1s';
set local statement_timeout = '5s';

-- Review #78 / 4307867471: a later correction keeps the job's observed_at.
-- Use its existing insertion timestamp before the random UUID tie-breaker.
-- Do not backfill, rewrite, or reconcile any historical receipt.
do $$
begin
  if md5(pg_get_viewdef('public.v_atlas_source_operational_readiness_v1'::regclass, true))
    <> 'a80f203c5e55e39b99fa3d6647bb44ef' then
    raise exception 'source_health_readiness_definition_changed';
  end if;
end;
$$;

create or replace view public.v_atlas_source_operational_readiness_v1
with (security_invoker = true) as
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
  order by h.connector_id, h.observed_at desc, h.created_at desc, h.health_event_id desc
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

-- CREATE OR REPLACE preserves the owner, columns and ACL. Keep the browser
-- boundary and invoker security explicit without introducing new grants.
do $$
begin
  if not ('security_invoker=true' = any (
    select unnest(reloptions) from pg_class
    where oid = 'public.v_atlas_source_operational_readiness_v1'::regclass
  )) or has_table_privilege('anon', 'public.v_atlas_source_operational_readiness_v1', 'SELECT')
     or has_table_privilege('authenticated', 'public.v_atlas_source_operational_readiness_v1', 'SELECT') then
    raise exception 'source_health_readiness_access_boundary_changed';
  end if;
end;
$$;
commit;
