-- Atlas live operator surface
-- Project ref: bjdjjgnkhxblnpdrjqtw
--
-- This migration adds service-role-only action receipts and aggregate read
-- models. It does not expose signal payloads or operator controls through the
-- Supabase Data API.

create table if not exists public.atlas_action_receipt (
  action_receipt_hash text primary key,
  action_type text not null,
  initiator text not null check (initiator in ('scheduler', 'operator', 'system')),
  target_id text,
  requested_at timestamptz not null,
  completed_at timestamptz not null,
  outcome_status text not null check (outcome_status in ('completed', 'failed', 'skipped')),
  before_event_count bigint,
  after_event_count bigint,
  event_delta bigint,
  request_json jsonb not null default '{}'::jsonb,
  result_json jsonb not null default '{}'::jsonb,
  engine_version text not null,
  created_at timestamptz not null default now(),
  constraint atlas_action_receipt_hash_format
    check (action_receipt_hash ~ '^[0-9a-f]{64}$'),
  constraint atlas_action_receipt_time_order
    check (completed_at >= requested_at),
  constraint atlas_action_receipt_event_delta
    check (
      (before_event_count is null and after_event_count is null and event_delta is null)
      or
      (before_event_count is not null and after_event_count is not null and event_delta = after_event_count - before_event_count)
    )
);

create index if not exists idx_atlas_action_receipt_recent
  on public.atlas_action_receipt (completed_at desc, action_type, target_id);

alter table public.atlas_action_receipt enable row level security;
alter table public.atlas_action_receipt force row level security;
revoke all on public.atlas_action_receipt from public, anon, authenticated;
grant select, insert on public.atlas_action_receipt to service_role;
drop policy if exists atlas_action_receipt_service_role_all on public.atlas_action_receipt;
create policy atlas_action_receipt_service_role_all
  on public.atlas_action_receipt
  for all
  to service_role
  using (true)
  with check (true);

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
  count(event.*)::bigint as event_count,
  count(event.event_identity_hash)::bigint as identity_count,
  count(distinct event.signal_type)::bigint as signal_type_count,
  min(event.timestamp) as first_event_at,
  max(event.timestamp) as latest_event_at,
  max(event.ingested_at) as latest_ingested_at
from public.streams as stream
left join public.signal_events as event
  on event.stream_id = stream.stream_id
group by
  stream.stream_id,
  stream.source_id,
  stream.jurisdiction_id,
  stream.module_hint,
  stream.throughput_profile,
  stream.safety_profile,
  stream.governance_contract_id,
  stream.status,
  stream.created_at,
  stream.updated_at;

create or replace view public.v_atlas_signal_type_summary_v1
with (security_invoker = true)
as
select
  event.stream_id,
  event.signal_type,
  event.module_hint,
  event.jurisdiction_id,
  count(*)::bigint as event_count,
  count(event.event_identity_hash)::bigint as identity_count,
  min(event.timestamp) as first_event_at,
  max(event.timestamp) as latest_event_at,
  max(event.ingested_at) as latest_ingested_at
from public.signal_events as event
group by
  event.stream_id,
  event.signal_type,
  event.module_hint,
  event.jurisdiction_id;

create or replace view public.v_atlas_signal_substrate_summary_v1
with (security_invoker = true)
as
select
  (select count(*)::bigint from public.streams) as registered_streams,
  (select count(*)::bigint from public.streams where status = 'active') as active_streams,
  (select count(*)::bigint from public.signal_events) as signal_events,
  (select count(event_identity_hash)::bigint from public.signal_events) as identity_bound_events,
  (select count(distinct signal_type)::bigint from public.signal_events) as signal_types,
  (select count(distinct stream_id)::bigint from public.signal_events) as producing_streams,
  (select max(timestamp) from public.signal_events) as latest_signal_at,
  (select max(ingested_at) from public.signal_events) as latest_ingested_at,
  (select count(*)::bigint from public.prime_patterns) as prime_patterns,
  (select max(detected_at) from public.prime_patterns) as latest_pattern_at,
  (select count(*)::bigint from public.investigative_jobs) as investigative_jobs,
  (select count(*)::bigint from public.investigative_jobs where status = 'failed') as failed_investigative_jobs,
  (select count(*)::bigint from public.atlas_action_receipt) as action_receipts,
  now() as observed_at;

revoke all on public.v_atlas_stream_runtime_summary_v1 from public, anon, authenticated;
revoke all on public.v_atlas_signal_type_summary_v1 from public, anon, authenticated;
revoke all on public.v_atlas_signal_substrate_summary_v1 from public, anon, authenticated;
grant select on public.v_atlas_stream_runtime_summary_v1 to service_role;
grant select on public.v_atlas_signal_type_summary_v1 to service_role;
grant select on public.v_atlas_signal_substrate_summary_v1 to service_role;
