begin;

select plan(34);

select ok(
  current_setting('server_version_num')::integer / 10000 = 17,
  'replay target is PostgreSQL 17'
);
select ok(to_regclass(relation_name) is not null, relation_name || ' exists')
from (
  values
    ('public.jurisdictions'),
    ('public.agency_metrics'),
    ('public.civic_infrastructure_nodes'),
    ('atlas.geography_registry'),
    ('atlas.civic_map_signals'),
    ('atlas.equations'),
    ('atlas.signal_types'),
    ('atlas.signals'),
    ('public.streams'),
    ('public.signal_events'),
    ('atlas.entity_registry'),
    ('atlas.entity_aliases'),
    ('atlas.bridge_config'),
    ('public.schema_registry'),
    ('public.connector_registry'),
    ('public.ingest_jobs'),
    ('public.cursors'),
    ('public.investigative_jobs'),
    ('public.prime_patterns'),
    ('atlas.signal_extractions'),
    ('atlas.convergence_patterns'),
    ('atlas.convergence_events')
) as required_relations(relation_name);
select ok(
  exists (select 1 from pg_extension where extname = 'pgcrypto'),
  'pgcrypto is installed'
);
select ok(
  exists (select 1 from pg_extension where extname = 'http'),
  'http is installed'
);
select ok(
  exists (select 1 from pg_extension where extname = 'pg_net'),
  'pg_net is installed'
);
select ok(
  to_regprocedure('public.set_updated_at()') is not null,
  'public.set_updated_at() exists'
);
select ok(
  to_regprocedure('public.atlas_bridge_config_for(text)') is not null,
  'public.atlas_bridge_config_for(text) exists'
);
select ok(
  coalesce(
    (
      select c.relrowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'jurisdictions'
    ),
    false
  ),
  'public.jurisdictions has RLS enabled'
);
select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'jurisdictions'
      and 'anon' = any (roles)
      and cmd = 'SELECT'
  ),
  'public.jurisdictions has an anon SELECT policy'
);
select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'jurisdictions'
      and 'service_role' = any (roles)
      and cmd = 'ALL'
  ),
  'public.jurisdictions has a service_role ALL policy'
);
select ok(
  not exists (select 1 from atlas.bridge_config),
  'isolated replay contains no production bridge configuration or secrets'
);
select ok(
  to_regprocedure('atlas.bridge_push_to_prism(text,text,text,text,text,jsonb,text,text,text,text)') is null
    and to_regprocedure('atlas.bridge_escalate_convergence(uuid)') is null
    and to_regprocedure('atlas.bridge_escalate_detection_rule(character varying,text[],jsonb)') is null
    and to_regprocedure('atlas.bridge_sync_to_rosetta(character varying,integer)') is null
    and to_regprocedure('atlas.bridge_push_signal_to_lighthouse()') is null
    and to_regprocedure('atlas.bridge_push_signal_to_lighthouse(bigint)') is null
    and to_regprocedure('atlas.bridge_sync_all_to_lighthouse_v3()') is null
    and to_regprocedure('public.trigger_lighthouse_bridge_for_prime_pattern_v1(jsonb,jsonb,boolean)') is null,
  'retired cross-service writers are not resurrected by the baseline'
);
select ok(
  not exists (
    select 1
    from pg_trigger
    where tgname = 'trg_queue_bridge_v3'
      and not tgisinternal
      and tgenabled <> 'D'
  ),
  'retired queue bridge trigger is absent or disabled'
);

select * from finish();

rollback;
