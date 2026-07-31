-- Quarantine stale cross-service writers whose target contracts no longer
-- match Rosetta, Prism, or Lighthouse.
--
-- Preserve atlas.bridge_emit_signal_v1() and its active trigger.

revoke execute on function atlas.bridge_push_to_prism(
  text, text, text, text, text, jsonb, text, text, text, text
) from public, authenticated;

revoke execute on function atlas.bridge_escalate_convergence(uuid)
  from public, authenticated;

revoke execute on function atlas.bridge_escalate_detection_rule(
  character varying, text[], jsonb
) from public, authenticated;

revoke execute on function atlas.bridge_sync_to_rosetta(
  character varying, integer
) from public, authenticated;

revoke execute on function atlas.bridge_push_signal_to_lighthouse()
  from public;
revoke execute on function atlas.bridge_push_signal_to_lighthouse(bigint)
  from public;
revoke execute on function atlas.bridge_process_queue_v3(integer)
  from public;

-- The active prime-pattern RPC is SECURITY DEFINER and therefore invokes the
-- queue processor as its postgres owner. Replace that retired processor with a
-- deterministic no-op so the RPC can continue inserting Atlas-owned signals;
-- the canonical bridge_emit_signal_v1() trigger remains the only emitter.
alter table atlas.civic_map_signals
  disable trigger trg_queue_bridge_v3;

create or replace function atlas.bridge_process_queue_v3(
  p_batch_size integer default 10
)
returns jsonb
language sql
security invoker
set search_path to 'pg_catalog', 'atlas'
as $function$
  select jsonb_build_object(
    'processed', 0,
    'results', '[]'::jsonb,
    'processed_at', clock_timestamp(),
    'quarantined', true,
    'reason', 'legacy_lighthouse_queue_contract_disabled'
  );
$function$;

revoke all on function atlas.bridge_process_queue_v3(integer)
  from public, anon, authenticated, service_role;

revoke execute on function atlas.bridge_sync_all_to_lighthouse_v3()
  from public, anon, authenticated, service_role;

revoke all on function public.trigger_lighthouse_bridge_for_prime_pattern_v1(
  jsonb, jsonb, boolean
) from public, anon, authenticated;
grant execute on function public.trigger_lighthouse_bridge_for_prime_pattern_v1(
  jsonb, jsonb, boolean
) to service_role;
