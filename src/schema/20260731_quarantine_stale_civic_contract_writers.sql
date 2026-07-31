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
create or replace function atlas.bridge_process_queue_v3(
  p_batch_size integer default 10
)
returns jsonb
language plpgsql
set search_path to 'pg_catalog', 'public', 'atlas'
as $function$
begin
  return jsonb_build_object(
    'processed', 0,
    'results', '[]'::jsonb,
    'retired', true,
    'reason', 'legacy_lighthouse_queue_retired',
    'requested_batch_size', p_batch_size,
    'processed_at', now()
  );
end;
$function$;

revoke execute on function atlas.bridge_sync_all_to_lighthouse_v3()
  from public, anon, authenticated, service_role;
