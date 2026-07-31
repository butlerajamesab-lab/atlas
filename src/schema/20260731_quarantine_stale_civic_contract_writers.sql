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
