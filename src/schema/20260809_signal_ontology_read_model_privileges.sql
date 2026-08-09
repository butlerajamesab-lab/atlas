-- Complete the caller-secured Atlas signal ontology read model.
--
-- The v3 public-schema views use security_invoker=true. PostgREST therefore
-- evaluates their underlying atlas-schema reads with the service_role
-- privileges. Grant only the schema usage and table reads required by those
-- views; do not expose any of these relations to public, anon, or authenticated.

grant usage on schema atlas to service_role;

grant select on table
  atlas.signals,
  atlas.signal_types,
  atlas.signal_extractions,
  atlas.live_data_signal_candidate,
  atlas.live_data_signal_rule,
  atlas.convergence_run_manifest,
  atlas.convergence_receipt,
  atlas.convergence_events
to service_role;

revoke all on table
  atlas.signals,
  atlas.signal_types,
  atlas.signal_extractions,
  atlas.live_data_signal_candidate,
  atlas.live_data_signal_rule,
  atlas.convergence_run_manifest,
  atlas.convergence_receipt,
  atlas.convergence_events
from public, anon, authenticated;
