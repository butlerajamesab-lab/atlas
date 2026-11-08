-- 2026-11-08 full-set replay correction: singleton state for the Domain 3
-- derivation watermark. The replay derives over the complete stored
-- population; when the reservoir watermark (per-stream event count + max
-- offset over identity-bound events), the rule-set hash, and the
-- derivation build all match the last fully successful derivation, the
-- cycle is a true no-op and derivation is skipped. The watermark stored
-- here is the one the last successful pass actually saw.
create table if not exists public.atlas_derivation_state (
  id boolean primary key default true check (id),
  watermark jsonb not null default '{}'::jsonb,
  rule_set_hash text,
  build text,
  last_run_ids uuid[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.atlas_derivation_state enable row level security;
-- No public policies: the service role (used by the Atlas runtime) bypasses
-- RLS; anon/authenticated get nothing.
