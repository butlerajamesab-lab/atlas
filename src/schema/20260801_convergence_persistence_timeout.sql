-- The governed convergence persistence bundle contains the complete canonical
-- source, transformed, and deduplicated populations. Production acceptance
-- currently persists approximately 50 MB atomically. Raise the timeout only
-- for this single SECURITY DEFINER RPC; all other project statements retain
-- their existing limits.

alter function public.atlas_convergence_persist_run_v1(jsonb)
  set statement_timeout = '120s';

comment on function public.atlas_convergence_persist_run_v1(jsonb) is
  'Atomically persists Atlas v2.1 convergence manifests, immutable population snapshots, per-geography receipts, and complete output payloads. Function-local statement timeout: 120 seconds.';
