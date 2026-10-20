-- Atlas read-model timeout remedy (2026-10-19).
-- Non-destructive replacement based on the currently installed view definition.
-- Aggregate each event once across streams instead of rescanning signal_events
-- for each stream in a LATERAL subquery. The 16 existing columns, types,
-- zero-event stream semantics, ordering contract and security remain unchanged.
-- This view is still live, not a stale snapshot. No tables or records touched.
begin;

create or replace view public.v_atlas_stream_runtime_summary_v1
with (security_invoker = true)
as
select
  stream.stream_id,
  stream.source_id,
  stream.jurisdiction_id,
  stream.module_hint,
  stream.throughput_profile,
  stream.safety_profile,
  stream.governance_contract_id,
  stream.status,
  stream.created_at,
  stream.updated_at,
  coalesce(event_summary.event_count, 0::bigint) as event_count,
  coalesce(event_summary.identity_count, 0::bigint) as identity_count,
  coalesce(event_summary.signal_type_count, 0::bigint) as signal_type_count,
  event_summary.first_event_at,
  event_summary.latest_event_at,
  event_summary.latest_ingested_at
from public.streams as stream
left join (
  select
    event.stream_id,
    count(*)::bigint as event_count,
    count(event.event_identity_hash)::bigint as identity_count,
    count(distinct event.signal_type)::bigint as signal_type_count,
    min(event."timestamp") as first_event_at,
    max(event."timestamp") as latest_event_at,
    max(event.ingested_at) as latest_ingested_at
  from public.signal_events as event
  group by event.stream_id
) as event_summary on event_summary.stream_id = stream.stream_id;

revoke all on public.v_atlas_stream_runtime_summary_v1 from public, anon, authenticated;
grant select on public.v_atlas_stream_runtime_summary_v1 to service_role;

commit;
