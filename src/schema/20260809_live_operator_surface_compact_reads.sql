-- Compact service-role read models for the Atlas UI.
-- These preserve the same bounded fields while reducing Render-to-Supabase
-- round trips on mobile page loads.

create or replace view public.v_atlas_ui_overview_v2
with (security_invoker = true)
as
select
  now() as observed_at,
  coalesce(
    (select jsonb_agg(to_jsonb(stream_row) order by stream_row.stream_id)
       from public.v_atlas_stream_runtime_summary_v1 as stream_row),
    '[]'::jsonb
  ) as streams,
  coalesce(
    (select jsonb_agg(to_jsonb(source_row) order by source_row.source_name)
       from public.v_atlas_source_operational_readiness_v1 as source_row),
    '[]'::jsonb
  ) as sources,
  (select to_jsonb(substrate_row)
     from public.v_atlas_signal_substrate_summary_v1 as substrate_row) as substrate;

create or replace view public.v_atlas_ui_signal_substrate_v2
with (security_invoker = true)
as
select
  now() as observed_at,
  (select to_jsonb(substrate_row)
     from public.v_atlas_signal_substrate_summary_v1 as substrate_row) as summary,
  coalesce(
    (select jsonb_agg(to_jsonb(type_row) order by type_row.event_count desc, type_row.stream_id, type_row.signal_type)
       from (
         select *
         from public.v_atlas_signal_type_summary_v1
         order by event_count desc, stream_id, signal_type
         limit 250
       ) as type_row),
    '[]'::jsonb
  ) as signal_types;

revoke all on public.v_atlas_ui_overview_v2 from public, anon, authenticated;
revoke all on public.v_atlas_ui_signal_substrate_v2 from public, anon, authenticated;
grant select on public.v_atlas_ui_overview_v2 to service_role;
grant select on public.v_atlas_ui_signal_substrate_v2 to service_role;
