-- Atlas forward operational rebuild repair.
-- This is the only migration in this candidate that is not already present
-- in the 49-row production ledger. It remains unmerged and unapplied to
-- production until isolated replay, preview parity, advisors, and review pass.

set search_path = pg_catalog, public, extensions;

-- Remove captured triggers that invoke retired or invalid cross-service writers.
drop trigger if exists trg_bridge_action on atlas.action_queue;
drop trigger if exists trg_bridge_emit_signal_v1 on atlas.civic_map_signals;
drop trigger if exists trg_queue_bridge_v3 on atlas.civic_map_signals;
drop trigger if exists trg_bridge_entity on atlas.entity_registry;

-- Remove the retired/invalid functions without CASCADE; undeclared dependencies fail closed.
drop function if exists "atlas"."bridge_emit_signal_v1"();
drop function if exists "atlas"."bridge_escalate_convergence"(p_convergence_event_id uuid);
drop function if exists "atlas"."bridge_escalate_detection_rule"(p_rule_id character varying, p_matched_record_ids text[], p_additional_context jsonb);
drop function if exists "atlas"."bridge_push_action_to_lighthouse"();
drop function if exists "atlas"."bridge_push_resources_to_lighthouse"();
drop function if exists "atlas"."bridge_push_signal_to_lighthouse"();
drop function if exists "atlas"."bridge_push_signal_to_lighthouse"(p_queue_id bigint);
drop function if exists "atlas"."bridge_push_to_prism"(p_title text, p_description text, p_jurisdiction text, p_finding_summary text, p_finding_confidence text, p_finding_metadata jsonb, p_recommendation_action text, p_recommendation_summary text, p_source_table text, p_source_record_id text);
drop function if exists "atlas"."bridge_rebuild_map_pins"();
drop function if exists "atlas"."bridge_sync_all_to_lighthouse"();
drop function if exists "atlas"."bridge_sync_all_to_lighthouse_v3"();
drop function if exists "atlas"."bridge_sync_entity_to_lighthouse"();
drop function if exists "atlas"."bridge_sync_to_rosetta"(p_provider_id character varying, p_batch_size integer);
drop function if exists "atlas"."compute_entity_risk_tier"(p_entity_id character varying);
drop function if exists "atlas"."trigger_queue_bridge_v3"();
drop function if exists "atlas"."trigger_queue_pdf_extraction"();
drop function if exists "public"."get_connector_status"(connector_name text);
drop function if exists "public"."trigger_lighthouse_bridge_for_prime_pattern_v1"(p_signal jsonb, p_audit_context jsonb, p_process_queue boolean);

-- Apply reviewed namespace, RPC, operational-view, and future-object hardening.
revoke all on schema atlas from PUBLIC, anon, authenticated;
grant usage on schema atlas to service_role;
grant select on table atlas.v_bridge_operational_status to service_role;
revoke select on table public.v_bridge_operational_status from PUBLIC, anon, authenticated;
grant select on table public.v_bridge_operational_status to service_role;
alter default privileges for role postgres in schema atlas revoke execute on functions from PUBLIC, anon, authenticated;
alter default privileges for role postgres in schema atlas grant execute on functions to service_role;
alter default privileges for role postgres in schema atlas revoke all on tables from PUBLIC, anon, authenticated;
alter default privileges for role postgres in schema atlas grant select, insert, update, delete, truncate, references, trigger on tables to service_role;
alter default privileges for role postgres in schema atlas revoke all on sequences from PUBLIC, anon, authenticated;
alter default privileges for role postgres in schema atlas grant usage, select, update on sequences to service_role;
alter default privileges for role postgres in schema public revoke execute on functions from PUBLIC, anon, authenticated;
alter default privileges for role postgres in schema public grant execute on functions to service_role;
alter default privileges for role postgres in schema public revoke all on tables from PUBLIC, anon, authenticated;
alter default privileges for role postgres in schema public grant select, insert, update, delete, truncate, references, trigger on tables to service_role;
alter default privileges for role postgres in schema public revoke all on sequences from PUBLIC, anon, authenticated;
alter default privileges for role postgres in schema public grant usage, select, update on sequences to service_role;
alter default privileges for role postgres in schema private revoke execute on functions from PUBLIC, anon, authenticated;
alter default privileges for role postgres in schema private grant execute on functions to service_role;
alter default privileges for role postgres in schema private revoke all on tables from PUBLIC, anon, authenticated;
alter default privileges for role postgres in schema private grant select, insert, update, delete, truncate, references, trigger on tables to service_role;
alter default privileges for role postgres in schema private revoke all on sequences from PUBLIC, anon, authenticated;
alter default privileges for role postgres in schema private grant usage, select, update on sequences to service_role;
revoke all on function "atlas"."bridge_sync_to_lighthouse"(p_signal_id bigint, p_batch_size integer) from PUBLIC, anon, authenticated;
grant execute on function "atlas"."bridge_sync_to_lighthouse"(p_signal_id bigint, p_batch_size integer) to service_role;
revoke all on function "atlas"."log_provenance"() from PUBLIC, anon, authenticated;
grant execute on function "atlas"."log_provenance"() to service_role;
revoke all on function "public"."get_lighthouse_signal_events"(p_stream_id text, p_offset bigint, p_limit integer) from PUBLIC, anon, authenticated;
grant execute on function "public"."get_lighthouse_signal_events"(p_stream_id text, p_offset bigint, p_limit integer) to service_role;
revoke all on function "public"."get_lighthouse_stream_definition"(p_stream_id text) from PUBLIC, anon, authenticated;
grant execute on function "public"."get_lighthouse_stream_definition"(p_stream_id text) to service_role;

reset search_path;
