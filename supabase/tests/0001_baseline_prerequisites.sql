begin;

select plan(54);

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
select is(
  (
    select count(*)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('atlas', 'public', 'private') and c.relkind in ('r', 'p')
  ),
  114::bigint,
  'candidate contains all 114 captured application tables'
);
select is(
  (
    select count(*)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('atlas', 'public', 'private') and c.relkind = 'v'
  ),
  61::bigint,
  'candidate contains all 61 captured application views'
);
select is(
  (
    select count(*)
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('atlas', 'public', 'private')
      and c.relkind in ('r', 'p', 'v')
      and a.attnum > 0
      and not a.attisdropped
  ),
  2514::bigint,
  'candidate contains all 2,514 captured application columns'
);
select is(
  (
    select count(*)
    from pg_constraint con
    join pg_namespace n on n.oid = con.connamespace
    where n.nspname in ('atlas', 'public', 'private')
  ),
  425::bigint,
  'candidate contains all 425 captured application constraints'
);
select is(
  (
    select count(*)
    from pg_index i
    join pg_class idx on idx.oid = i.indexrelid
    join pg_namespace n on n.oid = idx.relnamespace
    where n.nspname in ('atlas', 'public', 'private')
  ),
  451::bigint,
  'candidate contains all 451 captured application indexes'
);
select is(
  (
    select count(*)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('atlas', 'public', 'private') and c.relkind = 'S'
  ),
  34::bigint,
  'candidate contains all 34 captured application sequences'
);
select is(
  (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('atlas', 'public', 'private')
  ),
  78::bigint,
  'candidate contains 78 application functions after intentional exclusions'
);
select is(
  (
    select count(*)
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('atlas', 'public', 'private') and not t.tgisinternal
  ),
  16::bigint,
  'candidate contains 16 application triggers after intentional exclusions'
);
select is(
  (
    select count(*)
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('atlas', 'public', 'private')
  ),
  45::bigint,
  'candidate contains all 45 captured RLS policies'
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
  not exists (select 1 from private.lighthouse_stream_export_allowlist),
  'isolated replay contains no production Lighthouse allowlist rows'
);
select ok(
  not has_schema_privilege('anon', 'atlas', 'USAGE')
    and not has_schema_privilege('authenticated', 'atlas', 'USAGE'),
  'anonymous and authenticated roles cannot use the Atlas schema'
);
select ok(
  has_schema_privilege('service_role', 'atlas', 'USAGE'),
  'service_role retains Atlas schema usage'
);
select ok(
  not exists (
    select 1
    from pg_default_acl d
    join pg_roles owner_role on owner_role.oid = d.defaclrole
    join pg_namespace n on n.oid = d.defaclnamespace
    cross join lateral aclexplode(d.defaclacl) acl
    where owner_role.rolname = 'postgres'
      and n.nspname in ('atlas', 'public', 'private')
      and d.defaclobjtype in ('r', 'S', 'f')
      and acl.grantee in (
        0,
        (select oid from pg_roles where rolname = 'anon'),
        (select oid from pg_roles where rolname = 'authenticated')
      )
  ),
  'future postgres-owned application objects do not default open to public roles'
);
select is(
  (
    select count(distinct n.nspname || ':' || d.defaclobjtype)
    from pg_default_acl d
    join pg_roles owner_role on owner_role.oid = d.defaclrole
    join pg_namespace n on n.oid = d.defaclnamespace
    cross join lateral aclexplode(d.defaclacl) acl
    where owner_role.rolname = 'postgres'
      and n.nspname in ('atlas', 'public', 'private')
      and d.defaclobjtype in ('r', 'S', 'f')
      and acl.grantee = (select oid from pg_roles where rolname = 'service_role')
  ),
  9::bigint,
  'future postgres-owned objects in all three schemas grant service_role access'
);
select ok(
  not has_table_privilege('anon', 'public.v_bridge_operational_status', 'SELECT')
    and not has_table_privilege('authenticated', 'public.v_bridge_operational_status', 'SELECT'),
  'bridge operational status is not exposed to anon or authenticated roles'
);
select ok(
  has_table_privilege('service_role', 'public.v_bridge_operational_status', 'SELECT')
    and has_table_privilege('service_role', 'atlas.v_bridge_operational_status', 'SELECT'),
  'service_role can traverse the public and Atlas bridge operational views'
);
select ok(
  not has_function_privilege('anon', 'atlas.bridge_sync_to_lighthouse(bigint,integer)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'atlas.bridge_sync_to_lighthouse(bigint,integer)', 'EXECUTE')
    and not has_function_privilege('anon', 'atlas.log_provenance()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'atlas.log_provenance()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.get_lighthouse_signal_events(text,bigint,integer)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.get_lighthouse_signal_events(text,bigint,integer)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.get_lighthouse_stream_definition(text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.get_lighthouse_stream_definition(text)', 'EXECUTE'),
  'four sensitive bridge and export functions reject anon and authenticated execution'
);
select ok(
  has_function_privilege('service_role', 'atlas.bridge_sync_to_lighthouse(bigint,integer)', 'EXECUTE')
    and has_function_privilege('service_role', 'atlas.log_provenance()', 'EXECUTE')
    and has_function_privilege('service_role', 'public.get_lighthouse_signal_events(text,bigint,integer)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.get_lighthouse_stream_definition(text)', 'EXECUTE'),
  'service_role retains the four reviewed bridge and export functions'
);
select ok(
  to_regprocedure('atlas.compute_entity_risk_tier(character varying)') is null
    and to_regprocedure('atlas.bridge_emit_signal_v1()') is null
    and to_regprocedure('atlas.bridge_push_action_to_lighthouse()') is null
    and to_regprocedure('atlas.bridge_push_resources_to_lighthouse()') is null
    and to_regprocedure('atlas.bridge_rebuild_map_pins()') is null
    and to_regprocedure('atlas.bridge_sync_all_to_lighthouse()') is null
    and to_regprocedure('public.get_connector_status(text)') is null
    and to_regprocedure('atlas.bridge_push_to_prism(text,text,text,text,text,jsonb,text,text,text,text)') is null
    and to_regprocedure('atlas.bridge_escalate_convergence(uuid)') is null
    and to_regprocedure('atlas.bridge_escalate_detection_rule(character varying,text[],jsonb)') is null
    and to_regprocedure('atlas.bridge_sync_to_rosetta(character varying,integer)') is null
    and to_regprocedure('atlas.bridge_push_signal_to_lighthouse()') is null
    and to_regprocedure('atlas.bridge_push_signal_to_lighthouse(bigint)') is null
    and to_regprocedure('atlas.bridge_sync_all_to_lighthouse_v3()') is null
    and to_regprocedure('atlas.trigger_queue_pdf_extraction()') is null
    and to_regprocedure('public.trigger_lighthouse_bridge_for_prime_pattern_v1(jsonb,jsonb,boolean)') is null,
  'retired cross-service writers are not resurrected by the baseline'
);
select ok(
  not exists (
    select 1
    from pg_trigger
    where tgname in (
      'trg_queue_bridge_v3',
      'trg_bridge_action',
      'trg_bridge_emit_signal_v1'
    )
      and not tgisinternal
      and tgenabled <> 'D'
  ),
  'retired queue, action, and signal bridge triggers are absent or disabled'
);
select ok(
  not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'atlas'
      and c.relname = 'entity_registry'
      and t.tgname = 'trg_bridge_entity'
      and not t.tgisinternal
  ),
  'retired entity bridge trigger is absent'
);
select is(
  (
    select array_agg(format('%I.%I', schemaname, tablename) order by schemaname, tablename)
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'atlas'
  ),
  array[
    'atlas.atlas_case_links',
    'atlas.convergence_events',
    'atlas.corruption_indicators',
    'atlas.signals'
  ]::text[],
  'Supabase Realtime publishes only the four captured Atlas relations'
);

select * from finish();

rollback;
