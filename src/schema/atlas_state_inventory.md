# Atlas Supabase State Inventory

Captured from Atlas Supabase project `bjdjjgnkhxblnpdrjqtw` at `2026-05-09T08:06:11.757413+00:00`.

## Tables and row counts

| Table | Rows | RLS | Primary key |
|---|---:|---|---|
| `public.agency_metrics` | 533 | enabled | id |
| `public.case_law` | 20 | enabled | id |
| `public.civic_map_resources` | 578 | enabled | id |
| `public.connector_registry` | 25 | enabled | id |
| `public.cursors` | 1 | enabled | cursor_id |
| `public.ingest_jobs` | 19 | enabled | id |
| `public.investigative_jobs` | 1 | enabled | job_id |
| `public.jurisdictions` | 79 | enabled | id |
| `public.prime_patterns` | 1 | enabled | pattern_id |
| `public.raw_records` | 40 | enabled | id |
| `public.schema_registry` | 25 | enabled | id |
| `public.signal_definitions` | 2 | enabled | id |
| `public.signal_events` | 4 | enabled | stream_id, offset |
| `public.statutes` | 20 | enabled | id |
| `public.streams` | 4 | enabled | stream_id |

## Functions

| Function | Result type |
|---|---|
| `public.get_connector_status(connector_name text)` | `TABLE(name text, active boolean, priority integer, last_run timestamp with time zone, next_run timestamp with time zone, health text, records_last_7d bigint)` |
| `public.search_atlas_pins(search_query text)` | `TABLE(id text, name text, address text, city text, pin_type text, latitude numeric, longitude numeric)` |
| `public.set_updated_at()` | `trigger` |
| `public.trigger_connector_run(connector_name text)` | `jsonb` |
| `public.upsert_atlas_entity_registry(_entities jsonb)` | `integer` |
| `public.upsert_openstates_civic_map_signals_v1(_signals jsonb)` | `TABLE(out_signal_id bigint, out_signal_type character varying, out_statute_id uuid, out_rule_id text, out_action text)` |
| `public.verify_atlas_tables()` | `TABLE(table_name text, row_count bigint)` |

## RLS policies

| Table | Policy | Command | Roles |
|---|---|---|---|
| `public.agency_metrics` | `anon_read_agency_metrics` | SELECT | anon |
| `public.agency_metrics` | `service_role_write_agency_metrics` | ALL | service_role |
| `public.case_law` | `Public read case_law` | SELECT | public |
| `public.civic_map_resources` | `anon_read_civic_map_resources` | SELECT | anon |
| `public.civic_map_resources` | `service_role_write_civic_map_resources` | ALL | service_role |
| `public.connector_registry` | `Public read connectors` | SELECT | public |
| `public.ingest_jobs` | `Auth read jobs` | SELECT | public |
| `public.jurisdictions` | `anon_read_jurisdictions` | SELECT | anon |
| `public.jurisdictions` | `service_role_write_jurisdictions` | ALL | service_role |
| `public.prime_patterns` | `authenticated_read_prime_patterns` | SELECT | authenticated |
| `public.raw_records` | `Auth read raw` | SELECT | public |
| `public.schema_registry` | `Public read schemas` | SELECT | public |
| `public.signal_definitions` | `anon_read_signal_definitions` | SELECT | anon |
| `public.signal_definitions` | `service_role_write_signal_definitions` | ALL | service_role |
| `public.signal_events` | `authenticated_read_signal_events` | SELECT | authenticated |
| `public.statutes` | `Public read statutes` | SELECT | public |
| `public.streams` | `authenticated_read_streams` | SELECT | authenticated |

## Triggers

| Table | Trigger | Timing | Event |
|---|---|---|---|
| `public.cursors` | `set_cursors_updated_at` | BEFORE | UPDATE |
| `public.streams` | `set_streams_updated_at` | BEFORE | UPDATE |
