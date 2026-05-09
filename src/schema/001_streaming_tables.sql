-- Atlas Streaming Engine schema
-- Project ref: bjdjjgnkhxblnpdrjqtw

create extension if not exists pgcrypto;

create table if not exists public.streams (
  stream_id text primary key,
  source_id text not null,
  jurisdiction_id text not null,
  module_hint text not null,
  throughput_profile text not null check (throughput_profile in ('low', 'medium', 'high', 'ultra')),
  safety_profile text not null check (safety_profile in ('default', 'restricted', 'critical')),
  governance_contract_id text not null,
  status text not null check (status in ('active', 'degraded', 'quarantined', 'paused')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.signal_events (
  stream_id text not null references public.streams(stream_id) on delete cascade,
  "offset" bigint not null,
  timestamp timestamptz not null,
  signal_type text not null,
  spacetime jsonb not null,
  provenance jsonb not null,
  payload jsonb not null default '{}'::jsonb,
  source_id text not null,
  jurisdiction_id text not null,
  module_hint text not null,
  ingested_at timestamptz not null default now(),
  primary key (stream_id, "offset"),
  constraint signal_events_spacetime_region check (spacetime ? 'region'),
  constraint signal_events_provenance_channel check (provenance ? 'channel'),
  constraint signal_events_provenance_confidence check (provenance ? 'confidence')
);

create table if not exists public.cursors (
  cursor_id text primary key,
  stream_id text not null references public.streams(stream_id) on delete cascade,
  name text not null,
  current_offset bigint not null default 0,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (stream_id, name)
);

create table if not exists public.investigative_jobs (
  job_id text primary key,
  job_type text not null check (job_type in ('stream_health', 'fraud_investigation', 'cross_correlation')),
  stream_id text null references public.streams(stream_id) on delete set null,
  cursor_id text null references public.cursors(cursor_id) on delete set null,
  status text not null check (status in ('pending', 'running', 'completed', 'failed')),
  params jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  error text null,
  function_id text null,
  created_at timestamptz not null default now(),
  completed_at timestamptz null
);

-- The OpenAPI references prime_pattern.json but the pasted schemas did not include it.
-- This table stores outputs emitted by investigative functions and supports the required filters.
create table if not exists public.prime_patterns (
  pattern_id text primary key,
  pattern_type text not null,
  module text not null,
  jurisdiction text not null,
  stream_id text null references public.streams(stream_id) on delete set null,
  job_id text null references public.investigative_jobs(job_id) on delete set null,
  confidence numeric not null default 0 check (confidence >= 0 and confidence <= 1),
  severity text not null default 'info' check (severity in ('info', 'low', 'medium', 'high', 'critical')),
  detected_at timestamptz not null default now(),
  summary text not null,
  evidence jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_signal_events_stream_offset on public.signal_events(stream_id, "offset");
create index if not exists idx_signal_events_stream_timestamp on public.signal_events(stream_id, timestamp);
create index if not exists idx_signal_events_source on public.signal_events(source_id, jurisdiction_id, module_hint);
create index if not exists idx_cursors_stream on public.cursors(stream_id);
create index if not exists idx_investigative_jobs_stream_created on public.investigative_jobs(stream_id, created_at desc);
create index if not exists idx_prime_patterns_filters on public.prime_patterns(module, jurisdiction, detected_at desc);
create index if not exists idx_prime_patterns_stream on public.prime_patterns(stream_id, detected_at desc);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_streams_updated_at on public.streams;
create trigger set_streams_updated_at
before update on public.streams
for each row execute function public.set_updated_at();

drop trigger if exists set_cursors_updated_at on public.cursors;
create trigger set_cursors_updated_at
before update on public.cursors
for each row execute function public.set_updated_at();

alter table public.streams enable row level security;
alter table public.signal_events enable row level security;
alter table public.cursors enable row level security;
alter table public.investigative_jobs enable row level security;
alter table public.prime_patterns enable row level security;

-- The local service uses the service-role key, which bypasses RLS. These policies allow optional authenticated reads.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'streams' and policyname = 'authenticated_read_streams') then
    create policy authenticated_read_streams on public.streams for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'signal_events' and policyname = 'authenticated_read_signal_events') then
    create policy authenticated_read_signal_events on public.signal_events for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'prime_patterns' and policyname = 'authenticated_read_prime_patterns') then
    create policy authenticated_read_prime_patterns on public.prime_patterns for select to authenticated using (true);
  end if;
end $$;
