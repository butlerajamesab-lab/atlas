-- Keep Atlas's service-only stream/runtime projection inside the PostgREST
-- statement budget. The signal-event heap contains large evidence payloads;
-- this covering index and per-stream lateral aggregate avoid repeatedly
-- grouping and sorting those payload-bearing rows.

create index if not exists idx_signal_events_runtime_summary_v1
  on public.signal_events (
    stream_id,
    signal_type,
    "timestamp",
    ingested_at
  )
  include (event_identity_hash);

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
  event_summary.event_count,
  event_summary.identity_count,
  event_summary.signal_type_count,
  event_summary.first_event_at,
  event_summary.latest_event_at,
  event_summary.latest_ingested_at
from public.streams as stream
cross join lateral (
  select
    count(*)::bigint as event_count,
    count(event.event_identity_hash)::bigint as identity_count,
    count(distinct event.signal_type)::bigint as signal_type_count,
    min(event.timestamp) as first_event_at,
    max(event.timestamp) as latest_event_at,
    max(event.ingested_at) as latest_ingested_at
  from public.signal_events as event
  where event.stream_id = stream.stream_id
) as event_summary;

revoke all on public.v_atlas_stream_runtime_summary_v1
  from public, anon, authenticated;
grant select on public.v_atlas_stream_runtime_summary_v1
  to service_role;
