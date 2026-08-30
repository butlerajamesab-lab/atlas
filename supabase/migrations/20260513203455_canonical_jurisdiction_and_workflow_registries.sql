-- Atlas current production-derived schema baseline.
-- Production project: bjdjjgnkhxblnpdrjqtw (PostgreSQL 17.6).
-- Catalog captured read-only on 2026-08-30.
-- No production rows, bridge secrets, cron jobs, or runtime response rows are included.
-- This is a transparent current-state squash, not a claim about lost pre-ledger history.
-- Production ledger receipt: 278e15ff6dddc371e0484145c4aaa2fefb82913b83e28acf5729e35cd009af7f.
-- Intentional exclusions: 18 retired/unsupported functions and 4 retired triggers.
-- Intentional hardening: direct Atlas namespace access and 4 sensitive functions are service-role-only.

set check_function_bodies = false;

-- ---- extensions and schemas ----
create schema if not exists extensions;
create schema if not exists atlas;
create schema if not exists private;
create schema if not exists vault;
create extension if not exists "http" with schema "extensions";
create extension if not exists "pg_net" with schema "extensions";
create extension if not exists "pg_stat_statements" with schema "extensions";
create extension if not exists "pgcrypto" with schema "extensions";
create extension if not exists "supabase_vault" with schema "vault";
create extension if not exists "uuid-ossp" with schema "extensions";
set search_path = pg_catalog, public, extensions;

-- ---- standalone sequences ----
create sequence "atlas"."action_queue_action_id_seq" as bigint increment by 1 start with 1 cache 1 no cycle;
create sequence "atlas"."bridge_operational_audit_audit_id_seq" as bigint increment by 1 start with 1 cache 1 no cycle;
create sequence "atlas"."census_city_data_city_id_seq" as bigint increment by 1 start with 1 cache 1 no cycle;
create sequence "atlas"."census_tract_data_tract_id_seq" as bigint increment by 1 start with 1 cache 1 no cycle;
create sequence "atlas"."civic_map_signals_signal_id_seq" as bigint increment by 1 start with 1 cache 1 no cycle;
create sequence "atlas"."contact_registry_contact_id_seq" as bigint increment by 1 start with 1 cache 1 no cycle;
create sequence "atlas"."contract_clauses_clause_id_seq" as bigint increment by 1 start with 1 cache 1 no cycle;
create sequence "atlas"."court_cases_case_id_seq" as bigint increment by 1 start with 1 cache 1 no cycle;
create sequence "atlas"."endpoint_probe_queue_queue_id_seq" as bigint increment by 1 start with 1 cache 1 no cycle;
create sequence "atlas"."entity_aliases_alias_id_seq" as bigint increment by 1 start with 1 cache 1 no cycle;
create sequence "atlas"."healthcare_facilities_facility_id_seq" as bigint increment by 1 start with 1 cache 1 no cycle;
create sequence "atlas"."immigration_courts_court_id_seq" as bigint increment by 1 start with 1 cache 1 no cycle;
create sequence "atlas"."inferred_schema_draft_draft_id_seq" as bigint increment by 1 start with 1 cache 1 no cycle;
create sequence "atlas"."ingest_job_job_id_seq" as bigint increment by 1 start with 1 cache 1 no cycle;
create sequence "atlas"."lighthouse_bridge_queue_queue_id_seq" as bigint increment by 1 start with 1 cache 1 no cycle;
create sequence "atlas"."lighthouse_cases_case_id_seq" as bigint increment by 1 start with 1 cache 1 no cycle;
create sequence "atlas"."lighthouse_map_pins_pin_id_seq" as bigint increment by 1 start with 1 cache 1 no cycle;
create sequence "atlas"."lighthouse_signals_signal_id_seq" as bigint increment by 1 start with 1 cache 1 no cycle;
create sequence "atlas"."location_registry_location_id_seq" as bigint increment by 1 start with 1 cache 1 no cycle;
create sequence "atlas"."municipal_bonds_bond_id_seq" as bigint increment by 1 start with 1 cache 1 no cycle;
create sequence "atlas"."nonprofit_financials_filing_id_seq" as bigint increment by 1 start with 1 cache 1 no cycle;
create sequence "atlas"."pdf_extraction_queue_queue_id_seq" as bigint increment by 1 start with 1 cache 1 no cycle;
create sequence "atlas"."raw_benefits_wa_raw_id_seq" as bigint increment by 1 start with 1 cache 1 no cycle;
create sequence "atlas"."raw_food_banks_king_county_raw_id_seq" as bigint increment by 1 start with 1 cache 1 no cycle;
create sequence "atlas"."raw_nonprofits_wa_raw_id_seq" as bigint increment by 1 start with 1 cache 1 no cycle;
create sequence "atlas"."raw_regulations_gov_raw_id_seq" as bigint increment by 1 start with 1 cache 1 no cycle;
create sequence "atlas"."regulatory_comments_comment_id_seq" as bigint increment by 1 start with 1 cache 1 no cycle;
create sequence "atlas"."regulatory_final_rules_rule_id_seq" as bigint increment by 1 start with 1 cache 1 no cycle;
create sequence "atlas"."school_districts_district_id_seq" as bigint increment by 1 start with 1 cache 1 no cycle;
create sequence "atlas"."utility_rate_cases_rate_id_seq" as bigint increment by 1 start with 1 cache 1 no cycle;
create sequence "atlas"."water_systems_system_id_seq" as bigint increment by 1 start with 1 cache 1 no cycle;
create sequence "public"."civic_infrastructure_nodes_id_seq" as bigint increment by 1 start with 1 cache 1 no cycle;

-- ---- tables ----
create table "atlas"."action_queue" (
  "action_id" bigint default nextval('atlas.action_queue_action_id_seq'::regclass) not null,
  "action_type" character varying(64) not null,
  "payload" jsonb default '{}'::jsonb not null,
  "status" character varying(32) default 'pending'::character varying,
  "priority" integer default 500,
  "scheduled_at" timestamp with time zone default now(),
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "error_message" text,
  "created_at" timestamp with time zone default now()
);
create table "atlas"."atlas_case_links" (
  "id" uuid default gen_random_uuid() not null,
  "atlas_convergence_event_id" uuid not null,
  "prism_case_id" uuid not null,
  "prism_project_ref" text default 'prism-v2'::text not null,
  "link_type" text not null,
  "link_strength" numeric(5,4) default 1.0 not null,
  "link_reason" jsonb default '{}'::jsonb not null,
  "is_bidirectional" boolean default true not null,
  "created_at" timestamp with time zone default now() not null
);
create table "atlas"."atlas_escalation_links" (
  "id" uuid default gen_random_uuid() not null,
  "atlas_convergence_event_id" uuid not null,
  "prism_escalation_id" uuid not null,
  "prism_project_ref" text default 'prism-v2'::text not null,
  "trigger_reason" text not null,
  "auto_escalate" boolean default false not null,
  "escalation_threshold" numeric(5,4) default 0.85 not null,
  "created_at" timestamp with time zone default now() not null
);
create table "atlas"."benefits_offices" (
  "office_id" character varying(64) not null,
  "source_system" character varying(128) not null,
  "office_name" character varying(512) not null,
  "program_type" character varying(64),
  "address_raw" character varying(512),
  "city" character varying(128),
  "state" character varying(8),
  "zip_code" character varying(16),
  "phone" character varying(32),
  "fax" character varying(32),
  "email" character varying(256),
  "hours" character varying(256),
  "latitude" numeric(10,8),
  "longitude" numeric(11,8),
  "walk_in" boolean,
  "appointment_required" boolean,
  "languages" character varying(256),
  "accessibility" character varying(512),
  "source_last_updated" date,
  "jurisdiction" character varying(128) not null,
  "raw_payload" jsonb,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now()
);
create table "atlas"."bridge_config" (
  "bridge_id" character varying(50) not null,
  "bridge_name" character varying(200) not null,
  "target_project" character varying(50) not null,
  "target_url" character varying(500) not null,
  "target_service_key" text not null,
  "target_schema" character varying(100) default 'public'::character varying,
  "bridge_type" character varying(50) default 'push'::character varying not null,
  "enabled" boolean default true,
  "config_json" jsonb default '{}'::jsonb,
  "last_sync_at" timestamp with time zone,
  "last_sync_status" character varying(50),
  "last_sync_error" text,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now()
);
create table "atlas"."bridge_operational_audit" (
  "audit_id" bigint default nextval('atlas.bridge_operational_audit_audit_id_seq'::regclass) not null,
  "signal_id" bigint not null,
  "signal_type" text,
  "bridge_hash" text,
  "emitted_at" timestamp with time zone default now(),
  "jurisdiction" text,
  "confidence_score" numeric(5,4),
  "severity" text,
  "downstream_consumed" boolean default false,
  "lighthouse_bridge_record_id" uuid,
  "processing_status" text default 'emitted'::text,
  "failure_reason" text,
  "metadata" jsonb default '{}'::jsonb
);
create table "atlas"."bridge_sync_log" (
  "log_id" bigint generated always as identity not null,
  "bridge_id" character varying(50) not null,
  "sync_type" character varying(100) not null,
  "source_table" character varying(200),
  "source_record_id" character varying(200),
  "target_table" character varying(200),
  "target_record_id" character varying(200),
  "status" character varying(50) default 'pending'::character varying not null,
  "request_payload" jsonb,
  "response_payload" jsonb,
  "error_message" text,
  "duration_ms" integer,
  "synced_at" timestamp with time zone default now()
);
create table "atlas"."census_city_data" (
  "city_id" bigint default nextval('atlas.census_city_data_city_id_seq'::regclass) not null,
  "geography_key" character varying(64),
  "city_name" character varying(256) not null,
  "state_fips" character varying(8) not null,
  "place_fips" character varying(16),
  "county_fips" character varying(16),
  "total_population" integer,
  "median_age" numeric(4,1),
  "pct_below_poverty" numeric(5,2),
  "pct_below_poverty_children" numeric(5,2),
  "median_household_income" integer,
  "per_capita_income" integer,
  "pct_unemployed" numeric(5,2),
  "labor_force_participation" numeric(5,2),
  "median_rent" integer,
  "median_home_value" integer,
  "pct_renter_occupied" numeric(5,2),
  "pct_housing_burden_30pct" numeric(5,2),
  "pct_housing_burden_50pct" numeric(5,2),
  "pct_white" numeric(5,2),
  "pct_black" numeric(5,2),
  "pct_hispanic" numeric(5,2),
  "pct_asian" numeric(5,2),
  "pct_native_american" numeric(5,2),
  "pct_pacific_islander" numeric(5,2),
  "pct_two_or_more" numeric(5,2),
  "pct_english_only" numeric(5,2),
  "pct_spanish_speaking" numeric(5,2),
  "pct_asian_language" numeric(5,2),
  "pct_other_language" numeric(5,2),
  "pct_less_than_high_school" numeric(5,2),
  "pct_high_school_only" numeric(5,2),
  "pct_some_college" numeric(5,2),
  "pct_bachelors_plus" numeric(5,2),
  "pct_with_disability" numeric(5,2),
  "pct_65_plus" numeric(5,2),
  "pct_uninsured" numeric(5,2),
  "latitude" numeric(10,8),
  "longitude" numeric(11,8),
  "land_area_sqmi" numeric(10,4),
  "acs_year" integer default 2022,
  "source_system" character varying(128) default 'census_acs5'::character varying,
  "raw_payload" jsonb,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now()
);
create table "atlas"."census_tract_data" (
  "tract_id" bigint default nextval('atlas.census_tract_data_tract_id_seq'::regclass) not null,
  "geography_key" character varying(64),
  "tract_geoid" character varying(16) not null,
  "tract_name" character varying(128),
  "state_fips" character varying(8) not null,
  "county_fips" character varying(16) not null,
  "total_population" integer,
  "pct_below_poverty" numeric(5,2),
  "median_household_income" integer,
  "pct_white" numeric(5,2),
  "pct_black" numeric(5,2),
  "pct_hispanic" numeric(5,2),
  "pct_asian" numeric(5,2),
  "pct_renter_occupied" numeric(5,2),
  "median_rent" integer,
  "latitude" numeric(10,8),
  "longitude" numeric(11,8),
  "acs_year" integer default 2022,
  "source_system" character varying(128) default 'census_acs5'::character varying,
  "raw_payload" jsonb,
  "created_at" timestamp with time zone default now()
);
create table "atlas"."civic_genome_external_snapshot" (
  "source_snapshot_id" text not null,
  "source_snapshot_hash" text not null,
  "source_schema_id" text not null,
  "source_contract_id" text not null,
  "source_contract_version" text not null,
  "source_owner" text not null,
  "snapshot_kind" text not null,
  "source_as_of" timestamp with time zone not null,
  "methodology_version" text not null,
  "scope_json" jsonb not null,
  "component_count" integer not null,
  "completeness_state" text not null,
  "unresolved_conditions" jsonb not null,
  "excluded_component_types" jsonb not null,
  "source_export_receipt_id" text not null,
  "source_export_receipt_hash" text not null,
  "deterministic_replay_key" text not null,
  "source_commit_sha" text,
  "snapshot_json" jsonb not null,
  "atlas_binding_hash" text not null,
  "delivery_key_id" text not null,
  "delivery_receipt_hash" text not null,
  "received_at" timestamp with time zone default now() not null
);
create table "atlas"."civic_genome_legislative_projection_run" (
  "projection_key" text not null,
  "mapping_rule_id" text not null,
  "mapping_rule_version" text not null,
  "mapping_rule_hash" text not null,
  "source_snapshot_id" text not null,
  "source_snapshot_hash" text not null,
  "version_manifest_hash" text not null,
  "source_version_count" integer not null,
  "observation_count" integer not null,
  "observation_hash" text not null,
  "ingest_run_id" uuid,
  "events_inserted" integer not null,
  "replays_suppressed" integer not null,
  "status" text not null,
  "receipt_json" jsonb not null,
  "persisted_at" timestamp with time zone default now() not null
);
create table "atlas"."civic_genome_legislative_trait_binding_accounting" (
  "accounting_hash" text not null,
  "accounting_rule_id" text not null,
  "accounting_rule_version" text not null,
  "accounting_rule_hash" text not null,
  "projection_key" text not null,
  "source_snapshot_id" text not null,
  "source_snapshot_hash" text not null,
  "total_trait_count" integer not null,
  "exact_version_bound_trait_count" integer not null,
  "historical_same_source_trait_count" integer not null,
  "unresolved_trait_count" integer not null,
  "completeness_state" text not null,
  "receipt_json" jsonb not null,
  "persisted_at" timestamp with time zone default now() not null
);
create table "atlas"."civic_map_signals" (
  "signal_id" bigint default nextval('atlas.civic_map_signals_signal_id_seq'::regclass) not null,
  "signal_type" character varying(64) not null,
  "geography_key" character varying(64),
  "severity_score" numeric(5,2) default 0.0,
  "metadata_json" jsonb default '{}'::jsonb,
  "source_table" character varying(128),
  "source_record_id" character varying(256),
  "detected_at" timestamp with time zone default now(),
  "created_at" timestamp with time zone default now(),
  "source_connector_id" uuid,
  "raw_record_id" uuid,
  "statute_id" uuid,
  "entity_ids" text[],
  "jurisdiction_raw_value" text,
  "jurisdiction_id" uuid,
  "source_url" text,
  "confidence_score" numeric,
  "severity" text,
  "signal_status" text,
  "evidence_payload" jsonb default '{}'::jsonb,
  "generation_method" text,
  "rule_id" text,
  "rule_version" text,
  "provenance_metadata" jsonb default '{}'::jsonb,
  "signal_dedup_key" text,
  "record_origin" text,
  "verification_status" text,
  "exclude_from_production" boolean default false,
  "quarantine_reason" text,
  "signal_bridge_hash" text
);
create table "atlas"."clause_patterns" (
  "pattern_id" character varying(64) not null,
  "pattern_name" character varying(256) not null,
  "pattern_description" text,
  "regex_pattern" text not null,
  "regex_flags" character varying(16) default 'gi'::character varying,
  "category" character varying(64) not null,
  "domain_code" character varying(16),
  "severity_weight" numeric(3,2) default 0.50,
  "confidence_weight" numeric(3,2) default 0.80,
  "context_chars_before" integer default 200,
  "context_chars_after" integer default 200,
  "enabled" boolean default true,
  "version" integer default 1,
  "created_by" character varying(128),
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now()
);
create table "atlas"."connector_registry" (
  "connector_id" character varying(64) not null,
  "display_name" character varying(256) not null,
  "base_url" text,
  "auth_type" character varying(32) default 'none'::character varying,
  "config_template" jsonb default '{}'::jsonb,
  "pagination_strategy" character varying(32) default 'none'::character varying,
  "rate_limit_rps" integer default 5,
  "is_active" boolean default true,
  "created_at" timestamp with time zone default now()
);
create table "atlas"."contact_registry" (
  "contact_id" bigint default nextval('atlas.contact_registry_contact_id_seq'::regclass) not null,
  "entity_id" character varying(128),
  "source_population_id" character varying(256) not null,
  "source_population_table" character varying(128) not null,
  "source_schema_name" character varying(128) not null,
  "contact_type" character varying(32) not null,
  "contact_value" character varying(512) not null,
  "contact_label" character varying(128),
  "normalized_value" character varying(512),
  "is_primary" boolean default false,
  "is_verified" boolean default false,
  "verification_source" character varying(256),
  "geography_key" character varying(64),
  "first_seen_at" timestamp with time zone default now(),
  "last_seen_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now()
);
create table "atlas"."contract_clauses" (
  "clause_id" bigint default nextval('atlas.contract_clauses_clause_id_seq'::regclass) not null,
  "contract_id" character varying(128) not null,
  "source_system" character varying(128) not null,
  "queue_id" bigint,
  "pattern_id" character varying(64) not null,
  "clause_category" character varying(64),
  "clause_text" text not null,
  "clause_context" text,
  "severity_score" numeric(3,2),
  "confidence_score" numeric(3,2),
  "extraction_confidence" numeric(3,2),
  "page_number" integer,
  "char_offset" integer,
  "line_number" integer,
  "pdf_url" character varying(512),
  "status" character varying(32) default 'pending'::character varying,
  "reviewed_by" character varying(128),
  "reviewed_at" timestamp with time zone,
  "review_notes" text,
  "extracted_at" timestamp with time zone default now(),
  "created_at" timestamp with time zone default now()
);
create table "atlas"."convergence_events" (
  "id" uuid default gen_random_uuid() not null,
  "pattern_id" uuid not null,
  "event_name" text not null,
  "signal_ids" uuid[] default '{}'::uuid[] not null,
  "convergence_score" numeric(8,6) not null,
  "confidence" numeric(5,4) not null,
  "affected_jurisdictions" text[] default '{}'::text[] not null,
  "affected_entities" text[] default '{}'::text[] not null,
  "geometry" jsonb,
  "temporal_span" tstzrange,
  "is_corruption_indicator" boolean default false not null,
  "is_reparative_opportunity" boolean default false not null,
  "prism_case_id" uuid,
  "prism_escalation_id" uuid,
  "status" text default 'open'::text not null,
  "metadata" jsonb default '{}'::jsonb,
  "detected_at" timestamp with time zone default now() not null,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null
);
create table "atlas"."convergence_patterns" (
  "id" uuid default gen_random_uuid() not null,
  "pattern_name" text not null,
  "pattern_signature" jsonb default '{}'::jsonb not null,
  "required_signal_types" uuid[] default '{}'::uuid[] not null,
  "min_signals" integer default 2 not null,
  "convergence_equation_id" uuid,
  "threshold_score" numeric(8,6) default 0.75 not null,
  "domain" text default 'universal'::text not null,
  "description" text,
  "is_active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null
);
create table "atlas"."convergence_receipt" (
  "run_key" text not null,
  "geography_id" text not null,
  "receipt_identity" text not null,
  "equation_id" text not null,
  "engine_version" text not null,
  "rule_manifest_hash" text not null,
  "as_of" bigint not null,
  "configuration_hash" text not null,
  "source_population_hash" text not null,
  "input_hash" text not null,
  "output_hash" text not null,
  "source_signal_ids" jsonb not null,
  "geography_registry_version" text not null,
  "expected_count" numeric,
  "observed_count" integer not null,
  "z_score" numeric,
  "convergence_detected" boolean not null,
  "status" text not null,
  "reason_unresolved" text,
  "computed_outputs" jsonb not null,
  "timestamp_computed" bigint not null,
  "persisted_at" timestamp with time zone default now() not null
);
create table "atlas"."convergence_result_payload" (
  "run_key" text not null,
  "output_hash" text not null,
  "payload_json" jsonb not null,
  "receipt_count" integer not null,
  "persisted_at" timestamp with time zone default now() not null
);
create table "atlas"."convergence_run_manifest" (
  "run_key" text not null,
  "engine_version" text not null,
  "as_of" bigint not null,
  "time_window_ms" bigint not null,
  "temporal_bucket_ms" bigint not null,
  "geography_registry_version" text not null,
  "analysis_registry_hash" text not null,
  "analysis_level" text not null,
  "rule_manifest_hash" text not null,
  "configuration_hash" text not null,
  "configuration_json" jsonb not null,
  "source_population_hash" text not null,
  "transformed_population_hash" text not null,
  "deduplicated_population_hash" text not null,
  "total_source_rows" integer not null,
  "total_signals_raw" integer not null,
  "total_signals_deduplicated" integer not null,
  "total_geographies" integer not null,
  "receipt_count" integer not null,
  "output_hash" text not null,
  "persisted_at" timestamp with time zone default now() not null
);
create table "atlas"."convergence_signal_snapshot" (
  "run_key" text not null,
  "snapshot_type" text not null,
  "population_hash" text not null,
  "record_count" integer not null,
  "records_json" jsonb not null,
  "persisted_at" timestamp with time zone default now() not null
);
create table "atlas"."corruption_indicators" (
  "id" uuid default gen_random_uuid() not null,
  "convergence_event_id" uuid not null,
  "indicator_type" text not null,
  "severity" integer not null,
  "affected_system" text not null,
  "affected_jurisdiction" text not null,
  "entities_involved" text[] default '{}'::text[] not null,
  "evidence_signal_ids" uuid[] default '{}'::uuid[] not null,
  "status" text default 'unverified'::text not null,
  "prism_case_id" uuid,
  "metadata" jsonb default '{}'::jsonb,
  "detected_at" timestamp with time zone default now() not null,
  "reviewed_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null
);
create table "atlas"."court_cases" (
  "case_id" bigint default nextval('atlas.court_cases_case_id_seq'::regclass) not null,
  "case_number" character varying(128) not null,
  "court_id" character varying(64),
  "court_name" character varying(256),
  "judge_name" character varying(256),
  "judge_id" character varying(128),
  "case_type" character varying(64),
  "nature_of_suit" character varying(128),
  "filing_date" date,
  "termination_date" date,
  "outcome" character varying(64),
  "industry_code" character varying(64),
  "source_system" character varying(128) default 'courtlistener'::character varying,
  "raw_payload" jsonb,
  "created_at" timestamp with time zone default now()
);
create table "atlas"."detection_rules" (
  "rule_id" character varying(64) not null,
  "rule_name" character varying(256) not null,
  "rule_type" character varying(32),
  "target_table" character varying(128) not null,
  "domain_code" character varying(16),
  "sql_logic_template" text not null,
  "threshold_parameters" jsonb not null,
  "signal_type" character varying(64) not null,
  "precedence_weight" integer default 500,
  "requires_text_analysis" boolean default false,
  "enabled" boolean default true,
  "created_at" timestamp with time zone default now()
);
create table "atlas"."discovery_platforms" (
  "platform_id" character varying(64) not null,
  "platform_name" character varying(128) not null,
  "platform_type" character varying(32),
  "listing_endpoint_template" text,
  "listing_pagination_strategy" character varying(32),
  "dataset_id_path" character varying(128),
  "dataset_name_path" character varying(128),
  "dataset_updated_path" character varying(128),
  "metadata_endpoint_template" text,
  "column_list_path" character varying(128),
  "column_name_field" character varying(64),
  "column_type_field" character varying(64),
  "default_auth_type" character varying(32),
  "default_pagination_strategy" character varying(32),
  "rate_limit_rps" integer default 5,
  "coverage_jurisdictions" jsonb default '["all"]'::jsonb,
  "is_federal" boolean default false,
  "active" boolean default true,
  "created_at" timestamp with time zone default now()
);
create table "atlas"."domain_configs" (
  "id" uuid default gen_random_uuid() not null,
  "domain_id" uuid not null,
  "config_key" text not null,
  "config_value" jsonb default '{}'::jsonb not null,
  "precedence_override" numeric(5,4),
  "is_active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null
);
create table "atlas"."domain_registry" (
  "domain_code" character varying(16) not null,
  "domain_name" character varying(128) not null,
  "domain_description" text,
  "active" boolean default true,
  "created_at" timestamp with time zone default now()
);
create table "atlas"."domains" (
  "id" uuid default gen_random_uuid() not null,
  "domain_code" text not null,
  "domain_name" text not null,
  "parent_domain" text,
  "signal_type_ids" uuid[] default '{}'::uuid[] not null,
  "equation_ids" uuid[] default '{}'::uuid[] not null,
  "jurisdiction_mappings" jsonb default '{}'::jsonb,
  "reparative_weight" numeric(5,4) default 1.0 not null,
  "is_active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null
);
create table "atlas"."endpoint_probe_queue" (
  "queue_id" bigint default nextval('atlas.endpoint_probe_queue_queue_id_seq'::regclass) not null,
  "platform_id" character varying(64) not null,
  "jurisdiction" character varying(128) not null,
  "endpoint_url" character varying(512) not null,
  "dataset_name" character varying(512),
  "dataset_id" character varying(256),
  "probe_status" character varying(32) default 'pending'::character varying,
  "last_probed_at" timestamp with time zone,
  "last_http_status" integer,
  "last_error" text,
  "response_sample" jsonb,
  "inferred_schema_json" jsonb,
  "inferred_target_table" character varying(128),
  "inferred_field_count" integer,
  "reviewed_by" character varying(128),
  "reviewed_at" timestamp with time zone,
  "review_notes" text,
  "activated_schema_name" character varying(128),
  "activated_connector_id" character varying(64),
  "created_at" timestamp with time zone default now()
);
create table "atlas"."entity_aliases" (
  "alias_id" bigint default nextval('atlas.entity_aliases_alias_id_seq'::regclass) not null,
  "entity_id" character varying(128) not null,
  "alias_text" character varying(512) not null,
  "alias_type" character varying(32) default 'spelling_variant'::character varying,
  "source_jurisdiction" character varying(128),
  "source_system" character varying(128),
  "confidence_score" numeric(3,2) default 1.00,
  "created_at" timestamp with time zone default now()
);
create table "atlas"."entity_registry" (
  "entity_id" character varying(128) not null,
  "entity_type" character varying(32) not null,
  "primary_name" character varying(512) not null,
  "name_variants" jsonb default '[]'::jsonb,
  "canonical_address" character varying(512),
  "canonical_address_hash" character varying(64),
  "canonical_email" character varying(256),
  "canonical_phone" character varying(32),
  "first_seen_jurisdiction" character varying(128),
  "jurisdiction_count" integer default 0,
  "source_systems" jsonb default '[]'::jsonb,
  "source_population_id" character varying(256),
  "source_population_table" character varying(128),
  "is_active" boolean default true,
  "last_verified" timestamp with time zone default now(),
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "source_connector_id" uuid,
  "raw_record_id" uuid,
  "statute_id" uuid,
  "source_url" text,
  "extracted_at" timestamp with time zone,
  "extraction_method" text,
  "source_field" text,
  "source_external_id" text,
  "metadata" jsonb
);
create table "atlas"."equations" (
  "id" uuid default gen_random_uuid() not null,
  "equation_name" text not null,
  "equation_latex" text not null,
  "equation_plaintext" text not null,
  "variables" jsonb default '{}'::jsonb not null,
  "domain" text default 'universal'::text not null,
  "precedence_weight" numeric(5,4) default 1.0 not null,
  "is_convergence" boolean default false not null,
  "is_reparative" boolean default false not null,
  "description" text,
  "created_at" timestamp with time zone default now() not null
);
create table "atlas"."fingerprint_matches" (
  "id" uuid default gen_random_uuid() not null,
  "source_fingerprint_id" uuid not null,
  "matched_fingerprint_id" uuid not null,
  "match_type" text not null,
  "match_score" numeric(8,6) not null,
  "confidence" numeric(5,4) not null,
  "divergence_vector" jsonb default '{}'::jsonb,
  "is_cross_jurisdiction" boolean default false not null,
  "matched_at" timestamp with time zone default now() not null,
  "metadata" jsonb default '{}'::jsonb
);
create table "atlas"."fingerprints" (
  "id" uuid default gen_random_uuid() not null,
  "fingerprint_type" text not null,
  "target_id" uuid not null,
  "target_table" text not null,
  "hash_algorithm" text default 'sha256'::text not null,
  "fingerprint_hash" text not null,
  "component_signals" uuid[] default '{}'::uuid[] not null,
  "temporal_signature" jsonb default '{}'::jsonb,
  "spatial_signature" jsonb default '{}'::jsonb,
  "behavioral_signature" jsonb default '{}'::jsonb,
  "precedence_score" numeric(8,6) default 0.0 not null,
  "first_seen_at" timestamp with time zone default now() not null,
  "last_seen_at" timestamp with time zone default now() not null,
  "occurrence_count" integer default 1 not null,
  "is_verified" boolean default false not null,
  "metadata" jsonb default '{}'::jsonb,
  "created_at" timestamp with time zone default now() not null
);
create table "atlas"."food_banks" (
  "pantry_id" character varying(64) not null,
  "source_system" character varying(128) not null,
  "pantry_name" character varying(512) not null,
  "parent_organization" character varying(512),
  "address_raw" character varying(512),
  "city" character varying(128),
  "state" character varying(8),
  "zip_code" character varying(16),
  "phone" character varying(32),
  "email" character varying(256),
  "website" character varying(256),
  "latitude" numeric(10,8),
  "longitude" numeric(11,8),
  "hours" character varying(256),
  "id_required" boolean,
  "residency_proof_required" boolean,
  "serves_children" boolean,
  "serves_seniors" boolean,
  "serves_homeless" boolean,
  "languages" character varying(256),
  "wheelchair_accessible" boolean,
  "last_verified" date,
  "jurisdiction" character varying(128) not null,
  "raw_payload" jsonb,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now()
);
create table "atlas"."geography_registry" (
  "geography_key" character varying(64) not null,
  "geography_name" character varying(256) not null,
  "geography_type" character varying(32),
  "state_fips" character varying(8),
  "county_fips" character varying(8),
  "parent_geography_key" character varying(64),
  "latitude" numeric(10,8),
  "longitude" numeric(11,8),
  "bounding_box" jsonb,
  "population" integer,
  "is_active" boolean default true,
  "created_at" timestamp with time zone default now(),
  "geography_slug" character varying(256),
  "parent_key" character varying(64),
  "active" boolean default true,
  "metadata_json" jsonb default '{}'::jsonb
);
create table "atlas"."geography_registry_snapshot" (
  "registry_hash" text not null,
  "registry_version" text not null,
  "jurisdiction" text not null,
  "analysis_level" text not null,
  "source_id" text not null,
  "source_version" text,
  "source_url" text,
  "record_count" integer not null,
  "entries_json" jsonb not null,
  "provenance_records" jsonb not null,
  "persisted_at" timestamp with time zone default now() not null
);
create table "atlas"."healthcare_facilities" (
  "facility_id" bigint default nextval('atlas.healthcare_facilities_facility_id_seq'::regclass) not null,
  "cms_certification_number" character varying(16),
  "facility_name" character varying(512),
  "facility_type" character varying(64),
  "city" character varying(128),
  "state" character varying(8),
  "county" character varying(128),
  "latitude" numeric(10,8),
  "longitude" numeric(11,8),
  "total_beds" integer,
  "staffed_beds" integer,
  "bed_occupancy_rate" numeric(5,2),
  "medicare_reimbursement_rate" numeric(10,2),
  "licensing_status" character varying(32),
  "last_inspection_date" date,
  "deficiency_count" integer,
  "nearest_facility_miles" numeric(6,2),
  "source_system" character varying(128) default 'cms'::character varying,
  "raw_payload" jsonb,
  "created_at" timestamp with time zone default now()
);
create table "atlas"."immigration_courts" (
  "court_id" bigint default nextval('atlas.immigration_courts_court_id_seq'::regclass) not null,
  "court_location" character varying(256) not null,
  "state" character varying(8),
  "pending_cases" integer,
  "backlog_days_avg" integer,
  "backlog_change_pct" numeric(6,2),
  "case_completion_rate" numeric(5,2),
  "source_system" character varying(128) default 'eoir'::character varying,
  "raw_payload" jsonb,
  "created_at" timestamp with time zone default now()
);
create table "atlas"."inferred_schema_draft" (
  "draft_id" bigint default nextval('atlas.inferred_schema_draft_draft_id_seq'::regclass) not null,
  "queue_id" bigint not null,
  "draft_schema_name" character varying(128) not null,
  "draft_schema_json" jsonb not null,
  "draft_connector_json" jsonb,
  "inferred_field_count" integer,
  "required_field_coverage" numeric(4,2),
  "confidence_score" numeric(3,2),
  "approved_by" character varying(128),
  "approved_at" timestamp with time zone,
  "approval_notes" text,
  "created_at" timestamp with time zone default now()
);
create table "atlas"."ingest_job" (
  "job_id" bigint default nextval('atlas.ingest_job_job_id_seq'::regclass) not null,
  "schema_name" character varying(128),
  "connector_id" character varying(64),
  "job_status" character varying(32) default 'pending'::character varying,
  "records_fetched" integer default 0,
  "records_inserted" integer default 0,
  "records_updated" integer default 0,
  "records_failed" integer default 0,
  "error_log" jsonb default '[]'::jsonb,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone default now()
);
create table "atlas"."ingest_schedule" (
  "schema_name" character varying(128) not null,
  "cron_expr" character varying(64) not null,
  "enabled" boolean default true,
  "last_run" timestamp with time zone,
  "created_at" timestamp with time zone default now()
);
create table "atlas"."jurisdiction_domains" (
  "jurisdiction" character varying(128) not null,
  "domain" character varying(256) not null,
  "platform_id" character varying(64) not null,
  "is_active" boolean default true,
  "notes" text,
  "created_at" timestamp with time zone default now()
);
create table "atlas"."legal_aid_providers" (
  "provider_id" character varying(64) not null,
  "source_system" character varying(128) not null,
  "provider_name" character varying(512) not null,
  "program_name" character varying(512),
  "service_type" character varying(128),
  "eligibility" text,
  "income_threshold_fpl" numeric(5,2),
  "address_raw" character varying(512),
  "city" character varying(128),
  "state" character varying(8),
  "zip_code" character varying(16),
  "phone" character varying(32),
  "intake_phone" character varying(32),
  "email" character varying(256),
  "website" character varying(256),
  "hours" character varying(256),
  "languages" character varying(256),
  "same_day_intake" boolean,
  "referral_required" boolean,
  "courts_served" character varying(256),
  "last_verified" date,
  "jurisdiction" character varying(128) not null,
  "raw_payload" jsonb,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now()
);
create table "atlas"."lighthouse_bridge_queue" (
  "queue_id" bigint default nextval('atlas.lighthouse_bridge_queue_queue_id_seq'::regclass) not null,
  "atlas_signal_id" bigint,
  "atlas_entity_id" character varying(128),
  "bridge_type" character varying(32) not null,
  "domain_code" character varying(16),
  "payload_json" jsonb not null,
  "status" character varying(32) default 'pending'::character varying,
  "lighthouse_case_id" uuid,
  "attempt_count" integer default 0,
  "max_attempts" integer default 3,
  "last_error" text,
  "next_retry_at" timestamp with time zone,
  "created_at" timestamp with time zone default now(),
  "processed_at" timestamp with time zone,
  "completed_at" timestamp with time zone
);
create table "atlas"."lighthouse_cases" (
  "case_id" bigint default nextval('atlas.lighthouse_cases_case_id_seq'::regclass) not null,
  "atlas_action_id" bigint,
  "case_type" character varying(64) not null,
  "case_title" character varying(512),
  "case_description" text,
  "severity_score" numeric(3,2),
  "priority_score" integer,
  "geography_key" character varying(64),
  "jurisdiction" character varying(128),
  "primary_entity_id" character varying(128),
  "related_entity_ids" jsonb,
  "source_domain" character varying(16),
  "source_reference_id" character varying(128),
  "source_reference_table" character varying(128),
  "detection_rule_id" character varying(64),
  "case_status" character varying(32) default 'open'::character varying,
  "assigned_to" character varying(128),
  "atlas_created_at" timestamp with time zone,
  "lighthouse_ingested_at" timestamp with time zone default now(),
  "last_activity_at" timestamp with time zone default now()
);
create table "atlas"."lighthouse_entities" (
  "entity_id" character varying(128) not null,
  "entity_type" character varying(32),
  "primary_name" character varying(512),
  "canonical_address" character varying(512),
  "canonical_email" character varying(256),
  "canonical_phone" character varying(32),
  "jurisdiction_count" integer,
  "source_systems" jsonb,
  "first_seen_jurisdiction" character varying(128),
  "last_verified" timestamp with time zone,
  "is_active" boolean,
  "atlas_updated_at" timestamp with time zone,
  "lighthouse_ingested_at" timestamp with time zone default now(),
  "risk_score" numeric(3,2),
  "risk_tier" character varying(16),
  "watchlist_status" character varying(32) default 'none'::character varying
);
create table "atlas"."lighthouse_map_pins" (
  "pin_id" bigint default nextval('atlas.lighthouse_map_pins_pin_id_seq'::regclass) not null,
  "geography_key" character varying(64) not null,
  "pin_type" character varying(32) not null,
  "pin_subtype" character varying(64),
  "latitude" numeric(10,8),
  "longitude" numeric(11,8),
  "title" character varying(256),
  "description" text,
  "severity" numeric(3,2),
  "entity_id" character varying(128),
  "signal_id" bigint,
  "case_id" bigint,
  "icon_type" character varying(32) default 'default'::character varying,
  "color_hex" character varying(7) default '#ef4444'::character varying,
  "is_clusterable" boolean default true,
  "atlas_updated_at" timestamp with time zone,
  "lighthouse_ingested_at" timestamp with time zone default now(),
  "expires_at" timestamp with time zone
);
create table "atlas"."lighthouse_signals" (
  "signal_id" bigint default nextval('atlas.lighthouse_signals_signal_id_seq'::regclass) not null,
  "atlas_signal_id" bigint,
  "signal_type" character varying(64) not null,
  "signal_fingerprint" character varying(64),
  "geography_key" character varying(64),
  "severity_score" numeric(3,2),
  "confidence_score" numeric(3,2),
  "source_domain" character varying(16),
  "source_reference_id" character varying(128),
  "source_reference_table" character varying(128),
  "metadata_json" jsonb,
  "narrative_summary" text,
  "detected_at" timestamp with time zone,
  "atlas_created_at" timestamp with time zone,
  "lighthouse_ingested_at" timestamp with time zone default now(),
  "lighthouse_status" character varying(32) default 'new'::character varying,
  "assigned_to" character varying(128)
);
create table "atlas"."live_data_signal_bridge_attempt" (
  "attempt_id" uuid default gen_random_uuid() not null,
  "run_id" uuid not null,
  "candidate_id" uuid not null,
  "candidate_hash" text not null,
  "request_id" bigint,
  "status" text not null,
  "was_already_bridged" boolean default false not null,
  "prior_lighthouse_record_id" uuid,
  "response_status" integer,
  "response_body" text,
  "error_message" text,
  "queued_at" timestamp with time zone default clock_timestamp() not null,
  "settled_at" timestamp with time zone
);
create table "atlas"."live_data_signal_candidate" (
  "candidate_id" uuid default gen_random_uuid() not null,
  "candidate_hash" text not null,
  "rule_id" text not null,
  "rule_version" text not null,
  "rule_contract_hash" text not null,
  "engine_id" text not null,
  "engine_version" text not null,
  "signal_type" text not null,
  "title" text not null,
  "description" text not null,
  "primary_stream_id" text not null,
  "source_event_refs" jsonb not null,
  "entity_ids" text[] not null,
  "entity_resolution_status" text not null,
  "jurisdiction_id" text not null,
  "severity" text not null,
  "confidence_score" numeric(7,6) not null,
  "verification_state" text not null,
  "supporting_statistics" jsonb not null,
  "evidence_refs" jsonb not null,
  "source_freshness_at" timestamp with time zone not null,
  "detected_at" timestamp with time zone not null,
  "source_input_hash" text not null,
  "first_run_id" uuid not null,
  "last_run_id" uuid not null,
  "first_detected_at" timestamp with time zone default now() not null,
  "last_replayed_at" timestamp with time zone,
  "lighthouse_status" text default 'pending'::text not null,
  "lighthouse_record_id" uuid,
  "lighthouse_last_error" text,
  "lighthouse_bridged_at" timestamp with time zone,
  "semantic_key" text not null,
  "is_current" boolean default true not null,
  "supersedes_candidate_id" uuid,
  "retired_at" timestamp with time zone
);
create table "atlas"."live_data_signal_candidate_retirement_v1" (
  "retirement_id" uuid default gen_random_uuid() not null,
  "run_id" uuid not null,
  "candidate_id" uuid not null,
  "rule_id" text not null,
  "rule_version" text not null,
  "candidate_hash" text not null,
  "semantic_key" text not null,
  "lighthouse_record_id" uuid,
  "retirement_reason" text not null,
  "retirement_hash" text not null,
  "retired_at" timestamp with time zone not null,
  "lighthouse_status" text not null,
  "lighthouse_last_error" text,
  "lighthouse_bridged_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null
);
create table "atlas"."live_data_signal_rule" (
  "rule_id" text not null,
  "rule_version" text not null,
  "signal_type" text not null,
  "engine_id" text not null,
  "engine_version" text not null,
  "rule_contract" jsonb not null,
  "rule_contract_hash" text not null,
  "is_active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null
);
create table "atlas"."live_data_signal_run" (
  "run_id" uuid default gen_random_uuid() not null,
  "rule_id" text not null,
  "rule_version" text not null,
  "rule_contract_hash" text not null,
  "status" text not null,
  "canonical_events_scanned" bigint default 0 not null,
  "entities_evaluated" bigint default 0 not null,
  "candidates_produced" bigint default 0 not null,
  "error_message" text,
  "started_at" timestamp with time zone default now() not null,
  "completed_at" timestamp with time zone
);
create table "atlas"."location_registry" (
  "location_id" bigint default nextval('atlas.location_registry_location_id_seq'::regclass) not null,
  "entity_id" character varying(128),
  "source_population_id" character varying(256) not null,
  "source_population_table" character varying(128) not null,
  "address_raw" character varying(512),
  "address_normalized" character varying(512),
  "address_hash" character varying(64),
  "latitude" numeric(10,8),
  "longitude" numeric(11,8),
  "geography_key" character varying(64),
  "location_type" character varying(32),
  "is_active" boolean default true,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now()
);
create table "atlas"."math_constants" (
  "id" uuid default gen_random_uuid() not null,
  "constant_name" text not null,
  "symbol" text not null,
  "numeric_value" numeric(24,12) not null,
  "description" text,
  "domain" text default 'universal'::text not null,
  "is_active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null
);
create table "atlas"."municipal_bonds" (
  "bond_id" bigint default nextval('atlas.municipal_bonds_bond_id_seq'::regclass) not null,
  "cusip" character varying(16) not null,
  "issuer_name" character varying(512),
  "issuer_id" character varying(128),
  "underwriter_name" character varying(512),
  "underwriter_id" character varying(128),
  "issue_date" date,
  "maturity_date" date,
  "principal_amount" numeric(15,2),
  "purpose" character varying(512),
  "covenant_text" text,
  "covenant_restrictions" jsonb,
  "source_system" character varying(128) default 'emma_msrb'::character varying,
  "raw_payload" jsonb,
  "created_at" timestamp with time zone default now()
);
create table "atlas"."nonprofit_financials" (
  "filing_id" bigint default nextval('atlas.nonprofit_financials_filing_id_seq'::regclass) not null,
  "ein" character varying(16) not null,
  "org_name" character varying(512),
  "tax_year" integer,
  "total_revenue" numeric(15,2),
  "total_expenses" numeric(15,2),
  "program_service_revenue" numeric(15,2),
  "program_expenses" numeric(15,2),
  "administrative_expenses" numeric(15,2),
  "fundraising_expenses" numeric(15,2),
  "program_expense_ratio" numeric(5,2),
  "revenue_growth_pct" numeric(6,2),
  "program_growth_pct" numeric(6,2),
  "board_member_count" integer,
  "source_system" character varying(128) default 'propublica_nonprofits'::character varying,
  "raw_payload" jsonb,
  "created_at" timestamp with time zone default now()
);
create table "atlas"."nonprofit_registry" (
  "ein" character varying(16) not null,
  "source_system" character varying(128) not null,
  "organization_name" character varying(512) not null,
  "city" character varying(128),
  "state" character varying(8),
  "zip_code" character varying(16),
  "ntee_code" character varying(16),
  "program_category" character varying(256),
  "subsection_code" character varying(8),
  "total_revenue" numeric(15,2),
  "total_expenses" numeric(15,2),
  "total_assets" numeric(15,2),
  "program_expenses" numeric(15,2),
  "fundraising_expenses" numeric(15,2),
  "administrative_expenses" numeric(15,2),
  "website" character varying(256),
  "phone" character varying(32),
  "address_raw" character varying(512),
  "mission" text,
  "jurisdiction" character varying(128) not null,
  "raw_payload" jsonb,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "latitude" numeric,
  "longitude" numeric
);
create table "atlas"."pdf_extraction_queue" (
  "queue_id" bigint default nextval('atlas.pdf_extraction_queue_queue_id_seq'::regclass) not null,
  "schema_name" character varying(128) not null,
  "raw_record_id" bigint not null,
  "source_record_id" character varying(256) not null,
  "pdf_url" character varying(512) not null,
  "extraction_status" character varying(32) default 'pending'::character varying,
  "download_attempts" integer default 0,
  "max_attempts" integer default 3,
  "last_error" text,
  "next_retry_at" timestamp with time zone,
  "extracted_text" text,
  "text_hash" character varying(64),
  "extraction_method" character varying(32),
  "extraction_confidence" numeric(3,2),
  "page_count" integer,
  "clauses_found_count" integer default 0,
  "analyzed_at" timestamp with time zone,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now()
);
create table "atlas"."provenance" (
  "id" uuid default gen_random_uuid() not null,
  "table_name" text not null,
  "record_id" uuid not null,
  "action" text not null,
  "actor_id" uuid,
  "old_data" jsonb,
  "new_data" jsonb,
  "computation_context" jsonb default '{}'::jsonb,
  "created_at" timestamp with time zone default now() not null
);
create table "atlas"."raw_benefits_wa" (
  "raw_id" bigint default nextval('atlas.raw_benefits_wa_raw_id_seq'::regclass) not null,
  "ingest_job_id" character varying(128),
  "source_record_id" character varying(256),
  "raw_payload" jsonb not null,
  "fetched_at" timestamp with time zone default now(),
  "mapped" boolean default false,
  "mapped_at" timestamp with time zone
);
create table "atlas"."raw_food_banks_king_county" (
  "raw_id" bigint default nextval('atlas.raw_food_banks_king_county_raw_id_seq'::regclass) not null,
  "ingest_job_id" character varying(128),
  "source_record_id" character varying(256),
  "raw_payload" jsonb not null,
  "fetched_at" timestamp with time zone default now(),
  "mapped" boolean default false,
  "mapped_at" timestamp with time zone
);
create table "atlas"."raw_nonprofits_wa" (
  "raw_id" bigint default nextval('atlas.raw_nonprofits_wa_raw_id_seq'::regclass) not null,
  "ingest_job_id" character varying(128),
  "source_record_id" character varying(256),
  "raw_payload" jsonb not null,
  "fetched_at" timestamp with time zone default now(),
  "mapped" boolean default false,
  "mapped_at" timestamp with time zone
);
create table "atlas"."raw_regulations_gov" (
  "raw_id" bigint default nextval('atlas.raw_regulations_gov_raw_id_seq'::regclass) not null,
  "ingest_job_id" character varying(128),
  "source_record_id" character varying(256),
  "raw_payload" jsonb not null,
  "fetched_at" timestamp with time zone default now(),
  "mapped" boolean default false,
  "mapped_at" timestamp with time zone
);
create table "atlas"."regulatory_comments" (
  "comment_id" bigint default nextval('atlas.regulatory_comments_comment_id_seq'::regclass) not null,
  "document_id" character varying(128) not null,
  "docket_id" character varying(128) not null,
  "commenter_name" character varying(512),
  "commenter_org" character varying(512),
  "comment_text" text,
  "comment_text_hash" character varying(64),
  "submitted_date" date,
  "received_date" date,
  "posted_date" date,
  "attachment_count" integer default 0,
  "source_system" character varying(128) default 'regulations.gov'::character varying,
  "raw_payload" jsonb,
  "created_at" timestamp with time zone default now()
);
create table "atlas"."regulatory_final_rules" (
  "rule_id" bigint default nextval('atlas.regulatory_final_rules_rule_id_seq'::regclass) not null,
  "docket_id" character varying(128) not null,
  "fr_document_id" character varying(128) not null,
  "rule_title" character varying(512),
  "agency_name" character varying(256),
  "publication_date" date,
  "effective_date" date,
  "rule_text" text,
  "rule_text_hash" character varying(64),
  "source_system" character varying(128) default 'regulations.gov'::character varying,
  "raw_payload" jsonb,
  "created_at" timestamp with time zone default now()
);
create table "atlas"."reparative_calculations" (
  "id" uuid default gen_random_uuid() not null,
  "corruption_indicator_id" uuid,
  "calculation_type" text not null,
  "equation_id" uuid,
  "input_variables" jsonb default '{}'::jsonb not null,
  "result_value" numeric(24,12),
  "result_currency" text default 'USD'::text,
  "confidence" numeric(5,4) not null,
  "jurisdiction" text not null,
  "applicable_statutes" text[] default '{}'::text[] not null,
  "prism_recommendation_id" uuid,
  "metadata" jsonb default '{}'::jsonb,
  "calculated_at" timestamp with time zone default now() not null,
  "created_at" timestamp with time zone default now() not null
);
create table "atlas"."schema_registry" (
  "schema_name" character varying(128) not null,
  "schema_def" jsonb default '{}'::jsonb not null,
  "connector_id" character varying(64),
  "domain_code" character varying(16),
  "entity_extraction_config" jsonb default '{}'::jsonb,
  "analyze_phase_config" jsonb,
  "is_active" boolean default true,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now()
);
create table "atlas"."school_districts" (
  "district_id" bigint default nextval('atlas.school_districts_district_id_seq'::regclass) not null,
  "leaid" character varying(16) not null,
  "district_name" character varying(512),
  "state_fips" character varying(8),
  "county_fips" character varying(8),
  "total_students" integer,
  "per_pupil_funding" numeric(10,2),
  "per_pupil_funding_prior" numeric(10,2),
  "funding_change_pct" numeric(6,2),
  "pct_free_lunch" numeric(5,2),
  "pct_ell" numeric(5,2),
  "pct_special_ed" numeric(5,2),
  "graduation_rate" numeric(5,2),
  "math_proficiency" numeric(5,2),
  "reading_proficiency" numeric(5,2),
  "source_system" character varying(128) default 'nces'::character varying,
  "raw_payload" jsonb,
  "created_at" timestamp with time zone default now()
);
create table "atlas"."signal_event_entity_resolution" (
  "resolution_id" uuid default gen_random_uuid() not null,
  "stream_id" text not null,
  "event_offset" bigint not null,
  "event_timestamp" timestamp with time zone not null,
  "signal_type" text not null,
  "source_id" text not null,
  "jurisdiction_id" text not null,
  "module_hint" text not null,
  "rule_id" text not null,
  "rule_version" text not null,
  "candidate_key" text not null,
  "entity_role" text not null,
  "source_field" text not null,
  "source_field_value" text,
  "source_entity_value" text,
  "normalized_entity_value" text,
  "source_identifier_field" text,
  "source_identifier_type" text,
  "source_identifier_value" text,
  "normalized_identifier_value" text,
  "expected_entity_type" text,
  "entity_id" character varying(128),
  "resolution_status" text not null,
  "match_method" text not null,
  "candidate_entity_ids" character varying(128)[] default (ARRAY[]::character varying[])::character varying(128)[] not null,
  "match_evidence" jsonb default '{}'::jsonb not null,
  "event_input_hash" text not null,
  "entity_index_hash" text not null,
  "rule_manifest_hash" text not null,
  "resolution_hash" text not null,
  "resolver_id" text not null,
  "resolver_version" text not null,
  "first_run_id" uuid not null,
  "last_run_id" uuid not null,
  "is_current" boolean default true not null,
  "resolved_at" timestamp with time zone default now() not null,
  "last_replayed_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null
);
create table "atlas"."signal_event_entity_resolution_rule" (
  "rule_id" text not null,
  "rule_version" text not null,
  "stream_id" text not null,
  "signal_types" text[] not null,
  "entity_role" text not null,
  "expected_entity_type" text,
  "exact_identifier_types" text[] default ARRAY[]::text[] not null,
  "name_fields" text[] default ARRAY[]::text[] not null,
  "identifier_fields" text[] default ARRAY[]::text[] not null,
  "transform" text not null,
  "rule_contract" jsonb not null,
  "rule_contract_hash" text not null,
  "rule_manifest_hash" text not null,
  "is_active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null
);
create table "atlas"."signal_event_entity_resolution_run" (
  "run_id" uuid not null,
  "resolver_id" text not null,
  "resolver_version" text not null,
  "rule_manifest_hash" text not null,
  "entity_index_hash" text not null,
  "status" text not null,
  "stream_id" text,
  "batch_size" integer not null,
  "input_manifest" jsonb default '{}'::jsonb not null,
  "manifest_hash" text not null,
  "processed_event_count" bigint default 0 not null,
  "resolution_row_count" bigint default 0 not null,
  "resolved_count" bigint default 0 not null,
  "ambiguous_count" bigint default 0 not null,
  "unresolved_count" bigint default 0 not null,
  "ignored_count" bigint default 0 not null,
  "inserted_count" bigint default 0 not null,
  "idempotent_count" bigint default 0 not null,
  "last_stream_id" text,
  "last_offset" bigint,
  "error_message" text,
  "started_at" timestamp with time zone default now() not null,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null
);
create table "atlas"."signal_event_identity" (
  "stream_id" text not null,
  "event_identity_hash" text not null,
  "canonical_offset" bigint not null,
  "latest_historical_offset" bigint not null,
  "historical_event_count" bigint default 1 not null,
  "replay_count" bigint default 0 not null,
  "source_record_key" text not null,
  "first_seen_at" timestamp with time zone not null,
  "last_seen_at" timestamp with time zone not null,
  "source_timestamp" timestamp with time zone not null,
  "signal_type" text not null,
  "source_id" text not null,
  "jurisdiction_id" text not null,
  "module_hint" text not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table "atlas"."signal_event_ingest_run" (
  "run_id" uuid default gen_random_uuid() not null,
  "stream_id" text,
  "status" text not null,
  "records_seen" integer default 0 not null,
  "events_inserted" integer default 0 not null,
  "replays_suppressed" integer default 0 not null,
  "cursor_before" bigint,
  "cursor_after" bigint,
  "partial_completion" boolean default false not null,
  "error_message" text,
  "started_at" timestamp with time zone default now() not null,
  "completed_at" timestamp with time zone
);
create table "atlas"."signal_extractions" (
  "id" uuid default gen_random_uuid() not null,
  "signal_id" uuid not null,
  "extraction_method" text not null,
  "extraction_config" jsonb default '{}'::jsonb not null,
  "input_data" jsonb default '{}'::jsonb not null,
  "output_data" jsonb default '{}'::jsonb not null,
  "processing_time_ms" integer,
  "extractor_version" text,
  "created_at" timestamp with time zone default now() not null
);
create table "atlas"."signal_types" (
  "id" uuid default gen_random_uuid() not null,
  "type_code" text not null,
  "type_name" text not null,
  "category" text not null,
  "detection_method" text not null,
  "severity_scale" integer default 1 not null,
  "equation_id" uuid,
  "fingerprint_template" jsonb default '{}'::jsonb,
  "description" text,
  "is_active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null
);
create table "atlas"."signals" (
  "id" uuid default gen_random_uuid() not null,
  "signal_type_id" uuid not null,
  "source_domain" text not null,
  "source_table" text not null,
  "source_record_id" uuid not null,
  "source_jurisdiction" text,
  "raw_value" jsonb default '{}'::jsonb not null,
  "normalized_score" numeric(8,6) not null,
  "confidence" numeric(5,4) not null,
  "severity" integer,
  "detected_at" timestamp with time zone default now() not null,
  "expires_at" timestamp with time zone,
  "fingerprint_hash" text,
  "metadata" jsonb default '{}'::jsonb,
  "is_suppressed" boolean default false not null,
  "suppression_reason" text,
  "created_at" timestamp with time zone default now() not null
);
create table "atlas"."utility_rate_cases" (
  "rate_id" bigint default nextval('atlas.utility_rate_cases_rate_id_seq'::regclass) not null,
  "docket_number" character varying(128) not null,
  "utility_name" character varying(512),
  "utility_id" character varying(128),
  "jurisdiction" character varying(128) not null,
  "service_territory" character varying(256),
  "rate_type" character varying(64),
  "approved_rate" numeric(10,6),
  "previous_rate" numeric(10,6),
  "rate_change_pct" numeric(6,2),
  "effective_date" date,
  "census_tracts" jsonb,
  "source_system" character varying(128),
  "raw_payload" jsonb,
  "created_at" timestamp with time zone default now()
);
create table "atlas"."variables" (
  "id" uuid default gen_random_uuid() not null,
  "variable_name" text not null,
  "symbol" text not null,
  "data_type" text not null,
  "default_value" jsonb,
  "domain" text default 'universal'::text not null,
  "source_table" text,
  "source_column" text,
  "description" text,
  "created_at" timestamp with time zone default now() not null
);
create table "atlas"."water_systems" (
  "system_id" bigint default nextval('atlas.water_systems_system_id_seq'::regclass) not null,
  "pwsid" character varying(16) not null,
  "system_name" character varying(512),
  "city" character varying(128),
  "state" character varying(8),
  "county" character varying(128),
  "population_served" integer,
  "sdwa_violation_count" integer,
  "last_violation_date" date,
  "infrastructure_condition_score" integer,
  "bond_debt_outstanding" numeric(15,2),
  "bond_debt_per_capita" numeric(10,2),
  "source_system" character varying(128) default 'epa_sdwis'::character varying,
  "raw_payload" jsonb,
  "created_at" timestamp with time zone default now()
);
create table "private"."lighthouse_stream_export_allowlist" (
  "stream_id" text not null,
  "export_enabled" boolean default true not null,
  "added_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table "public"."agency_metrics" (
  "id" uuid default gen_random_uuid() not null,
  "entity_id" text not null,
  "agency_name" text not null,
  "agency_type" text,
  "jurisdiction" text,
  "metric_type" text not null,
  "metric_value" numeric,
  "period" text,
  "source" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table "public"."agency_registry_canonical" (
  "agency_id" text not null,
  "canonical_name" text not null,
  "aliases" jsonb default '[]'::jsonb,
  "jurisdiction_id" text,
  "agency_type" text,
  "domains" jsonb default '[]'::jsonb,
  "submission_methods" jsonb default '[]'::jsonb,
  "official_urls" jsonb default '[]'::jsonb,
  "appeal_urls" jsonb default '[]'::jsonb,
  "api_endpoints" jsonb default '[]'::jsonb,
  "source_verification" text default 'seed_unverified'::text,
  "created_at" timestamp with time zone default now()
);
create table "public"."atlas_action_receipt" (
  "action_receipt_hash" text not null,
  "action_type" text not null,
  "initiator" text not null,
  "target_id" text,
  "requested_at" timestamp with time zone not null,
  "completed_at" timestamp with time zone not null,
  "outcome_status" text not null,
  "before_event_count" bigint,
  "after_event_count" bigint,
  "event_delta" bigint,
  "request_json" jsonb default '{}'::jsonb not null,
  "result_json" jsonb default '{}'::jsonb not null,
  "engine_version" text not null,
  "created_at" timestamp with time zone default now() not null
);
create table "public"."atlas_source_fallback_binding" (
  "connector_id" uuid not null,
  "fallback_connector_id" uuid not null,
  "fallback_priority" integer not null,
  "fallback_reason" text not null,
  "active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table "public"."atlas_source_health_event" (
  "health_event_id" uuid default gen_random_uuid() not null,
  "connector_id" uuid not null,
  "schema_id" uuid,
  "observed_at" timestamp with time zone not null,
  "health_status" text not null,
  "freshness_status" text not null,
  "schema_status" text not null,
  "latency_ms" integer,
  "error_rate" numeric(7,6),
  "duplicate_rate" numeric(7,6),
  "missing_required_field_rate" numeric(7,6),
  "records_observed" integer,
  "source_state_hash" text not null,
  "details" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null
);
create table "public"."atlas_source_schema_snapshot" (
  "schema_snapshot_id" uuid default gen_random_uuid() not null,
  "connector_id" uuid not null,
  "schema_id" uuid,
  "captured_at" timestamp with time zone not null,
  "schema_version" text,
  "schema_hash" text not null,
  "schema_payload" jsonb not null,
  "detected_change_type" text not null,
  "created_at" timestamp with time zone default now() not null
);
create table "public"."canonical_extracted_records" (
  "id" uuid default gen_random_uuid() not null,
  "external_record_id" text,
  "entity_type" text,
  "record_kind" text default 'unknown'::text not null,
  "record_name" text default 'unnamed_record'::text not null,
  "jurisdiction" text,
  "category" text,
  "registry_layer" text,
  "signal_families" text[] default '{}'::text[] not null,
  "source_file" text,
  "source_path" text,
  "source_anchor" text,
  "source_url" text,
  "source_hash" text,
  "provenance_hash" text not null,
  "raw_text" text default ''::text not null,
  "verbatim_text" text default ''::text not null,
  "canonical_payload" jsonb default '{}'::jsonb not null,
  "facts" jsonb default '{}'::jsonb not null,
  "contacts" jsonb default '{}'::jsonb not null,
  "relationships" jsonb default '{}'::jsonb not null,
  "legal_basis" jsonb default '{}'::jsonb not null,
  "escalation_paths" jsonb default '{}'::jsonb not null,
  "usefulness_status" text default 'unchecked'::text not null,
  "verification_status" text default 'needs_review'::text not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table "public"."case_law" (
  "id" uuid default extensions.uuid_generate_v4() not null,
  "jurisdiction_id" uuid,
  "external_id" character varying(255) not null,
  "case_name" text,
  "court" character varying(255),
  "court_id" character varying(100),
  "decision_date" date,
  "citation" character varying(255),
  "docket_number" character varying(100),
  "case_type" character varying(50),
  "text" text,
  "status" character varying(20) default 'published'::character varying,
  "source_url" text,
  "metadata" jsonb default '{}'::jsonb,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now()
);
create table "public"."civic_infrastructure_nodes" (
  "id" bigint default nextval('civic_infrastructure_nodes_id_seq'::regclass) not null,
  "canonical_resource_id" text not null,
  "organization_name" text not null,
  "organization_type" text,
  "jurisdiction" text,
  "domains" text[] default '{}'::text[],
  "website" text,
  "phone" text,
  "office_address" text,
  "filing_process" text,
  "filing_deadline" text,
  "statutory_authority" text,
  "verification_status" text default 'unverified'::text,
  "created_at" timestamp with time zone default now()
);
create table "public"."civic_map_resources" (
  "id" uuid default gen_random_uuid() not null,
  "name" text not null,
  "resource_type" text not null,
  "address" text,
  "city" text,
  "state" text,
  "phone" text,
  "url" text,
  "lat" numeric(10,7),
  "lon" numeric(10,7),
  "source_table" text not null,
  "source_id" text,
  "extra_json" jsonb,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table "public"."connector_registry" (
  "id" uuid default extensions.uuid_generate_v4() not null,
  "name" character varying(100) not null,
  "api_base_url" text not null,
  "adapter_class" character varying(100) not null,
  "auth_type" character varying(20) default 'none'::character varying,
  "auth_config" jsonb default '{}'::jsonb,
  "rate_limit_rpm" integer default 60,
  "pagination_type" character varying(20) default 'cursor'::character varying,
  "pagination_config" jsonb default '{}'::jsonb,
  "schedule_cron" character varying(50),
  "jurisdiction_filter" jsonb default '{}'::jsonb,
  "schema_id" uuid,
  "active" boolean default true,
  "last_run_at" timestamp with time zone,
  "next_run_at" timestamp with time zone,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now()
);
create table "public"."cursors" (
  "cursor_id" text not null,
  "stream_id" text not null,
  "name" text not null,
  "current_offset" bigint default 0 not null,
  "created_by" text not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table "public"."extraction_candidates" (
  "id" uuid default gen_random_uuid() not null,
  "source_file" text,
  "source_path" text,
  "source_type" text,
  "source_anchor" text,
  "source_hash" text not null,
  "extraction_run_id" text,
  "extractor_id" text,
  "extractor_version" text,
  "raw_text" text not null,
  "extracted_payload" jsonb default '{}'::jsonb not null,
  "candidate_kind" text,
  "signal_families" text[] default '{}'::text[] not null,
  "layer" text,
  "confidence" numeric,
  "created_at" timestamp with time zone default now() not null
);
create table "public"."ingest_jobs" (
  "id" uuid default extensions.uuid_generate_v4() not null,
  "connector_id" uuid not null,
  "schema_id" uuid,
  "status" character varying(20) default 'pending'::character varying,
  "started_at" timestamp with time zone default now(),
  "completed_at" timestamp with time zone,
  "records_fetched" integer default 0,
  "records_inserted" integer default 0,
  "records_updated" integer default 0,
  "records_failed" integer default 0,
  "records_deduplicated" integer default 0,
  "next_cursor" text,
  "error_log" jsonb default '{}'::jsonb,
  "metadata" jsonb default '{}'::jsonb
);
create table "public"."investigative_jobs" (
  "job_id" text not null,
  "job_type" text not null,
  "stream_id" text,
  "cursor_id" text,
  "status" text not null,
  "params" jsonb default '{}'::jsonb not null,
  "result" jsonb default '{}'::jsonb not null,
  "error" text,
  "function_id" text,
  "created_at" timestamp with time zone default now() not null,
  "completed_at" timestamp with time zone
);
create table "public"."jurisdictions" (
  "id" uuid default gen_random_uuid() not null,
  "geo_id" text not null,
  "geo_type" text not null,
  "geo_name" text not null,
  "state_fips" text,
  "county_fips" text,
  "parent_id" text,
  "lat" numeric(10,7),
  "lon" numeric(10,7),
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table "public"."jurisdictions_registry" (
  "jurisdiction_id" text not null,
  "jurisdiction_type" text not null,
  "canonical_name" text not null,
  "abbreviation" text,
  "fips_code" text,
  "parent_jurisdiction" text,
  "aliases" jsonb default '[]'::jsonb,
  "timezone" text,
  "source_verification" text default 'seed_unverified'::text,
  "active_status" boolean default true,
  "created_at" timestamp with time zone default now()
);
create table "public"."prime_patterns" (
  "pattern_id" text not null,
  "pattern_type" text not null,
  "module" text not null,
  "jurisdiction" text not null,
  "stream_id" text,
  "job_id" text,
  "confidence" numeric default 0 not null,
  "severity" text default 'info'::text not null,
  "detected_at" timestamp with time zone default now() not null,
  "summary" text not null,
  "evidence" jsonb default '{}'::jsonb not null,
  "payload" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null
);
create table "public"."raw_records" (
  "id" uuid default extensions.uuid_generate_v4() not null,
  "connector_id" uuid not null,
  "external_id" character varying(255) not null,
  "raw_payload" jsonb not null,
  "sha256_hash" character varying(64) not null,
  "fetch_timestamp" timestamp with time zone default now(),
  "process_status" character varying(20) default 'pending'::character varying,
  "processed_at" timestamp with time zone,
  "error_message" text
);
create table "public"."registry_conflict_log" (
  "id" bigint generated always as identity not null,
  "conflict_type" text not null,
  "authority_a" text,
  "authority_b" text,
  "entity_key" text,
  "conflict_payload" jsonb default '{}'::jsonb,
  "detected_at" timestamp with time zone default now(),
  "resolved" boolean default false
);
create table "public"."schema_registry" (
  "id" uuid default extensions.uuid_generate_v4() not null,
  "name" character varying(100) not null,
  "version" character varying(10) default '1.0'::character varying,
  "target_table" character varying(100) not null,
  "source_type" character varying(50) not null,
  "field_mappings" jsonb default '{}'::jsonb not null,
  "validation_rules" jsonb default '{}'::jsonb,
  "transform_logic" jsonb default '{}'::jsonb,
  "entity_extraction_config" jsonb default '{}'::jsonb,
  "signal_generation_config" jsonb default '{}'::jsonb,
  "active" boolean default true,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now()
);
create table "public"."signal_definitions" (
  "id" uuid default gen_random_uuid() not null,
  "rule_id" text not null,
  "rule_name" text not null,
  "domain" text,
  "severity_default" text default 'medium'::text not null,
  "description" text,
  "enabled" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table "public"."signal_events" (
  "stream_id" text not null,
  "offset" bigint not null,
  "timestamp" timestamp with time zone not null,
  "signal_type" text not null,
  "spacetime" jsonb not null,
  "provenance" jsonb not null,
  "payload" jsonb default '{}'::jsonb not null,
  "source_id" text not null,
  "jurisdiction_id" text not null,
  "module_hint" text not null,
  "ingested_at" timestamp with time zone default now() not null,
  "event_identity_hash" text
);
create table "public"."statutes" (
  "id" uuid default extensions.uuid_generate_v4() not null,
  "jurisdiction_id" uuid,
  "external_id" character varying(255) not null,
  "title" text,
  "citation" character varying(255),
  "identifier" character varying(100),
  "classification" character varying(100),
  "subject" jsonb default '[]'::jsonb,
  "text" text,
  "summary" text,
  "effective_date" date,
  "status" character varying(20) default 'active'::character varying,
  "source_url" text,
  "metadata" jsonb default '{}'::jsonb,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "jurisdiction" text
);
create table "public"."streams" (
  "stream_id" text not null,
  "source_id" text not null,
  "jurisdiction_id" text not null,
  "module_hint" text not null,
  "throughput_profile" text not null,
  "safety_profile" text not null,
  "governance_contract_id" text not null,
  "status" text not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table "public"."verification_claims" (
  "id" uuid default gen_random_uuid() not null,
  "candidate_id" uuid,
  "claim_hash" text not null,
  "claim_type" text not null,
  "subject" text,
  "predicate" text,
  "object_value" text,
  "normalized_payload" jsonb default '{}'::jsonb not null,
  "jurisdiction" text,
  "effective_date" date,
  "expiration_date" date,
  "verification_status" text default 'pending'::text not null,
  "verification_score" numeric default 0 not null,
  "conflict_status" text default 'unchecked'::text not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table "public"."verification_evidence" (
  "id" uuid default gen_random_uuid() not null,
  "claim_id" uuid not null,
  "verification_source_id" uuid,
  "evidence_kind" text not null,
  "evidence_text" text,
  "evidence_url" text,
  "evidence_hash" text not null,
  "supports_claim" boolean,
  "contradiction_note" text,
  "checked_at" timestamp with time zone default now() not null
);
create table "public"."verification_sources" (
  "id" uuid default gen_random_uuid() not null,
  "source_name" text not null,
  "source_url" text,
  "source_type" text not null,
  "jurisdiction" text,
  "authority_tier" text default 'unknown'::text not null,
  "freshness_policy" text,
  "trust_weight" numeric default 0.50 not null,
  "verification_notes" text,
  "created_at" timestamp with time zone default now() not null
);
create table "public"."verified_chronicle" (
  "id" uuid default gen_random_uuid() not null,
  "claim_id" uuid not null,
  "chronicle_hash" text not null,
  "chronicle_kind" text not null,
  "title" text,
  "body" text,
  "jurisdiction" text,
  "entity_name" text,
  "entity_type" text,
  "signal_families" text[] default '{}'::text[] not null,
  "source_count" integer default 0 not null,
  "verification_score" numeric not null,
  "verified_at" timestamp with time zone default now() not null,
  "valid_from" date,
  "valid_until" date,
  "provenance" jsonb default '{}'::jsonb not null,
  "immutable_payload" jsonb default '{}'::jsonb not null
);
create table "public"."workflow_registry" (
  "workflow_id" text not null,
  "workflow_category" text not null,
  "jurisdiction_scope" text default 'multi_jurisdiction'::text,
  "trigger_conditions" jsonb default '[]'::jsonb,
  "required_forms" jsonb default '[]'::jsonb,
  "appeal_deadlines" jsonb default '[]'::jsonb,
  "escalation_paths" jsonb default '[]'::jsonb,
  "governing_authorities" jsonb default '[]'::jsonb,
  "cross_jurisdiction_equivalents" jsonb default '[]'::jsonb,
  "created_at" timestamp with time zone default now()
);

-- ---- non-foreign-key constraints ----
alter table only "atlas"."action_queue" add constraint "action_queue_pkey" PRIMARY KEY (action_id);
alter table only "atlas"."action_queue" add constraint "action_queue_status_check" CHECK (status::text = ANY (ARRAY['pending'::character varying, 'processing'::character varying, 'completed'::character varying, 'failed'::character varying, 'cancelled'::character varying]::text[]));
alter table only "atlas"."atlas_case_links" add constraint "atlas_case_links_atlas_convergence_event_id_prism_case_id_key" UNIQUE (atlas_convergence_event_id, prism_case_id);
alter table only "atlas"."atlas_case_links" add constraint "atlas_case_links_link_type_check" CHECK (link_type = ANY (ARRAY['auto_detected'::text, 'manual'::text, 'escalation_triggered'::text, 'correlation'::text]));
alter table only "atlas"."atlas_case_links" add constraint "atlas_case_links_pkey" PRIMARY KEY (id);
alter table only "atlas"."atlas_escalation_links" add constraint "atlas_escalation_links_atlas_convergence_event_id_prism_esc_key" UNIQUE (atlas_convergence_event_id, prism_escalation_id);
alter table only "atlas"."atlas_escalation_links" add constraint "atlas_escalation_links_pkey" PRIMARY KEY (id);
alter table only "atlas"."benefits_offices" add constraint "benefits_offices_pkey" PRIMARY KEY (office_id, source_system);
alter table only "atlas"."bridge_config" add constraint "bridge_config_pkey" PRIMARY KEY (bridge_id);
alter table only "atlas"."bridge_operational_audit" add constraint "bridge_operational_audit_pkey" PRIMARY KEY (audit_id);
alter table only "atlas"."bridge_sync_log" add constraint "bridge_sync_log_pkey" PRIMARY KEY (log_id);
alter table only "atlas"."census_city_data" add constraint "census_city_data_city_name_state_fips_acs_year_key" UNIQUE (city_name, state_fips, acs_year);
alter table only "atlas"."census_city_data" add constraint "census_city_data_pkey" PRIMARY KEY (city_id);
alter table only "atlas"."census_tract_data" add constraint "census_tract_data_pkey" PRIMARY KEY (tract_id);
alter table only "atlas"."census_tract_data" add constraint "census_tract_data_tract_geoid_acs_year_key" UNIQUE (tract_geoid, acs_year);
alter table only "atlas"."civic_genome_external_snapshot" add constraint "civic_genome_external_snapshot_atlas_binding_hash_check" CHECK (atlas_binding_hash ~ '^[0-9a-f]{64}$'::text);
alter table only "atlas"."civic_genome_external_snapshot" add constraint "civic_genome_external_snapshot_component_count_check" CHECK (component_count >= 0);
alter table only "atlas"."civic_genome_external_snapshot" add constraint "civic_genome_external_snapshot_delivery_receipt_hash_check" CHECK (delivery_receipt_hash ~ '^[0-9a-f]{64}$'::text);
alter table only "atlas"."civic_genome_external_snapshot" add constraint "civic_genome_external_snapshot_deterministic_replay_key_check" CHECK (deterministic_replay_key ~ '^[0-9a-f]{64}$'::text);
alter table only "atlas"."civic_genome_external_snapshot" add constraint "civic_genome_external_snapshot_pkey" PRIMARY KEY (source_snapshot_id);
alter table only "atlas"."civic_genome_external_snapshot" add constraint "civic_genome_external_snapshot_snapshot_kind_check" CHECK (snapshot_kind = 'baseline_export'::text);
alter table only "atlas"."civic_genome_external_snapshot" add constraint "civic_genome_external_snapshot_source_export_receipt_hash_check" CHECK (source_export_receipt_hash ~ '^[0-9a-f]{64}$'::text);
alter table only "atlas"."civic_genome_external_snapshot" add constraint "civic_genome_external_snapshot_source_owner_check" CHECK (source_owner = 'lighthouse/civic_genome'::text);
alter table only "atlas"."civic_genome_external_snapshot" add constraint "civic_genome_external_snapshot_source_snapshot_hash_check" CHECK (source_snapshot_hash ~ '^[0-9a-f]{64}$'::text);
alter table only "atlas"."civic_genome_external_snapshot" add constraint "civic_genome_external_snapshot_source_snapshot_hash_key" UNIQUE (source_snapshot_hash);
alter table only "atlas"."civic_genome_legislative_projection_run" add constraint "civic_genome_legislative_projection__source_snapshot_hash_check" CHECK (source_snapshot_hash ~ '^[0-9a-f]{64}$'::text);
alter table only "atlas"."civic_genome_legislative_projection_run" add constraint "civic_genome_legislative_projection__source_version_count_check" CHECK (source_version_count >= 0);
alter table only "atlas"."civic_genome_legislative_projection_run" add constraint "civic_genome_legislative_projection_ru_replays_suppressed_check" CHECK (replays_suppressed >= 0);
alter table only "atlas"."civic_genome_legislative_projection_run" add constraint "civic_genome_legislative_projection_run_events_inserted_check" CHECK (events_inserted >= 0);
alter table only "atlas"."civic_genome_legislative_projection_run" add constraint "civic_genome_legislative_projection_run_mapping_rule_hash_check" CHECK (mapping_rule_hash ~ '^[0-9a-f]{64}$'::text);
alter table only "atlas"."civic_genome_legislative_projection_run" add constraint "civic_genome_legislative_projection_run_observation_count_check" CHECK (observation_count >= 0);
alter table only "atlas"."civic_genome_legislative_projection_run" add constraint "civic_genome_legislative_projection_run_observation_hash_check" CHECK (observation_hash ~ '^[0-9a-f]{64}$'::text);
alter table only "atlas"."civic_genome_legislative_projection_run" add constraint "civic_genome_legislative_projection_run_pkey" PRIMARY KEY (projection_key);
alter table only "atlas"."civic_genome_legislative_projection_run" add constraint "civic_genome_legislative_projection_run_projection_key_check" CHECK (projection_key ~ '^[0-9a-f]{64}$'::text);
alter table only "atlas"."civic_genome_legislative_projection_run" add constraint "civic_genome_legislative_projection_run_status_check" CHECK (status = 'completed'::text);
alter table only "atlas"."civic_genome_legislative_projection_run" add constraint "civic_genome_legislative_projection_version_manifest_hash_check" CHECK (version_manifest_hash ~ '^[0-9a-f]{64}$'::text);
alter table only "atlas"."civic_genome_legislative_trait_binding_accounting" add constraint "civic_genome_legislative_tra_exact_version_bound_trait_co_check" CHECK (exact_version_bound_trait_count >= 0);
alter table only "atlas"."civic_genome_legislative_trait_binding_accounting" add constraint "civic_genome_legislative_tra_historical_same_source_trait_check" CHECK (historical_same_source_trait_count >= 0);
alter table only "atlas"."civic_genome_legislative_trait_binding_accounting" add constraint "civic_genome_legislative_trai_projection_key_accounting_rul_key" UNIQUE (projection_key, accounting_rule_hash);
alter table only "atlas"."civic_genome_legislative_trait_binding_accounting" add constraint "civic_genome_legislative_trait_bin_unresolved_trait_count_check" CHECK (unresolved_trait_count >= 0);
alter table only "atlas"."civic_genome_legislative_trait_binding_accounting" add constraint "civic_genome_legislative_trait_bindi_accounting_rule_hash_check" CHECK (accounting_rule_hash ~ '^[0-9a-f]{64}$'::text);
alter table only "atlas"."civic_genome_legislative_trait_binding_accounting" add constraint "civic_genome_legislative_trait_bindi_source_snapshot_hash_check" CHECK (source_snapshot_hash ~ '^[0-9a-f]{64}$'::text);
alter table only "atlas"."civic_genome_legislative_trait_binding_accounting" add constraint "civic_genome_legislative_trait_binding__total_trait_count_check" CHECK (total_trait_count >= 0);
alter table only "atlas"."civic_genome_legislative_trait_binding_accounting" add constraint "civic_genome_legislative_trait_binding_ac_accounting_hash_check" CHECK (accounting_hash ~ '^[0-9a-f]{64}$'::text);
alter table only "atlas"."civic_genome_legislative_trait_binding_accounting" add constraint "civic_genome_legislative_trait_binding_accounting_pkey" PRIMARY KEY (accounting_hash);
alter table only "atlas"."civic_genome_legislative_trait_binding_accounting" add constraint "civic_genome_legislative_trait_binding_completeness_state_check" CHECK (completeness_state = ANY (ARRAY['complete'::text, 'incomplete'::text]));
alter table only "atlas"."civic_genome_legislative_trait_binding_accounting" add constraint "civic_genome_trait_accounting_counts_match" CHECK (total_trait_count = (exact_version_bound_trait_count + historical_same_source_trait_count + unresolved_trait_count));
alter table only "atlas"."civic_map_signals" add constraint "civic_map_signals_pkey" PRIMARY KEY (signal_id);
alter table only "atlas"."clause_patterns" add constraint "clause_patterns_pkey" PRIMARY KEY (pattern_id);
alter table only "atlas"."connector_registry" add constraint "connector_registry_pkey" PRIMARY KEY (connector_id);
alter table only "atlas"."contact_registry" add constraint "contact_registry_contact_type_check" CHECK (contact_type::text = ANY (ARRAY['phone'::character varying, 'email'::character varying, 'website'::character varying, 'physical_address'::character varying, 'mailing_address'::character varying, 'fax'::character varying]::text[]));
alter table only "atlas"."contact_registry" add constraint "contact_registry_entity_id_contact_type_contact_value_key" UNIQUE (entity_id, contact_type, contact_value);
alter table only "atlas"."contact_registry" add constraint "contact_registry_pkey" PRIMARY KEY (contact_id);
alter table only "atlas"."contract_clauses" add constraint "contract_clauses_contract_id_pattern_id_char_offset_key" UNIQUE (contract_id, pattern_id, char_offset);
alter table only "atlas"."contract_clauses" add constraint "contract_clauses_pkey" PRIMARY KEY (clause_id);
alter table only "atlas"."contract_clauses" add constraint "contract_clauses_status_check" CHECK (status::text = ANY (ARRAY['pending'::character varying, 'confirmed'::character varying, 'false_positive'::character varying, 'disputed'::character varying]::text[]));
alter table only "atlas"."convergence_events" add constraint "convergence_events_pkey" PRIMARY KEY (id);
alter table only "atlas"."convergence_events" add constraint "convergence_events_status_check" CHECK (status = ANY (ARRAY['open'::text, 'verified'::text, 'disputed'::text, 'closed'::text, 'escalated'::text]));
alter table only "atlas"."convergence_patterns" add constraint "convergence_patterns_pkey" PRIMARY KEY (id);
alter table only "atlas"."convergence_receipt" add constraint "convergence_receipt_configuration_hash_check" CHECK (configuration_hash ~ '^[a-f0-9]{64}$'::text);
alter table only "atlas"."convergence_receipt" add constraint "convergence_receipt_geography_registry_version_check" CHECK (geography_registry_version ~ '^[a-f0-9]{64}$'::text);
alter table only "atlas"."convergence_receipt" add constraint "convergence_receipt_input_hash_check" CHECK (input_hash ~ '^[a-f0-9]{64}$'::text);
alter table only "atlas"."convergence_receipt" add constraint "convergence_receipt_observed_count_check" CHECK (observed_count >= 0);
alter table only "atlas"."convergence_receipt" add constraint "convergence_receipt_output_hash_check" CHECK (output_hash ~ '^[a-f0-9]{64}$'::text);
alter table only "atlas"."convergence_receipt" add constraint "convergence_receipt_pkey" PRIMARY KEY (run_key, geography_id);
alter table only "atlas"."convergence_receipt" add constraint "convergence_receipt_receipt_identity_check" CHECK (receipt_identity ~ '^[a-f0-9]{64}$'::text);
alter table only "atlas"."convergence_receipt" add constraint "convergence_receipt_receipt_identity_key" UNIQUE (receipt_identity);
alter table only "atlas"."convergence_receipt" add constraint "convergence_receipt_rule_manifest_hash_check" CHECK (rule_manifest_hash ~ '^[a-f0-9]{64}$'::text);
alter table only "atlas"."convergence_receipt" add constraint "convergence_receipt_source_population_hash_check" CHECK (source_population_hash ~ '^[a-f0-9]{64}$'::text);
alter table only "atlas"."convergence_receipt" add constraint "convergence_receipt_status_check" CHECK (status = ANY (ARRAY['resolved'::text, 'unresolved'::text, 'below_threshold'::text]));
alter table only "atlas"."convergence_result_payload" add constraint "convergence_result_payload_output_hash_check" CHECK (output_hash ~ '^[a-f0-9]{64}$'::text);
alter table only "atlas"."convergence_result_payload" add constraint "convergence_result_payload_pkey" PRIMARY KEY (run_key);
alter table only "atlas"."convergence_result_payload" add constraint "convergence_result_payload_receipt_count_check" CHECK (receipt_count > 0);
alter table only "atlas"."convergence_run_manifest" add constraint "convergence_run_manifest_analysis_registry_hash_check" CHECK (analysis_registry_hash ~ '^[a-f0-9]{64}$'::text);
alter table only "atlas"."convergence_run_manifest" add constraint "convergence_run_manifest_check" CHECK (receipt_count = total_geographies);
alter table only "atlas"."convergence_run_manifest" add constraint "convergence_run_manifest_configuration_hash_check" CHECK (configuration_hash ~ '^[a-f0-9]{64}$'::text);
alter table only "atlas"."convergence_run_manifest" add constraint "convergence_run_manifest_deduplicated_population_hash_check" CHECK (deduplicated_population_hash ~ '^[a-f0-9]{64}$'::text);
alter table only "atlas"."convergence_run_manifest" add constraint "convergence_run_manifest_geography_registry_version_check" CHECK (geography_registry_version ~ '^[a-f0-9]{64}$'::text);
alter table only "atlas"."convergence_run_manifest" add constraint "convergence_run_manifest_output_hash_check" CHECK (output_hash ~ '^[a-f0-9]{64}$'::text);
alter table only "atlas"."convergence_run_manifest" add constraint "convergence_run_manifest_pkey" PRIMARY KEY (run_key);
alter table only "atlas"."convergence_run_manifest" add constraint "convergence_run_manifest_rule_manifest_hash_check" CHECK (rule_manifest_hash ~ '^[a-f0-9]{64}$'::text);
alter table only "atlas"."convergence_run_manifest" add constraint "convergence_run_manifest_run_key_check" CHECK (run_key ~ '^[a-f0-9]{64}$'::text);
alter table only "atlas"."convergence_run_manifest" add constraint "convergence_run_manifest_source_population_hash_check" CHECK (source_population_hash ~ '^[a-f0-9]{64}$'::text);
alter table only "atlas"."convergence_run_manifest" add constraint "convergence_run_manifest_temporal_bucket_ms_check" CHECK (temporal_bucket_ms > 0);
alter table only "atlas"."convergence_run_manifest" add constraint "convergence_run_manifest_time_window_ms_check" CHECK (time_window_ms > 0);
alter table only "atlas"."convergence_run_manifest" add constraint "convergence_run_manifest_total_geographies_check" CHECK (total_geographies > 0);
alter table only "atlas"."convergence_run_manifest" add constraint "convergence_run_manifest_total_signals_deduplicated_check" CHECK (total_signals_deduplicated >= 0);
alter table only "atlas"."convergence_run_manifest" add constraint "convergence_run_manifest_total_signals_raw_check" CHECK (total_signals_raw >= 0);
alter table only "atlas"."convergence_run_manifest" add constraint "convergence_run_manifest_total_source_rows_check" CHECK (total_source_rows >= 0);
alter table only "atlas"."convergence_run_manifest" add constraint "convergence_run_manifest_transformed_population_hash_check" CHECK (transformed_population_hash ~ '^[a-f0-9]{64}$'::text);
alter table only "atlas"."convergence_signal_snapshot" add constraint "convergence_signal_snapshot_pkey" PRIMARY KEY (run_key, snapshot_type);
alter table only "atlas"."convergence_signal_snapshot" add constraint "convergence_signal_snapshot_population_hash_check" CHECK (population_hash ~ '^[a-f0-9]{64}$'::text);
alter table only "atlas"."convergence_signal_snapshot" add constraint "convergence_signal_snapshot_record_count_check" CHECK (record_count >= 0);
alter table only "atlas"."convergence_signal_snapshot" add constraint "convergence_signal_snapshot_snapshot_type_check" CHECK (snapshot_type = ANY (ARRAY['source'::text, 'transformed'::text, 'deduplicated'::text]));
alter table only "atlas"."corruption_indicators" add constraint "corruption_indicators_indicator_type_check" CHECK (indicator_type = ANY (ARRAY['financial_anomaly'::text, 'procedural_violation'::text, 'conflict_of_interest'::text, 'jurisdictional_failure'::text, 'document_falsification'::text, 'retaliation_pattern'::text, 'benefit_denial'::text, 'evidence_suppression'::text, 'timeline_manipulation'::text]));
alter table only "atlas"."corruption_indicators" add constraint "corruption_indicators_pkey" PRIMARY KEY (id);
alter table only "atlas"."corruption_indicators" add constraint "corruption_indicators_severity_check" CHECK (severity >= 1 AND severity <= 10);
alter table only "atlas"."corruption_indicators" add constraint "corruption_indicators_status_check" CHECK (status = ANY (ARRAY['unverified'::text, 'under_review'::text, 'confirmed'::text, 'disputed'::text, 'resolved'::text]));
alter table only "atlas"."court_cases" add constraint "court_cases_case_number_court_id_source_system_key" UNIQUE (case_number, court_id, source_system);
alter table only "atlas"."court_cases" add constraint "court_cases_pkey" PRIMARY KEY (case_id);
alter table only "atlas"."detection_rules" add constraint "detection_rules_pkey" PRIMARY KEY (rule_id);
alter table only "atlas"."detection_rules" add constraint "detection_rules_rule_type_check" CHECK (rule_type::text = ANY (ARRAY['intra_jurisdiction'::character varying, 'cross_jurisdiction'::character varying, 'convergent_failure'::character varying]::text[]));
alter table only "atlas"."discovery_platforms" add constraint "discovery_platforms_pkey" PRIMARY KEY (platform_id);
alter table only "atlas"."discovery_platforms" add constraint "discovery_platforms_platform_type_check" CHECK (platform_type::text = ANY (ARRAY['socrata'::character varying, 'ckan'::character varying, 'esri'::character varying, 'static_api'::character varying, 'rss'::character varying, 'ftp'::character varying, 'airtable'::character varying, 'unknown'::character varying]::text[]));
alter table only "atlas"."domain_configs" add constraint "domain_configs_domain_id_config_key_key" UNIQUE (domain_id, config_key);
alter table only "atlas"."domain_configs" add constraint "domain_configs_pkey" PRIMARY KEY (id);
alter table only "atlas"."domain_registry" add constraint "domain_registry_pkey" PRIMARY KEY (domain_code);
alter table only "atlas"."domains" add constraint "domains_domain_code_key" UNIQUE (domain_code);
alter table only "atlas"."domains" add constraint "domains_pkey" PRIMARY KEY (id);
alter table only "atlas"."endpoint_probe_queue" add constraint "endpoint_probe_queue_pkey" PRIMARY KEY (queue_id);
alter table only "atlas"."endpoint_probe_queue" add constraint "endpoint_probe_queue_platform_id_jurisdiction_dataset_id_key" UNIQUE (platform_id, jurisdiction, dataset_id);
alter table only "atlas"."endpoint_probe_queue" add constraint "endpoint_probe_queue_probe_status_check" CHECK (probe_status::text = ANY (ARRAY['pending'::character varying, 'probing'::character varying, 'healthy'::character varying, 'broken'::character varying, 'schema_inferred'::character varying, 'approved'::character varying, 'rejected'::character varying]::text[]));
alter table only "atlas"."entity_aliases" add constraint "entity_aliases_alias_type_check" CHECK (alias_type::text = ANY (ARRAY['legal_name'::character varying, 'dba'::character varying, 'former_name'::character varying, 'spelling_variant'::character varying, 'acronym'::character varying, 'fuzzy_match'::character varying]::text[]));
alter table only "atlas"."entity_aliases" add constraint "entity_aliases_pkey" PRIMARY KEY (alias_id);
alter table only "atlas"."entity_registry" add constraint "entity_registry_entity_type_check" CHECK (entity_type::text = ANY (ARRAY['person'::text, 'organization'::text, 'political_committee'::text, 'government_agency'::text, 'nonprofit'::text, 'unknown'::text, 'jurisdiction'::text, 'bill_identifier'::text, 'classification'::text, 'subject'::text, 'sponsor'::text, 'court'::text, 'judge'::text, 'case_identifier'::text]));
alter table only "atlas"."entity_registry" add constraint "entity_registry_pkey" PRIMARY KEY (entity_id);
alter table only "atlas"."equations" add constraint "equations_equation_name_key" UNIQUE (equation_name);
alter table only "atlas"."equations" add constraint "equations_pkey" PRIMARY KEY (id);
alter table only "atlas"."fingerprint_matches" add constraint "fingerprint_matches_match_type_check" CHECK (match_type = ANY (ARRAY['exact'::text, 'temporal'::text, 'spatial'::text, 'behavioral'::text, 'hybrid'::text]));
alter table only "atlas"."fingerprint_matches" add constraint "fingerprint_matches_pkey" PRIMARY KEY (id);
alter table only "atlas"."fingerprints" add constraint "fingerprints_fingerprint_hash_key" UNIQUE (fingerprint_hash);
alter table only "atlas"."fingerprints" add constraint "fingerprints_fingerprint_type_check" CHECK (fingerprint_type = ANY (ARRAY['jurisdiction'::text, 'entity'::text, 'case'::text, 'pattern'::text, 'individual'::text]));
alter table only "atlas"."fingerprints" add constraint "fingerprints_pkey" PRIMARY KEY (id);
alter table only "atlas"."food_banks" add constraint "food_banks_pkey" PRIMARY KEY (pantry_id, source_system);
alter table only "atlas"."geography_registry" add constraint "geography_registry_pkey" PRIMARY KEY (geography_key);
alter table only "atlas"."geography_registry_snapshot" add constraint "geography_registry_snapshot_pkey" PRIMARY KEY (registry_hash);
alter table only "atlas"."geography_registry_snapshot" add constraint "geography_registry_snapshot_record_count_check" CHECK (record_count > 0);
alter table only "atlas"."geography_registry_snapshot" add constraint "geography_registry_snapshot_registry_hash_check" CHECK (registry_hash ~ '^[a-f0-9]{64}$'::text);
alter table only "atlas"."healthcare_facilities" add constraint "healthcare_facilities_cms_certification_number_source_syste_key" UNIQUE (cms_certification_number, source_system);
alter table only "atlas"."healthcare_facilities" add constraint "healthcare_facilities_pkey" PRIMARY KEY (facility_id);
alter table only "atlas"."immigration_courts" add constraint "immigration_courts_court_location_source_system_key" UNIQUE (court_location, source_system);
alter table only "atlas"."immigration_courts" add constraint "immigration_courts_pkey" PRIMARY KEY (court_id);
alter table only "atlas"."inferred_schema_draft" add constraint "inferred_schema_draft_pkey" PRIMARY KEY (draft_id);
alter table only "atlas"."ingest_job" add constraint "ingest_job_job_status_check" CHECK (job_status::text = ANY (ARRAY['pending'::character varying, 'running'::character varying, 'completed'::character varying, 'failed'::character varying, 'cancelled'::character varying]::text[]));
alter table only "atlas"."ingest_job" add constraint "ingest_job_pkey" PRIMARY KEY (job_id);
alter table only "atlas"."ingest_schedule" add constraint "ingest_schedule_pkey" PRIMARY KEY (schema_name);
alter table only "atlas"."jurisdiction_domains" add constraint "jurisdiction_domains_pkey" PRIMARY KEY (jurisdiction);
alter table only "atlas"."legal_aid_providers" add constraint "legal_aid_providers_pkey" PRIMARY KEY (provider_id, source_system);
alter table only "atlas"."lighthouse_bridge_queue" add constraint "lighthouse_bridge_queue_bridge_type_check" CHECK (bridge_type::text = ANY (ARRAY['signal'::character varying, 'entity'::character varying, 'case'::character varying]::text[]));
alter table only "atlas"."lighthouse_bridge_queue" add constraint "lighthouse_bridge_queue_pkey" PRIMARY KEY (queue_id);
alter table only "atlas"."lighthouse_bridge_queue" add constraint "lighthouse_bridge_queue_status_check" CHECK (status::text = ANY (ARRAY['pending'::character varying, 'processing'::character varying, 'completed'::character varying, 'failed'::character varying, 'retrying'::character varying]::text[]));
alter table only "atlas"."lighthouse_cases" add constraint "lighthouse_cases_atlas_action_id_key" UNIQUE (atlas_action_id);
alter table only "atlas"."lighthouse_cases" add constraint "lighthouse_cases_case_status_check" CHECK (case_status::text = ANY (ARRAY['open'::character varying, 'investigating'::character varying, 'escalated'::character varying, 'resolved'::character varying, 'closed'::character varying]::text[]));
alter table only "atlas"."lighthouse_cases" add constraint "lighthouse_cases_pkey" PRIMARY KEY (case_id);
alter table only "atlas"."lighthouse_entities" add constraint "lighthouse_entities_pkey" PRIMARY KEY (entity_id);
alter table only "atlas"."lighthouse_entities" add constraint "lighthouse_entities_risk_tier_check" CHECK (risk_tier::text = ANY (ARRAY['low'::character varying, 'medium'::character varying, 'high'::character varying, 'critical'::character varying]::text[]));
alter table only "atlas"."lighthouse_entities" add constraint "lighthouse_entities_watchlist_status_check" CHECK (watchlist_status::text = ANY (ARRAY['none'::character varying, 'monitoring'::character varying, 'investigating'::character varying, 'flagged'::character varying]::text[]));
alter table only "atlas"."lighthouse_map_pins" add constraint "lighthouse_map_pins_geography_key_pin_type_entity_id_signal_key" UNIQUE (geography_key, pin_type, entity_id, signal_id);
alter table only "atlas"."lighthouse_map_pins" add constraint "lighthouse_map_pins_pin_type_check" CHECK (pin_type::text = ANY (ARRAY['signal'::character varying, 'entity'::character varying, 'case'::character varying, 'resource'::character varying, 'alert'::character varying]::text[]));
alter table only "atlas"."lighthouse_map_pins" add constraint "lighthouse_map_pins_pkey" PRIMARY KEY (pin_id);
alter table only "atlas"."lighthouse_signals" add constraint "lighthouse_signals_atlas_signal_id_key" UNIQUE (atlas_signal_id);
alter table only "atlas"."lighthouse_signals" add constraint "lighthouse_signals_lighthouse_status_check" CHECK (lighthouse_status::text = ANY (ARRAY['new'::character varying, 'reviewing'::character varying, 'escalated'::character varying, 'resolved'::character varying, 'suppressed'::character varying]::text[]));
alter table only "atlas"."lighthouse_signals" add constraint "lighthouse_signals_pkey" PRIMARY KEY (signal_id);
alter table only "atlas"."live_data_signal_bridge_attempt" add constraint "live_data_signal_bridge_attempt_hash_check" CHECK (candidate_hash ~ '^[0-9a-f]{64}$'::text);
alter table only "atlas"."live_data_signal_bridge_attempt" add constraint "live_data_signal_bridge_attempt_pkey" PRIMARY KEY (attempt_id);
alter table only "atlas"."live_data_signal_bridge_attempt" add constraint "live_data_signal_bridge_attempt_request_id_key" UNIQUE (request_id);
alter table only "atlas"."live_data_signal_bridge_attempt" add constraint "live_data_signal_bridge_attempt_run_id_candidate_id_key" UNIQUE (run_id, candidate_id);
alter table only "atlas"."live_data_signal_bridge_attempt" add constraint "live_data_signal_bridge_attempt_status_check" CHECK (status = ANY (ARRAY['queued'::text, 'completed'::text, 'failed'::text]));
alter table only "atlas"."live_data_signal_candidate" add constraint "live_data_signal_candidate_bridge_status_check" CHECK (lighthouse_status = ANY (ARRAY['pending'::text, 'bridged'::text, 'failed'::text]));
alter table only "atlas"."live_data_signal_candidate" add constraint "live_data_signal_candidate_candidate_hash_key" UNIQUE (candidate_hash);
alter table only "atlas"."live_data_signal_candidate" add constraint "live_data_signal_candidate_confidence_check" CHECK (confidence_score >= 0::numeric AND confidence_score <= 1::numeric);
alter table only "atlas"."live_data_signal_candidate" add constraint "live_data_signal_candidate_hash_check" CHECK (candidate_hash ~ '^[0-9a-f]{64}$'::text);
alter table only "atlas"."live_data_signal_candidate" add constraint "live_data_signal_candidate_input_hash_check" CHECK (source_input_hash ~ '^[0-9a-f]{64}$'::text);
alter table only "atlas"."live_data_signal_candidate" add constraint "live_data_signal_candidate_pkey" PRIMARY KEY (candidate_id);
alter table only "atlas"."live_data_signal_candidate" add constraint "live_data_signal_candidate_refs_check" CHECK (jsonb_typeof(source_event_refs) = 'array'::text AND jsonb_array_length(source_event_refs) > 0);
alter table only "atlas"."live_data_signal_candidate" add constraint "live_data_signal_candidate_semantic_key_check" CHECK (semantic_key ~ '^[0-9a-f]{64}$'::text);
alter table only "atlas"."live_data_signal_candidate" add constraint "live_data_signal_candidate_severity_check" CHECK (severity = ANY (ARRAY['critical'::text, 'high'::text, 'medium'::text]));
alter table only "atlas"."live_data_signal_candidate" add constraint "live_data_signal_candidate_statistics_check" CHECK (jsonb_typeof(supporting_statistics) = 'object'::text AND supporting_statistics <> '{}'::jsonb);
alter table only "atlas"."live_data_signal_candidate_retirement_v1" add constraint "live_data_signal_candidate_retirement_v1_candidate_hash_check" CHECK (candidate_hash ~ '^[0-9a-f]{64}$'::text);
alter table only "atlas"."live_data_signal_candidate_retirement_v1" add constraint "live_data_signal_candidate_retirement_v1_pkey" PRIMARY KEY (retirement_id);
alter table only "atlas"."live_data_signal_candidate_retirement_v1" add constraint "live_data_signal_candidate_retirement_v1_retirement_hash_check" CHECK (retirement_hash ~ '^[0-9a-f]{64}$'::text);
alter table only "atlas"."live_data_signal_candidate_retirement_v1" add constraint "live_data_signal_candidate_retirement_v1_retirement_hash_key" UNIQUE (retirement_hash);
alter table only "atlas"."live_data_signal_candidate_retirement_v1" add constraint "live_data_signal_candidate_retirement_v1_semantic_key_check" CHECK (semantic_key ~ '^[0-9a-f]{64}$'::text);
alter table only "atlas"."live_data_signal_candidate_retirement_v1" add constraint "live_data_signal_candidate_retirement_v_lighthouse_status_check" CHECK (lighthouse_status = ANY (ARRAY['pending'::text, 'not_required'::text, 'bridged'::text, 'failed'::text]));
alter table only "atlas"."live_data_signal_candidate_retirement_v1" add constraint "live_data_signal_candidate_retirement_v_run_id_candidate_id_key" UNIQUE (run_id, candidate_id);
alter table only "atlas"."live_data_signal_rule" add constraint "live_data_signal_rule_hash_check" CHECK (rule_contract_hash ~ '^[0-9a-f]{64}$'::text);
alter table only "atlas"."live_data_signal_rule" add constraint "live_data_signal_rule_pkey" PRIMARY KEY (rule_id, rule_version);
alter table only "atlas"."live_data_signal_run" add constraint "live_data_signal_run_pkey" PRIMARY KEY (run_id);
alter table only "atlas"."live_data_signal_run" add constraint "live_data_signal_run_status_check" CHECK (status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text]));
alter table only "atlas"."location_registry" add constraint "location_registry_entity_id_address_hash_key" UNIQUE (entity_id, address_hash);
alter table only "atlas"."location_registry" add constraint "location_registry_location_type_check" CHECK (location_type::text = ANY (ARRAY['headquarters'::character varying, 'branch'::character varying, 'service_site'::character varying, 'mailing'::character varying, 'unknown'::character varying]::text[]));
alter table only "atlas"."location_registry" add constraint "location_registry_pkey" PRIMARY KEY (location_id);
alter table only "atlas"."math_constants" add constraint "math_constants_constant_name_key" UNIQUE (constant_name);
alter table only "atlas"."math_constants" add constraint "math_constants_domain_check" CHECK (domain = ANY (ARRAY['universal'::text, 'housing'::text, 'healthcare'::text, 'legal'::text, 'labor'::text, 'environmental'::text, 'corruption'::text, 'reparative'::text]));
alter table only "atlas"."math_constants" add constraint "math_constants_pkey" PRIMARY KEY (id);
alter table only "atlas"."math_constants" add constraint "math_constants_symbol_key" UNIQUE (symbol);
alter table only "atlas"."municipal_bonds" add constraint "municipal_bonds_cusip_source_system_key" UNIQUE (cusip, source_system);
alter table only "atlas"."municipal_bonds" add constraint "municipal_bonds_pkey" PRIMARY KEY (bond_id);
alter table only "atlas"."nonprofit_financials" add constraint "nonprofit_financials_ein_tax_year_source_system_key" UNIQUE (ein, tax_year, source_system);
alter table only "atlas"."nonprofit_financials" add constraint "nonprofit_financials_pkey" PRIMARY KEY (filing_id);
alter table only "atlas"."nonprofit_registry" add constraint "nonprofit_registry_pkey" PRIMARY KEY (ein, source_system);
alter table only "atlas"."pdf_extraction_queue" add constraint "pdf_extraction_queue_extraction_status_check" CHECK (extraction_status::text = ANY (ARRAY['pending'::character varying, 'downloading'::character varying, 'extracting'::character varying, 'analyzing'::character varying, 'analyzed'::character varying, 'failed'::character varying, 'retrying'::character varying]::text[]));
alter table only "atlas"."pdf_extraction_queue" add constraint "pdf_extraction_queue_pkey" PRIMARY KEY (queue_id);
alter table only "atlas"."provenance" add constraint "provenance_action_check" CHECK (action = ANY (ARRAY['INSERT'::text, 'UPDATE'::text, 'DELETE'::text, 'COMPUTE'::text, 'LINK'::text, 'ESCALATE'::text]));
alter table only "atlas"."provenance" add constraint "provenance_pkey" PRIMARY KEY (id);
alter table only "atlas"."raw_benefits_wa" add constraint "raw_benefits_wa_pkey" PRIMARY KEY (raw_id);
alter table only "atlas"."raw_food_banks_king_county" add constraint "raw_food_banks_king_county_pkey" PRIMARY KEY (raw_id);
alter table only "atlas"."raw_nonprofits_wa" add constraint "raw_nonprofits_wa_pkey" PRIMARY KEY (raw_id);
alter table only "atlas"."raw_regulations_gov" add constraint "raw_regulations_gov_pkey" PRIMARY KEY (raw_id);
alter table only "atlas"."regulatory_comments" add constraint "regulatory_comments_document_id_source_system_key" UNIQUE (document_id, source_system);
alter table only "atlas"."regulatory_comments" add constraint "regulatory_comments_pkey" PRIMARY KEY (comment_id);
alter table only "atlas"."regulatory_comments" add constraint "uq_regulatory_comments_document_id" UNIQUE (document_id);
alter table only "atlas"."regulatory_final_rules" add constraint "regulatory_final_rules_fr_document_id_source_system_key" UNIQUE (fr_document_id, source_system);
alter table only "atlas"."regulatory_final_rules" add constraint "regulatory_final_rules_pkey" PRIMARY KEY (rule_id);
alter table only "atlas"."reparative_calculations" add constraint "reparative_calculations_calculation_type_check" CHECK (calculation_type = ANY (ARRAY['harm_quantification'::text, 'restitution_estimate'::text, 'timeline_compression'::text, 'opportunity_cost'::text, 'dignity_score'::text]));
alter table only "atlas"."reparative_calculations" add constraint "reparative_calculations_pkey" PRIMARY KEY (id);
alter table only "atlas"."schema_registry" add constraint "schema_registry_pkey" PRIMARY KEY (schema_name);
alter table only "atlas"."school_districts" add constraint "school_districts_leaid_source_system_key" UNIQUE (leaid, source_system);
alter table only "atlas"."school_districts" add constraint "school_districts_pkey" PRIMARY KEY (district_id);
alter table only "atlas"."signal_event_entity_resolution" add constraint "signal_event_entity_resolution_ambiguous_candidates_check" CHECK (resolution_status <> 'ambiguous'::text OR cardinality(candidate_entity_ids) >= 2);
alter table only "atlas"."signal_event_entity_resolution" add constraint "signal_event_entity_resolution_candidate_key_check" CHECK (candidate_key ~ '^[0-9a-f]{64}$'::text);
alter table only "atlas"."signal_event_entity_resolution" add constraint "signal_event_entity_resolution_contract_key" UNIQUE (stream_id, event_offset, candidate_key, resolver_id, resolver_version, entity_index_hash);
alter table only "atlas"."signal_event_entity_resolution" add constraint "signal_event_entity_resolution_entity_state_check" CHECK (resolution_status = 'resolved'::text AND entity_id IS NOT NULL OR resolution_status <> 'resolved'::text AND entity_id IS NULL);
alter table only "atlas"."signal_event_entity_resolution" add constraint "signal_event_entity_resolution_event_hash_check" CHECK (event_input_hash ~ '^[0-9a-f]{64}$'::text);
alter table only "atlas"."signal_event_entity_resolution" add constraint "signal_event_entity_resolution_hash_check" CHECK (resolution_hash ~ '^[0-9a-f]{64}$'::text);
alter table only "atlas"."signal_event_entity_resolution" add constraint "signal_event_entity_resolution_hash_unique" UNIQUE (resolution_hash);
alter table only "atlas"."signal_event_entity_resolution" add constraint "signal_event_entity_resolution_ignored_state_check" CHECK (resolution_status <> 'ignored'::text OR cardinality(candidate_entity_ids) = 0);
alter table only "atlas"."signal_event_entity_resolution" add constraint "signal_event_entity_resolution_index_hash_check" CHECK (entity_index_hash ~ '^[0-9a-f]{64}$'::text);
alter table only "atlas"."signal_event_entity_resolution" add constraint "signal_event_entity_resolution_method_state_check" CHECK (resolution_status = 'resolved'::text AND (match_method = ANY (ARRAY['exact_canonical_entity_id'::text, 'exact_external_identifier'::text, 'exact_primary_name'::text, 'exact_name_variant'::text, 'exact_alias'::text])) OR resolution_status = 'ambiguous'::text AND (match_method = ANY (ARRAY['identifier_name_conflict'::text, 'duplicate_external_identifier'::text, 'duplicate_exact_name'::text])) OR resolution_status = 'unresolved'::text AND (match_method = ANY (ARRAY['no_exact_match'::text, 'no_usable_identity_value'::text, 'exact_match_entity_type_mismatch'::text])) OR resolution_status = 'ignored'::text AND match_method = 'no_declared_entity_rule'::text);
alter table only "atlas"."signal_event_entity_resolution" add constraint "signal_event_entity_resolution_pkey" PRIMARY KEY (resolution_id);
alter table only "atlas"."signal_event_entity_resolution" add constraint "signal_event_entity_resolution_required_text_check" CHECK (btrim(rule_id) <> ''::text AND btrim(rule_version) <> ''::text AND btrim(entity_role) <> ''::text AND btrim(source_field) <> ''::text AND btrim(match_method) <> ''::text AND btrim(resolver_id) <> ''::text AND btrim(resolver_version) <> ''::text);
alter table only "atlas"."signal_event_entity_resolution" add constraint "signal_event_entity_resolution_resolution_status_check" CHECK (resolution_status = ANY (ARRAY['resolved'::text, 'ambiguous'::text, 'unresolved'::text, 'ignored'::text]));
alter table only "atlas"."signal_event_entity_resolution" add constraint "signal_event_entity_resolution_resolved_candidate_check" CHECK (resolution_status <> 'resolved'::text OR (entity_id::text = ANY (candidate_entity_ids::text[])));
alter table only "atlas"."signal_event_entity_resolution" add constraint "signal_event_entity_resolution_rule_manifest_hash_check" CHECK (rule_manifest_hash ~ '^[0-9a-f]{64}$'::text);
alter table only "atlas"."signal_event_entity_resolution" add constraint "signal_event_entity_resolution_unresolved_candidates_check" CHECK (resolution_status <> 'unresolved'::text OR cardinality(candidate_entity_ids) <= 1);
alter table only "atlas"."signal_event_entity_resolution_rule" add constraint "signal_event_entity_resolution_rule_contract_hash_check" CHECK (rule_contract_hash ~ '^[0-9a-f]{64}$'::text);
alter table only "atlas"."signal_event_entity_resolution_rule" add constraint "signal_event_entity_resolution_rule_manifest_hash_check" CHECK (rule_manifest_hash ~ '^[0-9a-f]{64}$'::text);
alter table only "atlas"."signal_event_entity_resolution_rule" add constraint "signal_event_entity_resolution_rule_pkey" PRIMARY KEY (rule_id, rule_version);
alter table only "atlas"."signal_event_entity_resolution_rule" add constraint "signal_event_entity_resolution_rule_required_text_check" CHECK (btrim(rule_id) <> ''::text AND btrim(rule_version) <> ''::text AND btrim(stream_id) <> ''::text AND btrim(entity_role) <> ''::text AND btrim(transform) <> ''::text);
alter table only "atlas"."signal_event_entity_resolution_run" add constraint "signal_event_entity_resolution_run_batch_size_check" CHECK (batch_size >= 1 AND batch_size <= 5000);
alter table only "atlas"."signal_event_entity_resolution_run" add constraint "signal_event_entity_resolution_run_index_hash_check" CHECK (entity_index_hash ~ '^[0-9a-f]{64}$'::text);
alter table only "atlas"."signal_event_entity_resolution_run" add constraint "signal_event_entity_resolution_run_manifest_hash_check" CHECK (manifest_hash ~ '^[0-9a-f]{64}$'::text);
alter table only "atlas"."signal_event_entity_resolution_run" add constraint "signal_event_entity_resolution_run_pkey" PRIMARY KEY (run_id);
alter table only "atlas"."signal_event_entity_resolution_run" add constraint "signal_event_entity_resolution_run_rule_hash_check" CHECK (rule_manifest_hash ~ '^[0-9a-f]{64}$'::text);
alter table only "atlas"."signal_event_entity_resolution_run" add constraint "signal_event_entity_resolution_run_status_check" CHECK (status = ANY (ARRAY['running'::text, 'completed'::text, 'partial'::text, 'failed'::text]));
alter table only "atlas"."signal_event_identity" add constraint "signal_event_identity_count_check" CHECK (historical_event_count >= 1 AND replay_count >= 0);
alter table only "atlas"."signal_event_identity" add constraint "signal_event_identity_hash_check" CHECK (event_identity_hash ~ '^[0-9a-f]{64}$'::text);
alter table only "atlas"."signal_event_identity" add constraint "signal_event_identity_pkey" PRIMARY KEY (stream_id, event_identity_hash);
alter table only "atlas"."signal_event_identity" add constraint "signal_event_identity_source_record_key_check" CHECK (source_record_key ~ '^[0-9a-f]{64}$'::text);
alter table only "atlas"."signal_event_identity" add constraint "signal_event_identity_stream_id_canonical_offset_key" UNIQUE (stream_id, canonical_offset);
alter table only "atlas"."signal_event_ingest_run" add constraint "signal_event_ingest_run_pkey" PRIMARY KEY (run_id);
alter table only "atlas"."signal_event_ingest_run" add constraint "signal_event_ingest_run_status_check" CHECK (status = ANY (ARRAY['running'::text, 'completed'::text, 'partial'::text, 'failed'::text]));
alter table only "atlas"."signal_extractions" add constraint "signal_extractions_pkey" PRIMARY KEY (id);
alter table only "atlas"."signal_types" add constraint "signal_types_category_check" CHECK (category = ANY (ARRAY['temporal'::text, 'spatial'::text, 'financial'::text, 'procedural'::text, 'behavioral'::text, 'documentary'::text, 'network'::text, 'jurisdictional'::text, 'reparative'::text]));
alter table only "atlas"."signal_types" add constraint "signal_types_detection_method_check" CHECK (detection_method = ANY (ARRAY['threshold'::text, 'pattern_match'::text, 'statistical_anomaly'::text, 'convergence'::text, 'manual'::text, 'ml_model'::text]));
alter table only "atlas"."signal_types" add constraint "signal_types_pkey" PRIMARY KEY (id);
alter table only "atlas"."signal_types" add constraint "signal_types_severity_scale_check" CHECK (severity_scale >= 1 AND severity_scale <= 10);
alter table only "atlas"."signal_types" add constraint "signal_types_type_code_key" UNIQUE (type_code);
alter table only "atlas"."signals" add constraint "signals_confidence_check" CHECK (confidence >= 0.0 AND confidence <= 1.0);
alter table only "atlas"."signals" add constraint "signals_normalized_score_check" CHECK (normalized_score >= '-1.0'::numeric AND normalized_score <= 1.0);
alter table only "atlas"."signals" add constraint "signals_pkey" PRIMARY KEY (id);
alter table only "atlas"."signals" add constraint "signals_severity_check" CHECK (severity >= 1 AND severity <= 10);
alter table only "atlas"."utility_rate_cases" add constraint "utility_rate_cases_docket_number_source_system_key" UNIQUE (docket_number, source_system);
alter table only "atlas"."utility_rate_cases" add constraint "utility_rate_cases_pkey" PRIMARY KEY (rate_id);
alter table only "atlas"."variables" add constraint "variables_data_type_check" CHECK (data_type = ANY (ARRAY['integer'::text, 'decimal'::text, 'boolean'::text, 'jsonb'::text, 'text'::text, 'timestamp'::text]));
alter table only "atlas"."variables" add constraint "variables_pkey" PRIMARY KEY (id);
alter table only "atlas"."variables" add constraint "variables_variable_name_key" UNIQUE (variable_name);
alter table only "atlas"."water_systems" add constraint "water_systems_pkey" PRIMARY KEY (system_id);
alter table only "atlas"."water_systems" add constraint "water_systems_pwsid_source_system_key" UNIQUE (pwsid, source_system);
alter table only "private"."lighthouse_stream_export_allowlist" add constraint "lighthouse_stream_export_allowlist_pkey" PRIMARY KEY (stream_id);
alter table only "public"."agency_metrics" add constraint "agency_metrics_pkey" PRIMARY KEY (id);
alter table only "public"."agency_registry_canonical" add constraint "agency_registry_canonical_pkey" PRIMARY KEY (agency_id);
alter table only "public"."atlas_action_receipt" add constraint "atlas_action_receipt_event_delta" CHECK (before_event_count IS NULL AND after_event_count IS NULL AND event_delta IS NULL OR before_event_count IS NOT NULL AND after_event_count IS NOT NULL AND event_delta = (after_event_count - before_event_count));
alter table only "public"."atlas_action_receipt" add constraint "atlas_action_receipt_hash_format" CHECK (action_receipt_hash ~ '^[0-9a-f]{64}$'::text);
alter table only "public"."atlas_action_receipt" add constraint "atlas_action_receipt_initiator_check" CHECK (initiator = ANY (ARRAY['scheduler'::text, 'operator'::text, 'system'::text]));
alter table only "public"."atlas_action_receipt" add constraint "atlas_action_receipt_outcome_status_check" CHECK (outcome_status = ANY (ARRAY['completed'::text, 'failed'::text, 'skipped'::text]));
alter table only "public"."atlas_action_receipt" add constraint "atlas_action_receipt_pkey" PRIMARY KEY (action_receipt_hash);
alter table only "public"."atlas_action_receipt" add constraint "atlas_action_receipt_time_order" CHECK (completed_at >= requested_at);
alter table only "public"."atlas_source_fallback_binding" add constraint "atlas_source_fallback_binding_fallback_priority_check" CHECK (fallback_priority > 0);
alter table only "public"."atlas_source_fallback_binding" add constraint "atlas_source_fallback_binding_pkey" PRIMARY KEY (connector_id, fallback_connector_id);
alter table only "public"."atlas_source_fallback_binding" add constraint "atlas_source_fallback_not_self" CHECK (connector_id <> fallback_connector_id);
alter table only "public"."atlas_source_health_event" add constraint "atlas_source_health_event_duplicate_rate_check" CHECK (duplicate_rate IS NULL OR duplicate_rate >= 0::numeric AND duplicate_rate <= 1::numeric);
alter table only "public"."atlas_source_health_event" add constraint "atlas_source_health_event_error_rate_check" CHECK (error_rate IS NULL OR error_rate >= 0::numeric AND error_rate <= 1::numeric);
alter table only "public"."atlas_source_health_event" add constraint "atlas_source_health_event_freshness_status_check" CHECK (freshness_status = ANY (ARRAY['fresh'::text, 'stale'::text, 'delayed'::text, 'unknown'::text]));
alter table only "public"."atlas_source_health_event" add constraint "atlas_source_health_event_health_status_check" CHECK (health_status = ANY (ARRAY['healthy'::text, 'degraded'::text, 'failing'::text, 'paused'::text, 'retired'::text, 'unknown'::text]));
alter table only "public"."atlas_source_health_event" add constraint "atlas_source_health_event_identity_unique" UNIQUE (connector_id, observed_at, source_state_hash);
alter table only "public"."atlas_source_health_event" add constraint "atlas_source_health_event_latency_ms_check" CHECK (latency_ms IS NULL OR latency_ms >= 0);
alter table only "public"."atlas_source_health_event" add constraint "atlas_source_health_event_missing_required_field_rate_check" CHECK (missing_required_field_rate IS NULL OR missing_required_field_rate >= 0::numeric AND missing_required_field_rate <= 1::numeric);
alter table only "public"."atlas_source_health_event" add constraint "atlas_source_health_event_pkey" PRIMARY KEY (health_event_id);
alter table only "public"."atlas_source_health_event" add constraint "atlas_source_health_event_records_observed_check" CHECK (records_observed IS NULL OR records_observed >= 0);
alter table only "public"."atlas_source_health_event" add constraint "atlas_source_health_event_schema_status_check" CHECK (schema_status = ANY (ARRAY['stable'::text, 'changed'::text, 'breaking_change'::text, 'unknown'::text]));
alter table only "public"."atlas_source_health_event" add constraint "atlas_source_health_event_source_state_hash_check" CHECK (source_state_hash ~ '^[0-9a-f]{64}$'::text);
alter table only "public"."atlas_source_schema_snapshot" add constraint "atlas_source_schema_snapshot_detected_change_type_check" CHECK (detected_change_type = ANY (ARRAY['initial'::text, 'none'::text, 'additive'::text, 'changed'::text, 'breaking_change'::text, 'unknown'::text]));
alter table only "public"."atlas_source_schema_snapshot" add constraint "atlas_source_schema_snapshot_identity_unique" UNIQUE (connector_id, schema_hash);
alter table only "public"."atlas_source_schema_snapshot" add constraint "atlas_source_schema_snapshot_pkey" PRIMARY KEY (schema_snapshot_id);
alter table only "public"."atlas_source_schema_snapshot" add constraint "atlas_source_schema_snapshot_schema_hash_check" CHECK (schema_hash ~ '^[0-9a-f]{64}$'::text);
alter table only "public"."canonical_extracted_records" add constraint "canonical_extracted_records_pkey" PRIMARY KEY (id);
alter table only "public"."canonical_extracted_records" add constraint "canonical_extracted_records_provenance_hash_key" UNIQUE (provenance_hash);
alter table only "public"."canonical_extracted_records" add constraint "canonical_extracted_records_usefulness_status_check" CHECK (usefulness_status = ANY (ARRAY['unchecked'::text, 'useful'::text, 'not_useful'::text, 'needs_repair'::text]));
alter table only "public"."canonical_extracted_records" add constraint "canonical_extracted_records_verification_status_check" CHECK (verification_status = ANY (ARRAY['needs_review'::text, 'verified'::text, 'rejected'::text, 'stale'::text, 'superseded'::text]));
alter table only "public"."case_law" add constraint "case_law_jurisdiction_id_external_id_key" UNIQUE (jurisdiction_id, external_id);
alter table only "public"."case_law" add constraint "case_law_pkey" PRIMARY KEY (id);
alter table only "public"."civic_infrastructure_nodes" add constraint "civic_infrastructure_nodes_canonical_resource_id_key" UNIQUE (canonical_resource_id);
alter table only "public"."civic_infrastructure_nodes" add constraint "civic_infrastructure_nodes_pkey" PRIMARY KEY (id);
alter table only "public"."civic_map_resources" add constraint "civic_map_resources_pkey" PRIMARY KEY (id);
alter table only "public"."connector_registry" add constraint "connector_registry_auth_type_check" CHECK (auth_type::text = ANY (ARRAY['none'::text, 'bearer'::text, 'api_key'::text, 'oauth2'::text, 'basic'::text, 'hmac_sha256'::text]));
alter table only "public"."connector_registry" add constraint "connector_registry_name_key" UNIQUE (name);
alter table only "public"."connector_registry" add constraint "connector_registry_pagination_type_check" CHECK (pagination_type::text = ANY (ARRAY['cursor'::character varying, 'offset'::character varying, 'page'::character varying, 'none'::character varying]::text[]));
alter table only "public"."connector_registry" add constraint "connector_registry_pkey" PRIMARY KEY (id);
alter table only "public"."cursors" add constraint "cursors_pkey" PRIMARY KEY (cursor_id);
alter table only "public"."cursors" add constraint "cursors_stream_id_name_key" UNIQUE (stream_id, name);
alter table only "public"."extraction_candidates" add constraint "extraction_candidates_pkey" PRIMARY KEY (id);
alter table only "public"."ingest_jobs" add constraint "ingest_jobs_pkey" PRIMARY KEY (id);
alter table only "public"."ingest_jobs" add constraint "ingest_jobs_status_check" CHECK (status::text = ANY (ARRAY['pending'::character varying, 'running'::character varying, 'completed'::character varying, 'failed'::character varying, 'partial'::character varying]::text[]));
alter table only "public"."investigative_jobs" add constraint "investigative_jobs_job_type_check" CHECK (job_type = ANY (ARRAY['stream_health'::text, 'fraud_investigation'::text, 'cross_correlation'::text]));
alter table only "public"."investigative_jobs" add constraint "investigative_jobs_pkey" PRIMARY KEY (job_id);
alter table only "public"."investigative_jobs" add constraint "investigative_jobs_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'running'::text, 'completed'::text, 'failed'::text]));
alter table only "public"."jurisdictions" add constraint "jurisdictions_geo_id_key" UNIQUE (geo_id);
alter table only "public"."jurisdictions" add constraint "jurisdictions_pkey" PRIMARY KEY (id);
alter table only "public"."jurisdictions_registry" add constraint "jurisdictions_registry_pkey" PRIMARY KEY (jurisdiction_id);
alter table only "public"."prime_patterns" add constraint "prime_patterns_confidence_check" CHECK (confidence >= 0::numeric AND confidence <= 1::numeric);
alter table only "public"."prime_patterns" add constraint "prime_patterns_pkey" PRIMARY KEY (pattern_id);
alter table only "public"."prime_patterns" add constraint "prime_patterns_severity_check" CHECK (severity = ANY (ARRAY['info'::text, 'low'::text, 'medium'::text, 'high'::text, 'critical'::text]));
alter table only "public"."raw_records" add constraint "raw_records_connector_id_sha256_hash_key" UNIQUE (connector_id, sha256_hash);
alter table only "public"."raw_records" add constraint "raw_records_pkey" PRIMARY KEY (id);
alter table only "public"."raw_records" add constraint "raw_records_process_status_check" CHECK (process_status::text = ANY (ARRAY['pending'::character varying, 'mapped'::character varying, 'failed'::character varying, 'ignored'::character varying]::text[]));
alter table only "public"."registry_conflict_log" add constraint "registry_conflict_log_pkey" PRIMARY KEY (id);
alter table only "public"."schema_registry" add constraint "schema_registry_name_version_key" UNIQUE (name, version);
alter table only "public"."schema_registry" add constraint "schema_registry_pkey" PRIMARY KEY (id);
alter table only "public"."signal_definitions" add constraint "signal_definitions_pkey" PRIMARY KEY (id);
alter table only "public"."signal_definitions" add constraint "signal_definitions_rule_id_key" UNIQUE (rule_id);
alter table only "public"."signal_definitions" add constraint "signal_definitions_severity_default_check" CHECK (severity_default = ANY (ARRAY['critical'::text, 'high'::text, 'medium'::text, 'low'::text]));
alter table only "public"."signal_events" add constraint "signal_events_event_identity_hash_check" CHECK (event_identity_hash IS NULL OR event_identity_hash ~ '^[0-9a-f]{64}$'::text);
alter table only "public"."signal_events" add constraint "signal_events_pkey" PRIMARY KEY (stream_id, "offset");
alter table only "public"."signal_events" add constraint "signal_events_provenance_channel" CHECK (provenance ? 'channel'::text);
alter table only "public"."signal_events" add constraint "signal_events_provenance_confidence" CHECK (provenance ? 'confidence'::text);
alter table only "public"."signal_events" add constraint "signal_events_spacetime_region" CHECK (spacetime ? 'region'::text);
alter table only "public"."statutes" add constraint "statutes_jurisdiction_id_external_id_key" UNIQUE (jurisdiction_id, external_id);
alter table only "public"."statutes" add constraint "statutes_pkey" PRIMARY KEY (id);
alter table only "public"."streams" add constraint "streams_pkey" PRIMARY KEY (stream_id);
alter table only "public"."streams" add constraint "streams_safety_profile_check" CHECK (safety_profile = ANY (ARRAY['default'::text, 'restricted'::text, 'critical'::text]));
alter table only "public"."streams" add constraint "streams_status_check" CHECK (status = ANY (ARRAY['active'::text, 'degraded'::text, 'quarantined'::text, 'paused'::text]));
alter table only "public"."streams" add constraint "streams_throughput_profile_check" CHECK (throughput_profile = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'ultra'::text]));
alter table only "public"."verification_claims" add constraint "verification_claims_claim_hash_key" UNIQUE (claim_hash);
alter table only "public"."verification_claims" add constraint "verification_claims_conflict_status_check" CHECK (conflict_status = ANY (ARRAY['unchecked'::text, 'none'::text, 'possible_conflict'::text, 'confirmed_conflict'::text, 'resolved'::text]));
alter table only "public"."verification_claims" add constraint "verification_claims_pkey" PRIMARY KEY (id);
alter table only "public"."verification_claims" add constraint "verification_claims_score_range" CHECK (verification_score >= 0::numeric AND verification_score <= 1::numeric);
alter table only "public"."verification_claims" add constraint "verification_claims_status_check" CHECK (verification_status = ANY (ARRAY['pending'::text, 'needs_review'::text, 'verified'::text, 'rejected'::text, 'stale'::text, 'superseded'::text]));
alter table only "public"."verification_evidence" add constraint "verification_evidence_claim_id_evidence_hash_key" UNIQUE (claim_id, evidence_hash);
alter table only "public"."verification_evidence" add constraint "verification_evidence_pkey" PRIMARY KEY (id);
alter table only "public"."verification_sources" add constraint "verification_sources_pkey" PRIMARY KEY (id);
alter table only "public"."verification_sources" add constraint "verification_sources_trust_weight_range" CHECK (trust_weight >= 0::numeric AND trust_weight <= 1::numeric);
alter table only "public"."verified_chronicle" add constraint "verified_chronicle_chronicle_hash_key" UNIQUE (chronicle_hash);
alter table only "public"."verified_chronicle" add constraint "verified_chronicle_pkey" PRIMARY KEY (id);
alter table only "public"."verified_chronicle" add constraint "verified_chronicle_score_range" CHECK (verification_score >= 0::numeric AND verification_score <= 1::numeric);
alter table only "public"."workflow_registry" add constraint "workflow_registry_pkey" PRIMARY KEY (workflow_id);

-- ---- foreign keys ----
alter table only "atlas"."atlas_case_links" add constraint "atlas_case_links_atlas_convergence_event_id_fkey" FOREIGN KEY (atlas_convergence_event_id) REFERENCES atlas.convergence_events(id);
alter table only "atlas"."atlas_escalation_links" add constraint "atlas_escalation_links_atlas_convergence_event_id_fkey" FOREIGN KEY (atlas_convergence_event_id) REFERENCES atlas.convergence_events(id);
alter table only "atlas"."bridge_sync_log" add constraint "bridge_sync_log_bridge_id_fkey" FOREIGN KEY (bridge_id) REFERENCES atlas.bridge_config(bridge_id);
alter table only "atlas"."census_city_data" add constraint "census_city_data_geography_key_fkey" FOREIGN KEY (geography_key) REFERENCES atlas.geography_registry(geography_key);
alter table only "atlas"."census_tract_data" add constraint "census_tract_data_geography_key_fkey" FOREIGN KEY (geography_key) REFERENCES atlas.geography_registry(geography_key);
alter table only "atlas"."civic_genome_legislative_projection_run" add constraint "civic_genome_legislative_projection_run_source_snapshot_id_fkey" FOREIGN KEY (source_snapshot_id) REFERENCES atlas.civic_genome_external_snapshot(source_snapshot_id);
alter table only "atlas"."civic_genome_legislative_trait_binding_accounting" add constraint "civic_genome_legislative_trait_binding__source_snapshot_id_fkey" FOREIGN KEY (source_snapshot_id) REFERENCES atlas.civic_genome_external_snapshot(source_snapshot_id);
alter table only "atlas"."civic_genome_legislative_trait_binding_accounting" add constraint "civic_genome_legislative_trait_binding_acco_projection_key_fkey" FOREIGN KEY (projection_key) REFERENCES atlas.civic_genome_legislative_projection_run(projection_key);
alter table only "atlas"."civic_map_signals" add constraint "civic_map_signals_geography_key_fkey" FOREIGN KEY (geography_key) REFERENCES atlas.geography_registry(geography_key);
alter table only "atlas"."clause_patterns" add constraint "clause_patterns_domain_code_fkey" FOREIGN KEY (domain_code) REFERENCES atlas.domain_registry(domain_code);
alter table only "atlas"."contact_registry" add constraint "contact_registry_entity_id_fkey" FOREIGN KEY (entity_id) REFERENCES atlas.entity_registry(entity_id);
alter table only "atlas"."contact_registry" add constraint "contact_registry_geography_key_fkey" FOREIGN KEY (geography_key) REFERENCES atlas.geography_registry(geography_key);
alter table only "atlas"."contract_clauses" add constraint "contract_clauses_queue_id_fkey" FOREIGN KEY (queue_id) REFERENCES atlas.pdf_extraction_queue(queue_id);
alter table only "atlas"."convergence_events" add constraint "convergence_events_pattern_id_fkey" FOREIGN KEY (pattern_id) REFERENCES atlas.convergence_patterns(id);
alter table only "atlas"."convergence_patterns" add constraint "convergence_patterns_convergence_equation_id_fkey" FOREIGN KEY (convergence_equation_id) REFERENCES atlas.equations(id);
alter table only "atlas"."convergence_receipt" add constraint "convergence_receipt_run_key_fkey" FOREIGN KEY (run_key) REFERENCES atlas.convergence_run_manifest(run_key);
alter table only "atlas"."convergence_result_payload" add constraint "convergence_result_payload_run_key_fkey" FOREIGN KEY (run_key) REFERENCES atlas.convergence_run_manifest(run_key);
alter table only "atlas"."convergence_run_manifest" add constraint "convergence_run_manifest_analysis_registry_hash_fkey" FOREIGN KEY (analysis_registry_hash) REFERENCES atlas.geography_registry_snapshot(registry_hash);
alter table only "atlas"."convergence_signal_snapshot" add constraint "convergence_signal_snapshot_run_key_fkey" FOREIGN KEY (run_key) REFERENCES atlas.convergence_run_manifest(run_key);
alter table only "atlas"."corruption_indicators" add constraint "corruption_indicators_convergence_event_id_fkey" FOREIGN KEY (convergence_event_id) REFERENCES atlas.convergence_events(id);
alter table only "atlas"."detection_rules" add constraint "detection_rules_domain_code_fkey" FOREIGN KEY (domain_code) REFERENCES atlas.domain_registry(domain_code);
alter table only "atlas"."domain_configs" add constraint "domain_configs_domain_id_fkey" FOREIGN KEY (domain_id) REFERENCES atlas.domains(id);
alter table only "atlas"."endpoint_probe_queue" add constraint "endpoint_probe_queue_platform_id_fkey" FOREIGN KEY (platform_id) REFERENCES atlas.discovery_platforms(platform_id);
alter table only "atlas"."entity_aliases" add constraint "entity_aliases_entity_id_fkey" FOREIGN KEY (entity_id) REFERENCES atlas.entity_registry(entity_id) ON DELETE CASCADE;
alter table only "atlas"."fingerprint_matches" add constraint "fingerprint_matches_matched_fingerprint_id_fkey" FOREIGN KEY (matched_fingerprint_id) REFERENCES atlas.fingerprints(id);
alter table only "atlas"."fingerprint_matches" add constraint "fingerprint_matches_source_fingerprint_id_fkey" FOREIGN KEY (source_fingerprint_id) REFERENCES atlas.fingerprints(id);
alter table only "atlas"."geography_registry" add constraint "geography_registry_parent_key_fkey" FOREIGN KEY (parent_key) REFERENCES atlas.geography_registry(geography_key);
alter table only "atlas"."inferred_schema_draft" add constraint "inferred_schema_draft_queue_id_fkey" FOREIGN KEY (queue_id) REFERENCES atlas.endpoint_probe_queue(queue_id) ON DELETE CASCADE;
alter table only "atlas"."ingest_job" add constraint "ingest_job_connector_id_fkey" FOREIGN KEY (connector_id) REFERENCES atlas.connector_registry(connector_id);
alter table only "atlas"."ingest_job" add constraint "ingest_job_schema_name_fkey" FOREIGN KEY (schema_name) REFERENCES atlas.schema_registry(schema_name);
alter table only "atlas"."jurisdiction_domains" add constraint "jurisdiction_domains_platform_id_fkey" FOREIGN KEY (platform_id) REFERENCES atlas.discovery_platforms(platform_id);
alter table only "atlas"."lighthouse_bridge_queue" add constraint "lighthouse_bridge_queue_atlas_entity_id_fkey" FOREIGN KEY (atlas_entity_id) REFERENCES atlas.entity_registry(entity_id);
alter table only "atlas"."lighthouse_bridge_queue" add constraint "lighthouse_bridge_queue_atlas_signal_id_fkey" FOREIGN KEY (atlas_signal_id) REFERENCES atlas.civic_map_signals(signal_id);
alter table only "atlas"."live_data_signal_bridge_attempt" add constraint "live_data_signal_bridge_attempt_candidate_id_fkey" FOREIGN KEY (candidate_id) REFERENCES atlas.live_data_signal_candidate(candidate_id);
alter table only "atlas"."live_data_signal_bridge_attempt" add constraint "live_data_signal_bridge_attempt_run_id_fkey" FOREIGN KEY (run_id) REFERENCES atlas.live_data_signal_run(run_id);
alter table only "atlas"."live_data_signal_candidate" add constraint "live_data_signal_candidate_first_run_id_fkey" FOREIGN KEY (first_run_id) REFERENCES atlas.live_data_signal_run(run_id);
alter table only "atlas"."live_data_signal_candidate" add constraint "live_data_signal_candidate_last_run_id_fkey" FOREIGN KEY (last_run_id) REFERENCES atlas.live_data_signal_run(run_id);
alter table only "atlas"."live_data_signal_candidate" add constraint "live_data_signal_candidate_supersedes_fkey" FOREIGN KEY (supersedes_candidate_id) REFERENCES atlas.live_data_signal_candidate(candidate_id);
alter table only "atlas"."live_data_signal_candidate_retirement_v1" add constraint "live_data_signal_candidate_retirement_v1_candidate_id_fkey" FOREIGN KEY (candidate_id) REFERENCES atlas.live_data_signal_candidate(candidate_id);
alter table only "atlas"."live_data_signal_candidate_retirement_v1" add constraint "live_data_signal_candidate_retirement_v1_run_id_fkey" FOREIGN KEY (run_id) REFERENCES atlas.live_data_signal_run(run_id);
alter table only "atlas"."live_data_signal_run" add constraint "live_data_signal_run_rule_id_rule_version_fkey" FOREIGN KEY (rule_id, rule_version) REFERENCES atlas.live_data_signal_rule(rule_id, rule_version);
alter table only "atlas"."location_registry" add constraint "location_registry_entity_id_fkey" FOREIGN KEY (entity_id) REFERENCES atlas.entity_registry(entity_id);
alter table only "atlas"."location_registry" add constraint "location_registry_geography_key_fkey" FOREIGN KEY (geography_key) REFERENCES atlas.geography_registry(geography_key);
alter table only "atlas"."reparative_calculations" add constraint "reparative_calculations_corruption_indicator_id_fkey" FOREIGN KEY (corruption_indicator_id) REFERENCES atlas.corruption_indicators(id);
alter table only "atlas"."reparative_calculations" add constraint "reparative_calculations_equation_id_fkey" FOREIGN KEY (equation_id) REFERENCES atlas.equations(id);
alter table only "atlas"."schema_registry" add constraint "schema_registry_domain_code_fkey" FOREIGN KEY (domain_code) REFERENCES atlas.domain_registry(domain_code);
alter table only "atlas"."signal_event_entity_resolution" add constraint "signal_event_entity_resolution_entity_fk" FOREIGN KEY (entity_id) REFERENCES atlas.entity_registry(entity_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
alter table only "atlas"."signal_event_entity_resolution" add constraint "signal_event_entity_resolution_event_fk" FOREIGN KEY (stream_id, event_offset) REFERENCES signal_events(stream_id, "offset") ON UPDATE RESTRICT ON DELETE RESTRICT;
alter table only "atlas"."signal_event_entity_resolution" add constraint "signal_event_entity_resolution_first_run_fk" FOREIGN KEY (first_run_id) REFERENCES atlas.signal_event_entity_resolution_run(run_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
alter table only "atlas"."signal_event_entity_resolution" add constraint "signal_event_entity_resolution_last_run_fk" FOREIGN KEY (last_run_id) REFERENCES atlas.signal_event_entity_resolution_run(run_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
alter table only "atlas"."signal_event_entity_resolution" add constraint "signal_event_entity_resolution_rule_fk" FOREIGN KEY (rule_id, rule_version) REFERENCES atlas.signal_event_entity_resolution_rule(rule_id, rule_version) ON UPDATE RESTRICT ON DELETE RESTRICT;
alter table only "atlas"."signal_event_identity" add constraint "signal_event_identity_stream_id_canonical_offset_fkey" FOREIGN KEY (stream_id, canonical_offset) REFERENCES signal_events(stream_id, "offset");
alter table only "atlas"."signal_extractions" add constraint "signal_extractions_signal_id_fkey" FOREIGN KEY (signal_id) REFERENCES atlas.signals(id);
alter table only "atlas"."signal_types" add constraint "signal_types_equation_id_fkey" FOREIGN KEY (equation_id) REFERENCES atlas.equations(id);
alter table only "atlas"."signals" add constraint "signals_signal_type_id_fkey" FOREIGN KEY (signal_type_id) REFERENCES atlas.signal_types(id);
alter table only "public"."agency_registry_canonical" add constraint "agency_registry_canonical_jurisdiction_id_fkey" FOREIGN KEY (jurisdiction_id) REFERENCES jurisdictions_registry(jurisdiction_id);
alter table only "public"."atlas_source_fallback_binding" add constraint "atlas_source_fallback_binding_connector_id_fkey" FOREIGN KEY (connector_id) REFERENCES connector_registry(id) ON DELETE CASCADE;
alter table only "public"."atlas_source_fallback_binding" add constraint "atlas_source_fallback_binding_fallback_connector_id_fkey" FOREIGN KEY (fallback_connector_id) REFERENCES connector_registry(id) ON DELETE CASCADE;
alter table only "public"."atlas_source_health_event" add constraint "atlas_source_health_event_connector_id_fkey" FOREIGN KEY (connector_id) REFERENCES connector_registry(id) ON DELETE CASCADE;
alter table only "public"."atlas_source_health_event" add constraint "atlas_source_health_event_schema_id_fkey" FOREIGN KEY (schema_id) REFERENCES schema_registry(id) ON DELETE SET NULL;
alter table only "public"."atlas_source_schema_snapshot" add constraint "atlas_source_schema_snapshot_connector_id_fkey" FOREIGN KEY (connector_id) REFERENCES connector_registry(id) ON DELETE CASCADE;
alter table only "public"."atlas_source_schema_snapshot" add constraint "atlas_source_schema_snapshot_schema_id_fkey" FOREIGN KEY (schema_id) REFERENCES schema_registry(id) ON DELETE SET NULL;
alter table only "public"."case_law" add constraint "case_law_jurisdiction_id_fkey" FOREIGN KEY (jurisdiction_id) REFERENCES jurisdictions(id);
alter table only "public"."connector_registry" add constraint "connector_registry_schema_id_fkey" FOREIGN KEY (schema_id) REFERENCES schema_registry(id);
alter table only "public"."cursors" add constraint "cursors_stream_id_fkey" FOREIGN KEY (stream_id) REFERENCES streams(stream_id) ON DELETE CASCADE;
alter table only "public"."ingest_jobs" add constraint "ingest_jobs_connector_id_fkey" FOREIGN KEY (connector_id) REFERENCES connector_registry(id);
alter table only "public"."ingest_jobs" add constraint "ingest_jobs_schema_id_fkey" FOREIGN KEY (schema_id) REFERENCES schema_registry(id);
alter table only "public"."investigative_jobs" add constraint "investigative_jobs_cursor_id_fkey" FOREIGN KEY (cursor_id) REFERENCES cursors(cursor_id) ON DELETE SET NULL;
alter table only "public"."investigative_jobs" add constraint "investigative_jobs_stream_id_fkey" FOREIGN KEY (stream_id) REFERENCES streams(stream_id) ON DELETE SET NULL;
alter table only "public"."jurisdictions_registry" add constraint "jurisdictions_registry_parent_jurisdiction_fkey" FOREIGN KEY (parent_jurisdiction) REFERENCES jurisdictions_registry(jurisdiction_id);
alter table only "public"."prime_patterns" add constraint "prime_patterns_job_id_fkey" FOREIGN KEY (job_id) REFERENCES investigative_jobs(job_id) ON DELETE SET NULL;
alter table only "public"."prime_patterns" add constraint "prime_patterns_stream_id_fkey" FOREIGN KEY (stream_id) REFERENCES streams(stream_id) ON DELETE SET NULL;
alter table only "public"."raw_records" add constraint "raw_records_connector_id_fkey" FOREIGN KEY (connector_id) REFERENCES connector_registry(id) ON DELETE CASCADE;
alter table only "public"."signal_events" add constraint "signal_events_stream_id_fkey" FOREIGN KEY (stream_id) REFERENCES streams(stream_id) ON DELETE CASCADE;
alter table only "public"."statutes" add constraint "statutes_jurisdiction_id_fkey" FOREIGN KEY (jurisdiction_id) REFERENCES jurisdictions(id);
alter table only "public"."verification_claims" add constraint "verification_claims_candidate_id_fkey" FOREIGN KEY (candidate_id) REFERENCES extraction_candidates(id) ON DELETE CASCADE;
alter table only "public"."verification_evidence" add constraint "verification_evidence_claim_id_fkey" FOREIGN KEY (claim_id) REFERENCES verification_claims(id) ON DELETE CASCADE;
alter table only "public"."verification_evidence" add constraint "verification_evidence_verification_source_id_fkey" FOREIGN KEY (verification_source_id) REFERENCES verification_sources(id);
alter table only "public"."verified_chronicle" add constraint "verified_chronicle_claim_id_fkey" FOREIGN KEY (claim_id) REFERENCES verification_claims(id);

-- ---- sequence ownership ----
alter sequence "atlas"."action_queue_action_id_seq" owned by "atlas"."action_queue"."action_id";
alter sequence "atlas"."bridge_operational_audit_audit_id_seq" owned by "atlas"."bridge_operational_audit"."audit_id";
alter sequence "atlas"."census_city_data_city_id_seq" owned by "atlas"."census_city_data"."city_id";
alter sequence "atlas"."census_tract_data_tract_id_seq" owned by "atlas"."census_tract_data"."tract_id";
alter sequence "atlas"."civic_map_signals_signal_id_seq" owned by "atlas"."civic_map_signals"."signal_id";
alter sequence "atlas"."contact_registry_contact_id_seq" owned by "atlas"."contact_registry"."contact_id";
alter sequence "atlas"."contract_clauses_clause_id_seq" owned by "atlas"."contract_clauses"."clause_id";
alter sequence "atlas"."court_cases_case_id_seq" owned by "atlas"."court_cases"."case_id";
alter sequence "atlas"."endpoint_probe_queue_queue_id_seq" owned by "atlas"."endpoint_probe_queue"."queue_id";
alter sequence "atlas"."entity_aliases_alias_id_seq" owned by "atlas"."entity_aliases"."alias_id";
alter sequence "atlas"."healthcare_facilities_facility_id_seq" owned by "atlas"."healthcare_facilities"."facility_id";
alter sequence "atlas"."immigration_courts_court_id_seq" owned by "atlas"."immigration_courts"."court_id";
alter sequence "atlas"."inferred_schema_draft_draft_id_seq" owned by "atlas"."inferred_schema_draft"."draft_id";
alter sequence "atlas"."ingest_job_job_id_seq" owned by "atlas"."ingest_job"."job_id";
alter sequence "atlas"."lighthouse_bridge_queue_queue_id_seq" owned by "atlas"."lighthouse_bridge_queue"."queue_id";
alter sequence "atlas"."lighthouse_cases_case_id_seq" owned by "atlas"."lighthouse_cases"."case_id";
alter sequence "atlas"."lighthouse_map_pins_pin_id_seq" owned by "atlas"."lighthouse_map_pins"."pin_id";
alter sequence "atlas"."lighthouse_signals_signal_id_seq" owned by "atlas"."lighthouse_signals"."signal_id";
alter sequence "atlas"."location_registry_location_id_seq" owned by "atlas"."location_registry"."location_id";
alter sequence "atlas"."municipal_bonds_bond_id_seq" owned by "atlas"."municipal_bonds"."bond_id";
alter sequence "atlas"."nonprofit_financials_filing_id_seq" owned by "atlas"."nonprofit_financials"."filing_id";
alter sequence "atlas"."pdf_extraction_queue_queue_id_seq" owned by "atlas"."pdf_extraction_queue"."queue_id";
alter sequence "atlas"."raw_benefits_wa_raw_id_seq" owned by "atlas"."raw_benefits_wa"."raw_id";
alter sequence "atlas"."raw_food_banks_king_county_raw_id_seq" owned by "atlas"."raw_food_banks_king_county"."raw_id";
alter sequence "atlas"."raw_nonprofits_wa_raw_id_seq" owned by "atlas"."raw_nonprofits_wa"."raw_id";
alter sequence "atlas"."raw_regulations_gov_raw_id_seq" owned by "atlas"."raw_regulations_gov"."raw_id";
alter sequence "atlas"."regulatory_comments_comment_id_seq" owned by "atlas"."regulatory_comments"."comment_id";
alter sequence "atlas"."regulatory_final_rules_rule_id_seq" owned by "atlas"."regulatory_final_rules"."rule_id";
alter sequence "atlas"."school_districts_district_id_seq" owned by "atlas"."school_districts"."district_id";
alter sequence "atlas"."utility_rate_cases_rate_id_seq" owned by "atlas"."utility_rate_cases"."rate_id";
alter sequence "atlas"."water_systems_system_id_seq" owned by "atlas"."water_systems"."system_id";
alter sequence "public"."civic_infrastructure_nodes_id_seq" owned by "public"."civic_infrastructure_nodes"."id";

-- ---- indexes ----
CREATE INDEX idx_atlas_case_links_event ON atlas.atlas_case_links USING btree (atlas_convergence_event_id);
CREATE INDEX idx_atlas_case_links_prism ON atlas.atlas_case_links USING btree (prism_case_id);
CREATE INDEX idx_atlas_escalation_links_atlas_escalation_links_atlas_converg ON atlas.atlas_escalation_links USING btree (atlas_convergence_event_id);
CREATE INDEX idx_benefits_offices_city ON atlas.benefits_offices USING btree (city);
CREATE INDEX idx_benefits_offices_jurisdiction ON atlas.benefits_offices USING btree (jurisdiction);
CREATE INDEX idx_benefits_offices_program ON atlas.benefits_offices USING btree (program_type);
CREATE INDEX idx_boa_hash ON atlas.bridge_operational_audit USING btree (bridge_hash);
CREATE INDEX idx_boa_signal ON atlas.bridge_operational_audit USING btree (signal_id);
CREATE INDEX idx_boa_status ON atlas.bridge_operational_audit USING btree (processing_status);
CREATE UNIQUE INDEX uq_boa_bridge_hash ON atlas.bridge_operational_audit USING btree (bridge_hash);
CREATE INDEX idx_bridge_sync_log_bridge ON atlas.bridge_sync_log USING btree (bridge_id, synced_at DESC);
CREATE INDEX idx_bridge_sync_log_bridge_sync_log_bridge_id_fkey_fk ON atlas.bridge_sync_log USING btree (bridge_id);
CREATE INDEX idx_bridge_sync_log_source ON atlas.bridge_sync_log USING btree (source_table, source_record_id);
CREATE INDEX idx_bridge_sync_log_status ON atlas.bridge_sync_log USING btree (status, synced_at DESC);
CREATE INDEX idx_census_city_county ON atlas.census_city_data USING btree (county_fips);
CREATE INDEX idx_census_city_geo ON atlas.census_city_data USING btree (geography_key);
CREATE INDEX idx_census_city_income ON atlas.census_city_data USING btree (median_household_income);
CREATE INDEX idx_census_city_poverty ON atlas.census_city_data USING btree (pct_below_poverty);
CREATE INDEX idx_census_city_rent ON atlas.census_city_data USING btree (median_rent);
CREATE INDEX idx_census_city_state ON atlas.census_city_data USING btree (state_fips);
CREATE INDEX idx_census_tract_county ON atlas.census_tract_data USING btree (county_fips);
CREATE INDEX idx_census_tract_geo ON atlas.census_tract_data USING btree (geography_key);
CREATE INDEX idx_census_tract_poverty ON atlas.census_tract_data USING btree (pct_below_poverty);
CREATE INDEX idx_census_tract_state ON atlas.census_tract_data USING btree (state_fips);
CREATE INDEX idx_atlas_civic_genome_snapshot_as_of ON atlas.civic_genome_external_snapshot USING btree (source_as_of DESC);
CREATE INDEX idx_atlas_civic_genome_snapshot_scope ON atlas.civic_genome_external_snapshot USING gin (scope_json);
CREATE UNIQUE INDEX civic_map_signals_openstates_v1_dedup_idx ON atlas.civic_map_signals USING btree (source_connector_id, signal_type, statute_id, rule_id) WHERE ((generation_method = 'deterministic_rule'::text) AND (source_connector_id IS NOT NULL) AND (statute_id IS NOT NULL) AND (rule_id IS NOT NULL));
CREATE INDEX civic_map_signals_openstates_v1_raw_record_idx ON atlas.civic_map_signals USING btree (raw_record_id) WHERE ((generation_method = 'deterministic_rule'::text) AND (raw_record_id IS NOT NULL));
CREATE INDEX civic_map_signals_openstates_v1_source_idx ON atlas.civic_map_signals USING btree (source_connector_id, detected_at DESC) WHERE (generation_method = 'deterministic_rule'::text);
CREATE INDEX idx_civic_map_signals_civic_map_signals_geography_key_fkey_fk ON atlas.civic_map_signals USING btree (geography_key);
CREATE UNIQUE INDEX idx_civic_map_signals_dedup_key ON atlas.civic_map_signals USING btree (signal_dedup_key) WHERE (signal_dedup_key IS NOT NULL);
CREATE INDEX idx_clause_patterns_category ON atlas.clause_patterns USING btree (category);
CREATE INDEX idx_clause_patterns_domain ON atlas.clause_patterns USING btree (domain_code);
CREATE INDEX idx_clause_patterns_enabled ON atlas.clause_patterns USING btree (enabled) WHERE (enabled = true);
CREATE INDEX idx_contact_registry_entity ON atlas.contact_registry USING btree (entity_id);
CREATE INDEX idx_contact_registry_geo ON atlas.contact_registry USING btree (geography_key);
CREATE INDEX idx_contact_registry_primary ON atlas.contact_registry USING btree (entity_id, contact_type, is_primary) WHERE (is_primary = true);
CREATE INDEX idx_contact_registry_source ON atlas.contact_registry USING btree (source_population_id, source_population_table);
CREATE INDEX idx_contact_registry_type ON atlas.contact_registry USING btree (contact_type);
CREATE INDEX idx_contact_registry_value ON atlas.contact_registry USING btree (contact_value);
CREATE INDEX idx_contract_clauses_category ON atlas.contract_clauses USING btree (clause_category);
CREATE INDEX idx_contract_clauses_contract ON atlas.contract_clauses USING btree (contract_id);
CREATE INDEX idx_contract_clauses_pattern ON atlas.contract_clauses USING btree (pattern_id);
CREATE INDEX idx_contract_clauses_queue ON atlas.contract_clauses USING btree (queue_id);
CREATE INDEX idx_contract_clauses_severity ON atlas.contract_clauses USING btree (severity_score);
CREATE INDEX idx_contract_clauses_status ON atlas.contract_clauses USING btree (status) WHERE ((status)::text = 'pending'::text);
CREATE INDEX idx_convergence_events_pattern ON atlas.convergence_events USING btree (pattern_id);
CREATE INDEX idx_convergence_events_prism ON atlas.convergence_events USING btree (prism_case_id);
CREATE INDEX idx_convergence_events_score ON atlas.convergence_events USING btree (convergence_score DESC);
CREATE INDEX idx_convergence_events_status ON atlas.convergence_events USING btree (status);
CREATE INDEX idx_convergence_patterns_convergence_patterns_convergence_equat ON atlas.convergence_patterns USING btree (convergence_equation_id);
CREATE INDEX idx_corruption_indicators_event ON atlas.corruption_indicators USING btree (convergence_event_id);
CREATE INDEX idx_corruption_indicators_jurisdiction ON atlas.corruption_indicators USING btree (affected_jurisdiction);
CREATE INDEX idx_corruption_indicators_status ON atlas.corruption_indicators USING btree (status);
CREATE INDEX idx_corruption_indicators_type ON atlas.corruption_indicators USING btree (indicator_type);
CREATE INDEX idx_court_cases_date ON atlas.court_cases USING btree (filing_date);
CREATE INDEX idx_court_cases_industry ON atlas.court_cases USING btree (industry_code);
CREATE INDEX idx_court_cases_judge ON atlas.court_cases USING btree (judge_id);
CREATE INDEX idx_court_cases_type ON atlas.court_cases USING btree (nature_of_suit);
CREATE INDEX idx_detection_rules_domain ON atlas.detection_rules USING btree (domain_code);
CREATE INDEX idx_detection_rules_enabled ON atlas.detection_rules USING btree (enabled) WHERE (enabled = true);
CREATE INDEX idx_detection_rules_type ON atlas.detection_rules USING btree (rule_type);
CREATE INDEX idx_discovery_platforms_active ON atlas.discovery_platforms USING btree (active) WHERE (active = true);
CREATE INDEX idx_discovery_platforms_type ON atlas.discovery_platforms USING btree (platform_type);
CREATE INDEX idx_domain_configs_domain_configs_domain_id_fkey_fk ON atlas.domain_configs USING btree (domain_id);
CREATE INDEX idx_probe_queue_activated ON atlas.endpoint_probe_queue USING btree (activated_schema_name);
CREATE INDEX idx_probe_queue_jurisdiction ON atlas.endpoint_probe_queue USING btree (jurisdiction);
CREATE INDEX idx_probe_queue_platform ON atlas.endpoint_probe_queue USING btree (platform_id);
CREATE INDEX idx_probe_queue_status ON atlas.endpoint_probe_queue USING btree (probe_status);
CREATE INDEX idx_entity_alias_entity ON atlas.entity_aliases USING btree (entity_id);
CREATE INDEX idx_entity_alias_text ON atlas.entity_aliases USING btree (alias_text);
CREATE INDEX idx_entity_active ON atlas.entity_registry USING btree (is_active) WHERE (is_active = true);
CREATE INDEX idx_entity_address_hash ON atlas.entity_registry USING btree (canonical_address_hash);
CREATE INDEX idx_entity_email ON atlas.entity_registry USING btree (canonical_email);
CREATE INDEX idx_entity_phone ON atlas.entity_registry USING btree (canonical_phone);
CREATE INDEX idx_entity_population ON atlas.entity_registry USING btree (source_population_id, source_population_table);
CREATE INDEX idx_entity_registry_extraction_method ON atlas.entity_registry USING btree (extraction_method) WHERE (extraction_method IS NOT NULL);
CREATE INDEX idx_entity_registry_raw_record_id ON atlas.entity_registry USING btree (raw_record_id) WHERE (raw_record_id IS NOT NULL);
CREATE INDEX idx_entity_registry_source ON atlas.entity_registry USING gin (source_systems);
CREATE INDEX idx_entity_registry_source_connector_id ON atlas.entity_registry USING btree (source_connector_id) WHERE (source_connector_id IS NOT NULL);
CREATE INDEX idx_entity_registry_source_field ON atlas.entity_registry USING btree (source_field) WHERE (source_field IS NOT NULL);
CREATE INDEX idx_entity_registry_statute_id ON atlas.entity_registry USING btree (statute_id) WHERE (statute_id IS NOT NULL);
CREATE INDEX idx_entity_registry_type ON atlas.entity_registry USING btree (entity_type);
CREATE INDEX idx_fingerprint_matches_matched ON atlas.fingerprint_matches USING btree (matched_fingerprint_id);
CREATE INDEX idx_fingerprint_matches_score ON atlas.fingerprint_matches USING btree (match_score DESC);
CREATE INDEX idx_fingerprint_matches_source ON atlas.fingerprint_matches USING btree (source_fingerprint_id);
CREATE INDEX idx_fingerprints_hash ON atlas.fingerprints USING btree (fingerprint_hash);
CREATE INDEX idx_fingerprints_target ON atlas.fingerprints USING btree (target_id, target_table);
CREATE INDEX idx_fingerprints_type ON atlas.fingerprints USING btree (fingerprint_type);
CREATE INDEX idx_food_banks_accessible ON atlas.food_banks USING btree (wheelchair_accessible) WHERE (wheelchair_accessible = true);
CREATE INDEX idx_food_banks_city ON atlas.food_banks USING btree (city);
CREATE INDEX idx_food_banks_services ON atlas.food_banks USING btree (serves_children, serves_seniors, serves_homeless);
CREATE INDEX idx_food_banks_zip ON atlas.food_banks USING btree (zip_code);
CREATE INDEX idx_geography_registry_geography_registry_parent_key_fkey_fk ON atlas.geography_registry USING btree (parent_key);
CREATE INDEX idx_healthcare_beds ON atlas.healthcare_facilities USING btree (staffed_beds);
CREATE INDEX idx_healthcare_county ON atlas.healthcare_facilities USING btree (county);
CREATE INDEX idx_healthcare_state ON atlas.healthcare_facilities USING btree (state);
CREATE INDEX idx_healthcare_type ON atlas.healthcare_facilities USING btree (facility_type);
CREATE INDEX idx_immigration_backlog ON atlas.immigration_courts USING btree (backlog_days_avg);
CREATE INDEX idx_immigration_state ON atlas.immigration_courts USING btree (state);
CREATE INDEX idx_inferred_draft_confidence ON atlas.inferred_schema_draft USING btree (confidence_score);
CREATE INDEX idx_inferred_draft_queue ON atlas.inferred_schema_draft USING btree (queue_id);
CREATE INDEX idx_ingest_job_ingest_job_connector_id_fkey_fk ON atlas.ingest_job USING btree (connector_id);
CREATE INDEX idx_ingest_job_ingest_job_schema_name_fkey_fk ON atlas.ingest_job USING btree (schema_name);
CREATE INDEX idx_jurisdiction_domains_platform ON atlas.jurisdiction_domains USING btree (platform_id);
CREATE INDEX idx_legal_aid_city ON atlas.legal_aid_providers USING btree (city);
CREATE INDEX idx_legal_aid_fpl ON atlas.legal_aid_providers USING btree (income_threshold_fpl);
CREATE INDEX idx_legal_aid_intake ON atlas.legal_aid_providers USING btree (same_day_intake) WHERE (same_day_intake = true);
CREATE INDEX idx_legal_aid_service ON atlas.legal_aid_providers USING btree (service_type);
CREATE INDEX idx_bridge_queue_created ON atlas.lighthouse_bridge_queue USING btree (created_at);
CREATE INDEX idx_bridge_queue_pending ON atlas.lighthouse_bridge_queue USING btree (status) WHERE ((status)::text = ANY ((ARRAY['pending'::character varying, 'retrying'::character varying])::text[]));
CREATE INDEX idx_bridge_queue_signal ON atlas.lighthouse_bridge_queue USING btree (atlas_signal_id);
CREATE INDEX idx_lighthouse_bridge_queue_lighthouse_bridge_queue_atlas_entit ON atlas.lighthouse_bridge_queue USING btree (atlas_entity_id);
CREATE INDEX idx_lighthouse_cases_entity ON atlas.lighthouse_cases USING btree (primary_entity_id);
CREATE INDEX idx_lighthouse_cases_geo ON atlas.lighthouse_cases USING btree (geography_key);
CREATE INDEX idx_lighthouse_cases_severity ON atlas.lighthouse_cases USING btree (severity_score);
CREATE INDEX idx_lighthouse_cases_status ON atlas.lighthouse_cases USING btree (case_status) WHERE ((case_status)::text = ANY ((ARRAY['open'::character varying, 'investigating'::character varying])::text[]));
CREATE INDEX idx_lighthouse_cases_type ON atlas.lighthouse_cases USING btree (case_type);
CREATE INDEX idx_lighthouse_entities_risk ON atlas.lighthouse_entities USING btree (risk_score);
CREATE INDEX idx_lighthouse_entities_type ON atlas.lighthouse_entities USING btree (entity_type);
CREATE INDEX idx_lighthouse_entities_watchlist ON atlas.lighthouse_entities USING btree (watchlist_status) WHERE ((watchlist_status)::text <> 'none'::text);
CREATE INDEX idx_lighthouse_pins_coords ON atlas.lighthouse_map_pins USING btree (latitude, longitude);
CREATE INDEX idx_lighthouse_pins_entity ON atlas.lighthouse_map_pins USING btree (entity_id);
CREATE INDEX idx_lighthouse_pins_expires ON atlas.lighthouse_map_pins USING btree (expires_at) WHERE (expires_at IS NOT NULL);
CREATE INDEX idx_lighthouse_pins_geo ON atlas.lighthouse_map_pins USING btree (geography_key);
CREATE INDEX idx_lighthouse_pins_type ON atlas.lighthouse_map_pins USING btree (pin_type);
CREATE INDEX idx_lighthouse_signals_geo ON atlas.lighthouse_signals USING btree (geography_key);
CREATE INDEX idx_lighthouse_signals_severity ON atlas.lighthouse_signals USING btree (severity_score);
CREATE INDEX idx_lighthouse_signals_status ON atlas.lighthouse_signals USING btree (lighthouse_status) WHERE ((lighthouse_status)::text = 'new'::text);
CREATE INDEX idx_lighthouse_signals_type ON atlas.lighthouse_signals USING btree (signal_type);
CREATE INDEX idx_live_data_signal_bridge_attempt_run ON atlas.live_data_signal_bridge_attempt USING btree (run_id, status);
CREATE INDEX idx_live_data_signal_bridge_attempt_status ON atlas.live_data_signal_bridge_attempt USING btree (status, queued_at);
CREATE INDEX idx_live_data_signal_candidate_bridge ON atlas.live_data_signal_candidate USING btree (lighthouse_status, detected_at DESC);
CREATE INDEX idx_live_data_signal_candidate_entity ON atlas.live_data_signal_candidate USING gin (entity_ids);
CREATE UNIQUE INDEX live_data_signal_candidate_one_current_semantic_idx ON atlas.live_data_signal_candidate USING btree (semantic_key) WHERE is_current;
CREATE INDEX live_data_signal_candidate_semantic_history_idx ON atlas.live_data_signal_candidate USING btree (semantic_key, is_current, first_detected_at DESC, candidate_id);
CREATE INDEX live_data_signal_candidate_retirement_run_idx ON atlas.live_data_signal_candidate_retirement_v1 USING btree (run_id, lighthouse_status, created_at);
CREATE INDEX idx_location_registry_active ON atlas.location_registry USING btree (is_active) WHERE (is_active = true);
CREATE INDEX idx_location_registry_entity ON atlas.location_registry USING btree (entity_id);
CREATE INDEX idx_location_registry_geo ON atlas.location_registry USING btree (geography_key);
CREATE INDEX idx_location_registry_hash ON atlas.location_registry USING btree (address_hash);
CREATE INDEX idx_muni_bonds_date ON atlas.municipal_bonds USING btree (issue_date);
CREATE INDEX idx_muni_bonds_issuer ON atlas.municipal_bonds USING btree (issuer_id);
CREATE INDEX idx_muni_bonds_underwriter ON atlas.municipal_bonds USING btree (underwriter_id);
CREATE INDEX idx_nonprofit_ein ON atlas.nonprofit_financials USING btree (ein);
CREATE INDEX idx_nonprofit_ratio ON atlas.nonprofit_financials USING btree (program_expense_ratio);
CREATE INDEX idx_nonprofit_year ON atlas.nonprofit_financials USING btree (tax_year);
CREATE INDEX idx_nonprofit_registry_city ON atlas.nonprofit_registry USING btree (city);
CREATE INDEX idx_nonprofit_registry_ntee ON atlas.nonprofit_registry USING btree (ntee_code);
CREATE INDEX idx_nonprofit_registry_program ON atlas.nonprofit_registry USING btree (program_category);
CREATE INDEX idx_nonprofit_registry_revenue ON atlas.nonprofit_registry USING btree (total_revenue);
CREATE INDEX idx_pdf_queue_pending ON atlas.pdf_extraction_queue USING btree (extraction_status) WHERE ((extraction_status)::text = ANY ((ARRAY['pending'::character varying, 'retrying'::character varying])::text[]));
CREATE INDEX idx_pdf_queue_record ON atlas.pdf_extraction_queue USING btree (raw_record_id);
CREATE INDEX idx_pdf_queue_retry ON atlas.pdf_extraction_queue USING btree (next_retry_at) WHERE (next_retry_at IS NOT NULL);
CREATE INDEX idx_pdf_queue_schema ON atlas.pdf_extraction_queue USING btree (schema_name);
CREATE INDEX idx_raw_benefits_wa_job ON atlas.raw_benefits_wa USING btree (ingest_job_id);
CREATE INDEX idx_raw_benefits_wa_mapped ON atlas.raw_benefits_wa USING btree (mapped);
CREATE INDEX idx_raw_food_banks_king_county_job ON atlas.raw_food_banks_king_county USING btree (ingest_job_id);
CREATE INDEX idx_raw_food_banks_king_county_mapped ON atlas.raw_food_banks_king_county USING btree (mapped);
CREATE INDEX idx_raw_nonprofits_wa_job ON atlas.raw_nonprofits_wa USING btree (ingest_job_id);
CREATE INDEX idx_raw_nonprofits_wa_mapped ON atlas.raw_nonprofits_wa USING btree (mapped);
CREATE INDEX idx_raw_regs_gov_job ON atlas.raw_regulations_gov USING btree (ingest_job_id);
CREATE INDEX idx_raw_regs_gov_mapped ON atlas.raw_regulations_gov USING btree (mapped);
CREATE INDEX idx_reg_comments_date ON atlas.regulatory_comments USING btree (submitted_date);
CREATE INDEX idx_reg_comments_docket ON atlas.regulatory_comments USING btree (docket_id);
CREATE INDEX idx_reg_comments_org ON atlas.regulatory_comments USING btree (commenter_org);
CREATE INDEX idx_reg_comments_posted ON atlas.regulatory_comments USING btree (posted_date);
CREATE INDEX idx_reg_comments_source ON atlas.regulatory_comments USING btree (source_system);
CREATE INDEX idx_final_rules_agency ON atlas.regulatory_final_rules USING btree (agency_name);
CREATE INDEX idx_final_rules_docket ON atlas.regulatory_final_rules USING btree (docket_id);
CREATE INDEX idx_reparative_calculations_reparative_calculations_corruption_ ON atlas.reparative_calculations USING btree (corruption_indicator_id);
CREATE INDEX idx_reparative_calculations_reparative_calculations_equation_id ON atlas.reparative_calculations USING btree (equation_id);
CREATE INDEX idx_schema_registry_schema_registry_domain_code_fkey_fk ON atlas.schema_registry USING btree (domain_code);
CREATE INDEX idx_school_districts_county ON atlas.school_districts USING btree (county_fips);
CREATE INDEX idx_school_districts_funding ON atlas.school_districts USING btree (per_pupil_funding);
CREATE INDEX idx_school_districts_state ON atlas.school_districts USING btree (state_fips);
CREATE UNIQUE INDEX signal_event_entity_resolution_current_uidx ON atlas.signal_event_entity_resolution USING btree (stream_id, event_offset, candidate_key, resolver_id) WHERE (is_current = true);
CREATE INDEX signal_event_entity_resolution_entity_idx ON atlas.signal_event_entity_resolution USING btree (entity_id, event_timestamp DESC) WHERE (entity_id IS NOT NULL);
CREATE INDEX signal_event_entity_resolution_event_idx ON atlas.signal_event_entity_resolution USING btree (stream_id, event_offset);
CREATE INDEX signal_event_entity_resolution_rule_idx ON atlas.signal_event_entity_resolution USING btree (rule_id, rule_version, resolution_status);
CREATE INDEX signal_event_entity_resolution_run_idx ON atlas.signal_event_entity_resolution USING btree (last_run_id);
CREATE INDEX signal_event_entity_resolution_status_idx ON atlas.signal_event_entity_resolution USING btree (resolution_status, stream_id, event_offset);
CREATE INDEX signal_event_entity_resolution_rule_manifest_idx ON atlas.signal_event_entity_resolution_rule USING btree (rule_manifest_hash, is_active);
CREATE INDEX signal_event_entity_resolution_run_contract_idx ON atlas.signal_event_entity_resolution_run USING btree (resolver_id, resolver_version, started_at DESC);
CREATE INDEX signal_event_entity_resolution_run_status_idx ON atlas.signal_event_entity_resolution_run USING btree (status, started_at DESC);
CREATE INDEX idx_signal_event_identity_record_key ON atlas.signal_event_identity USING btree (stream_id, source_record_key);
CREATE INDEX idx_signal_event_identity_source ON atlas.signal_event_identity USING btree (source_id, signal_type, last_seen_at DESC);
CREATE INDEX idx_signal_extractions_signal_extractions_signal_id_fkey_fk ON atlas.signal_extractions USING btree (signal_id);
CREATE INDEX idx_signal_types_signal_types_equation_id_fkey_fk ON atlas.signal_types USING btree (equation_id);
CREATE INDEX idx_signals_detected ON atlas.signals USING btree (detected_at DESC);
CREATE INDEX idx_signals_fingerprint ON atlas.signals USING btree (fingerprint_hash);
CREATE INDEX idx_signals_jurisdiction ON atlas.signals USING btree (source_jurisdiction);
CREATE INDEX idx_signals_score ON atlas.signals USING btree (normalized_score DESC);
CREATE INDEX idx_signals_type ON atlas.signals USING btree (signal_type_id);
CREATE INDEX idx_utility_rates_jurisdiction ON atlas.utility_rate_cases USING btree (jurisdiction);
CREATE INDEX idx_utility_rates_territory ON atlas.utility_rate_cases USING btree (service_territory);
CREATE INDEX idx_utility_rates_utility ON atlas.utility_rate_cases USING btree (utility_id);
CREATE INDEX idx_water_county ON atlas.water_systems USING btree (county);
CREATE INDEX idx_water_state ON atlas.water_systems USING btree (state);
CREATE INDEX idx_water_violations ON atlas.water_systems USING btree (sdwa_violation_count);
CREATE INDEX idx_agency_metrics_agency_type ON public.agency_metrics USING btree (agency_type);
CREATE INDEX idx_agency_metrics_entity_id ON public.agency_metrics USING btree (entity_id);
CREATE INDEX idx_agency_metrics_jurisdiction ON public.agency_metrics USING btree (jurisdiction);
CREATE INDEX idx_agency_metrics_metric_type ON public.agency_metrics USING btree (metric_type);
CREATE INDEX idx_agency_registry_canonical_agency_registry_canonical_jurisdi ON public.agency_registry_canonical USING btree (jurisdiction_id);
CREATE INDEX idx_atlas_action_receipt_recent ON public.atlas_action_receipt USING btree (completed_at DESC, action_type, target_id);
CREATE UNIQUE INDEX idx_atlas_source_fallback_active_priority ON public.atlas_source_fallback_binding USING btree (connector_id, fallback_priority) WHERE active;
CREATE INDEX idx_atlas_source_health_event_connector_observed ON public.atlas_source_health_event USING btree (connector_id, observed_at DESC);
CREATE INDEX idx_atlas_source_health_event_status ON public.atlas_source_health_event USING btree (health_status, freshness_status, schema_status, observed_at DESC);
CREATE INDEX idx_atlas_source_schema_snapshot_connector_captured ON public.atlas_source_schema_snapshot USING btree (connector_id, captured_at DESC);
CREATE INDEX idx_canonical_extracted_records_contacts ON public.canonical_extracted_records USING gin (contacts);
CREATE INDEX idx_canonical_extracted_records_entity_type ON public.canonical_extracted_records USING btree (entity_type);
CREATE INDEX idx_canonical_extracted_records_escalation_paths ON public.canonical_extracted_records USING gin (escalation_paths);
CREATE INDEX idx_canonical_extracted_records_facts ON public.canonical_extracted_records USING gin (facts);
CREATE INDEX idx_canonical_extracted_records_jurisdiction ON public.canonical_extracted_records USING btree (jurisdiction);
CREATE INDEX idx_canonical_extracted_records_kind ON public.canonical_extracted_records USING btree (record_kind);
CREATE INDEX idx_canonical_extracted_records_legal_basis ON public.canonical_extracted_records USING gin (legal_basis);
CREATE INDEX idx_canonical_extracted_records_payload ON public.canonical_extracted_records USING gin (canonical_payload);
CREATE INDEX idx_canonical_extracted_records_signal_families ON public.canonical_extracted_records USING gin (signal_families);
CREATE INDEX idx_case_law_court ON public.case_law USING btree (court);
CREATE INDEX idx_case_law_date ON public.case_law USING btree (decision_date DESC);
CREATE INDEX idx_case_law_jur ON public.case_law USING btree (jurisdiction_id);
CREATE INDEX idx_civic_map_resources_city ON public.civic_map_resources USING btree (city);
CREATE INDEX idx_civic_map_resources_source ON public.civic_map_resources USING btree (source_table, source_id);
CREATE INDEX idx_civic_map_resources_state ON public.civic_map_resources USING btree (state);
CREATE INDEX idx_civic_map_resources_type ON public.civic_map_resources USING btree (resource_type);
CREATE INDEX idx_connector_registry_connector_registry_schema_id_fkey_fk ON public.connector_registry USING btree (schema_id);
CREATE INDEX idx_cursors_stream ON public.cursors USING btree (stream_id);
CREATE INDEX idx_extraction_candidates_candidate_kind ON public.extraction_candidates USING btree (candidate_kind);
CREATE INDEX idx_extraction_candidates_payload ON public.extraction_candidates USING gin (extracted_payload);
CREATE INDEX idx_extraction_candidates_signal_families ON public.extraction_candidates USING gin (signal_families);
CREATE INDEX idx_extraction_candidates_source_hash ON public.extraction_candidates USING btree (source_hash);
CREATE INDEX idx_ingest_jobs_ingest_jobs_connector_id_fkey_fk ON public.ingest_jobs USING btree (connector_id);
CREATE INDEX idx_ingest_jobs_ingest_jobs_schema_id_fkey_fk ON public.ingest_jobs USING btree (schema_id);
CREATE INDEX idx_jobs_connector ON public.ingest_jobs USING btree (connector_id, started_at DESC);
CREATE INDEX idx_jobs_status ON public.ingest_jobs USING btree (status);
CREATE INDEX idx_investigative_jobs_investigative_jobs_cursor_id_fkey_fk ON public.investigative_jobs USING btree (cursor_id);
CREATE INDEX idx_investigative_jobs_investigative_jobs_stream_id_fkey_fk ON public.investigative_jobs USING btree (stream_id);
CREATE INDEX idx_investigative_jobs_stream_created ON public.investigative_jobs USING btree (stream_id, created_at DESC);
CREATE INDEX idx_jurisdictions_geo_type ON public.jurisdictions USING btree (geo_type);
CREATE INDEX idx_jurisdictions_state_fips ON public.jurisdictions USING btree (state_fips);
CREATE INDEX idx_jurisdictions_registry_jurisdictions_registry_parent_jurisd ON public.jurisdictions_registry USING btree (parent_jurisdiction);
CREATE INDEX idx_prime_patterns_filters ON public.prime_patterns USING btree (module, jurisdiction, detected_at DESC);
CREATE INDEX idx_prime_patterns_prime_patterns_job_id_fkey_fk ON public.prime_patterns USING btree (job_id);
CREATE INDEX idx_prime_patterns_prime_patterns_stream_id_fkey_fk ON public.prime_patterns USING btree (stream_id);
CREATE INDEX idx_prime_patterns_stream ON public.prime_patterns USING btree (stream_id, detected_at DESC);
CREATE INDEX idx_raw_connector_status ON public.raw_records USING btree (connector_id, process_status);
CREATE INDEX idx_raw_hash ON public.raw_records USING btree (sha256_hash);
CREATE INDEX idx_raw_records_raw_records_connector_id_fkey_fk ON public.raw_records USING btree (connector_id);
CREATE INDEX idx_signal_definitions_domain ON public.signal_definitions USING btree (domain);
CREATE INDEX idx_signal_definitions_severity ON public.signal_definitions USING btree (severity_default);
CREATE INDEX idx_signal_events_runtime_summary_v1 ON public.signal_events USING btree (stream_id, signal_type, "timestamp", ingested_at) INCLUDE (event_identity_hash);
CREATE INDEX idx_signal_events_signal_events_stream_id_fkey_fk ON public.signal_events USING btree (stream_id);
CREATE INDEX idx_signal_events_source ON public.signal_events USING btree (source_id, jurisdiction_id, module_hint);
CREATE INDEX idx_signal_events_stream_offset ON public.signal_events USING btree (stream_id, "offset");
CREATE INDEX idx_signal_events_stream_timestamp ON public.signal_events USING btree (stream_id, "timestamp");
CREATE UNIQUE INDEX signal_events_identity_uidx ON public.signal_events USING btree (stream_id, event_identity_hash) WHERE (event_identity_hash IS NOT NULL);
CREATE INDEX idx_statutes_jur ON public.statutes USING btree (jurisdiction_id);
CREATE INDEX idx_statutes_status ON public.statutes USING btree (status, effective_date);
CREATE INDEX idx_statutes_subject ON public.statutes USING gin (subject);
CREATE UNIQUE INDEX statutes_external_id_jurisdiction_unique ON public.statutes USING btree (external_id, jurisdiction) WHERE ((external_id IS NOT NULL) AND (jurisdiction IS NOT NULL));
CREATE INDEX idx_verification_claims_candidate_id ON public.verification_claims USING btree (candidate_id);
CREATE INDEX idx_verification_claims_conflict_status ON public.verification_claims USING btree (conflict_status);
CREATE INDEX idx_verification_claims_jurisdiction ON public.verification_claims USING btree (jurisdiction);
CREATE INDEX idx_verification_claims_payload ON public.verification_claims USING gin (normalized_payload);
CREATE INDEX idx_verification_claims_status ON public.verification_claims USING btree (verification_status);
CREATE INDEX idx_verification_claims_type ON public.verification_claims USING btree (claim_type);
CREATE INDEX idx_verification_evidence_claim_id ON public.verification_evidence USING btree (claim_id);
CREATE INDEX idx_verification_evidence_hash ON public.verification_evidence USING btree (evidence_hash);
CREATE INDEX idx_verification_evidence_source_id ON public.verification_evidence USING btree (verification_source_id);
CREATE INDEX idx_verification_evidence_supports_claim ON public.verification_evidence USING btree (supports_claim);
CREATE INDEX idx_verification_sources_authority_tier ON public.verification_sources USING btree (authority_tier);
CREATE INDEX idx_verification_sources_jurisdiction ON public.verification_sources USING btree (jurisdiction);
CREATE INDEX idx_verification_sources_url ON public.verification_sources USING btree (source_url);
CREATE INDEX idx_verified_chronicle_claim_id ON public.verified_chronicle USING btree (claim_id);
CREATE INDEX idx_verified_chronicle_entity ON public.verified_chronicle USING btree (entity_type, entity_name);
CREATE INDEX idx_verified_chronicle_jurisdiction ON public.verified_chronicle USING btree (jurisdiction);
CREATE INDEX idx_verified_chronicle_kind ON public.verified_chronicle USING btree (chronicle_kind);
CREATE INDEX idx_verified_chronicle_payload ON public.verified_chronicle USING gin (immutable_payload);
CREATE INDEX idx_verified_chronicle_provenance ON public.verified_chronicle USING gin (provenance);
CREATE INDEX idx_verified_chronicle_signal_families ON public.verified_chronicle USING gin (signal_families);

-- ---- functions ----
CREATE OR REPLACE FUNCTION atlas.bridge_process_queue_v3(p_batch_size integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'atlas'
AS $function$
  select jsonb_build_object(
    'processed', 0,
    'results', '[]'::jsonb,
    'processed_at', clock_timestamp(),
    'quarantined', true,
    'reason', 'legacy_lighthouse_queue_contract_disabled'
  );
$function$;
CREATE OR REPLACE FUNCTION atlas.bridge_sync_to_lighthouse(p_signal_id bigint DEFAULT NULL::bigint, p_batch_size integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'atlas'
AS $function$
        DECLARE
            v_bridge RECORD;
            v_signal RECORD;
            v_synced INTEGER := 0;
            v_errors INTEGER := 0;
            v_start_ts TIMESTAMPTZ := clock_timestamp();
            v_case_id UUID;
            v_snapshot_id UUID;
            v_pipeline_run_id UUID;
            v_finding_id UUID;
            v_signal_uuid UUID;
            v_severity TEXT;
        BEGIN
            -- Get bridge config
            SELECT * INTO v_bridge FROM atlas.bridge_config
            WHERE bridge_id = 'atlas-to-lighthouse' AND enabled = true;

            IF v_bridge IS NULL THEN
                RETURN jsonb_build_object('error', 'Bridge atlas-to-lighthouse not found or disabled');
            END IF;

            -- Iterate over civic_map_signals not yet synced
            FOR v_signal IN
                SELECT cms.*
                FROM atlas.civic_map_signals cms
                LEFT JOIN atlas.bridge_sync_log bsl ON (
                    bsl.bridge_id = 'atlas-to-lighthouse'
                    AND bsl.source_table = 'civic_map_signals'
                    AND bsl.source_record_id = cms.signal_id::text
                    AND bsl.status = 'sent'
                )
                WHERE (p_signal_id IS NULL OR cms.signal_id = p_signal_id)
                AND bsl.log_id IS NULL
                LIMIT p_batch_size
            LOOP
                BEGIN
                    -- Generate UUIDs for the Lighthouse chain
                    v_case_id := gen_random_uuid();
                    v_snapshot_id := gen_random_uuid();
                    v_pipeline_run_id := gen_random_uuid();
                    v_finding_id := gen_random_uuid();
                    v_signal_uuid := gen_random_uuid();

                    -- Map severity score to Lighthouse enum
                    v_severity := CASE
                        WHEN v_signal.severity_score >= 8.0 THEN 'critical'
                        WHEN v_signal.severity_score >= 6.0 THEN 'high'
                        WHEN v_signal.severity_score >= 4.0 THEN 'medium'
                        ELSE 'low'
                    END;

                    -- Step 1: Create case in Lighthouse
                    PERFORM net.http_post(
                        url := v_bridge.target_url || '/rest/v1/cases',
                        headers := jsonb_build_object(
                            'apikey', v_bridge.target_service_key,
                            'Authorization', 'Bearer ' || v_bridge.target_service_key,
                            'Content-Type', 'application/json',
                            'Prefer', 'return=representation'
                        ),
                        body := jsonb_build_object(
                            'id', v_case_id,
                            'case_number', 'ATLAS-CMS-' || v_signal.signal_id,
                            'title', 'Civic Signal: ' || v_signal.signal_type || ' in ' || COALESCE(v_signal.geography_key, 'UNKNOWN'),
                            'description', 'Atlas civic map signal detected. Type: ' || v_signal.signal_type || ', Severity: ' || COALESCE(v_signal.severity_score::text, 'N/A') || ', Source: ' || COALESCE(v_signal.source_table, 'N/A'),
                            'case_type', 'atlas_civic_signal',
                            'jurisdiction', COALESCE(v_signal.geography_key, 'US'),
                            'domain', COALESCE((v_signal.metadata_json->>'domain_code')::text, 'CIVIC'),
                            'status', 'open',
                            'priority_level', v_severity,
                            'owner_ref', 'atlas-bridge'
                        )
                    );

                    -- Step 2: Create snapshot
                    PERFORM net.http_post(
                        url := v_bridge.target_url || '/rest/v1/snapshots',
                        headers := jsonb_build_object(
                            'apikey', v_bridge.target_service_key,
                            'Authorization', 'Bearer ' || v_bridge.target_service_key,
                            'Content-Type', 'application/json',
                            'Prefer', 'return=representation'
                        ),
                        body := jsonb_build_object(
                            'id', v_snapshot_id,
                            'case_id', v_case_id,
                            'snapshot_hash', md5(v_signal.signal_id::text || v_signal.signal_type || now()::text),
                            'status', 'sealed'
                        )
                    );

                    -- Step 3: Create pipeline_run
                    PERFORM net.http_post(
                        url := v_bridge.target_url || '/rest/v1/pipeline_runs',
                        headers := jsonb_build_object(
                            'apikey', v_bridge.target_service_key,
                            'Authorization', 'Bearer ' || v_bridge.target_service_key,
                            'Content-Type', 'application/json',
                            'Prefer', 'return=representation'
                        ),
                        body := jsonb_build_object(
                            'id', v_pipeline_run_id,
                            'case_id', v_case_id,
                            'snapshot_id', v_snapshot_id,
                            'status', 'completed',
                            'ruleset_version', 'atlas-bridge-v1'
                        )
                    );

                    -- Step 4: Create finding
                    PERFORM net.http_post(
                        url := v_bridge.target_url || '/rest/v1/findings',
                        headers := jsonb_build_object(
                            'apikey', v_bridge.target_service_key,
                            'Authorization', 'Bearer ' || v_bridge.target_service_key,
                            'Content-Type', 'application/json',
                            'Prefer', 'return=representation'
                        ),
                        body := jsonb_build_object(
                            'id', v_finding_id,
                            'case_id', v_case_id,
                            'claim_id', gen_random_uuid(),
                            'snapshot_id', v_snapshot_id,
                            'pipeline_run_id', v_pipeline_run_id,
                            'finding_text', 'Atlas civic map signal: ' || v_signal.signal_type || ' detected at severity ' || COALESCE(v_signal.severity_score::text, 'N/A') || ' from source ' || COALESCE(v_signal.source_table, 'unknown'),
                            'confidence_score', COALESCE(v_signal.severity_score / 10.0, 0.5)
                        )
                    );

                    -- Step 5: Create detected_signal
                    PERFORM net.http_post(
                        url := v_bridge.target_url || '/rest/v1/detected_signals',
                        headers := jsonb_build_object(
                            'apikey', v_bridge.target_service_key,
                            'Authorization', 'Bearer ' || v_bridge.target_service_key,
                            'Content-Type', 'application/json',
                            'Prefer', 'return=representation'
                        ),
                        body := jsonb_build_object(
                            'id', v_signal_uuid,
                            'case_id', v_case_id,
                            'finding_id', v_finding_id,
                            'snapshot_id', v_snapshot_id,
                            'pipeline_run_id', v_pipeline_run_id,
                            'signal_type', v_signal.signal_type,
                            'signal_description', 'Atlas civic map signal from ' || COALESCE(v_signal.source_table, 'unknown') || '. Geography: ' || COALESCE(v_signal.geography_key, 'N/A') || '. Source record: ' || COALESCE(v_signal.source_record_id, 'N/A'),
                            'severity', v_severity,
                            'confidence_score', COALESCE(v_signal.severity_score / 10.0, 0.5)
                        )
                    );

                    -- Log success
                    INSERT INTO atlas.bridge_sync_log (bridge_id, sync_type, source_table, source_record_id, target_table, target_record_id, status, request_payload)
                    VALUES ('atlas-to-lighthouse', 'sync_civic_signal', 'civic_map_signals', v_signal.signal_id::text, 'detected_signals', v_signal_uuid::text, 'sent',
                        jsonb_build_object(
                            'signal_type', v_signal.signal_type,
                            'geography_key', v_signal.geography_key,
                            'severity', v_severity,
                            'case_id', v_case_id,
                            'finding_id', v_finding_id
                        ));

                    v_synced := v_synced + 1;
                EXCEPTION WHEN OTHERS THEN
                    INSERT INTO atlas.bridge_sync_log (bridge_id, sync_type, source_table, source_record_id, status, error_message)
                    VALUES ('atlas-to-lighthouse', 'sync_civic_signal', 'civic_map_signals', v_signal.signal_id::text, 'error', SQLERRM);
                    v_errors := v_errors + 1;
                END;
            END LOOP;

            -- Update bridge status
            UPDATE atlas.bridge_config SET
                last_sync_at = now(),
                last_sync_status = CASE WHEN v_errors = 0 THEN 'success' ELSE 'partial' END,
                last_sync_error = CASE WHEN v_errors > 0 THEN v_errors || ' errors during sync' ELSE NULL END,
                updated_at = now()
            WHERE bridge_id = 'atlas-to-lighthouse';

            RETURN jsonb_build_object(
                'success', true,
                'synced', v_synced,
                'errors', v_errors,
                'duration_ms', EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_ts)::integer
            );
        END;
        $function$;
CREATE OR REPLACE FUNCTION atlas.claim_pdf_extraction_job(p_worker_id character varying)
 RETURNS TABLE(queue_id bigint, schema_name character varying, raw_record_id bigint, pdf_url character varying, download_attempts integer)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'atlas'
AS $function$
BEGIN
    RETURN QUERY
    WITH claimed AS (
        SELECT q.queue_id
        FROM pdf_extraction_queue q
        WHERE q.extraction_status IN ('pending','retrying')
          AND (q.next_retry_at IS NULL OR q.next_retry_at <= NOW())
        ORDER BY q.created_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED
    )
    UPDATE pdf_extraction_queue q
    SET
        extraction_status = 'downloading',
        download_attempts = q.download_attempts + 1,
        updated_at = NOW()
    FROM claimed c
    WHERE q.queue_id = c.queue_id
    RETURNING q.queue_id, q.schema_name, q.raw_record_id, q.pdf_url, q.download_attempts;
END;
$function$;
CREATE OR REPLACE FUNCTION atlas.complete_pdf_extraction(p_queue_id bigint, p_extracted_text text, p_extraction_method character varying, p_extraction_confidence numeric, p_page_count integer, p_clauses_found jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'atlas'
AS $function$
DECLARE
    v_count INT := 0;
    v_clause JSONB;
BEGIN
    -- Update queue record
    UPDATE pdf_extraction_queue
    SET
        extraction_status = 'analyzed',
        extracted_text = p_extracted_text,
        text_hash = ENCODE(DIGEST(p_extracted_text, 'sha256'), 'hex'),
        extraction_method = p_extraction_method,
        extraction_confidence = p_extraction_confidence,
        page_count = p_page_count,
        clauses_found_count = jsonb_array_length(p_clauses_found),
        analyzed_at = NOW(),
        updated_at = NOW()
    WHERE queue_id = p_queue_id;

    -- Insert findings into contract_clauses
    FOR v_clause IN SELECT jsonb_array_elements(p_clauses_found)
    LOOP
        INSERT INTO contract_clauses (
            contract_id, source_system, queue_id, pattern_id, clause_category,
            clause_text, clause_context, severity_score, confidence_score,
            extraction_confidence, page_number, char_offset, pdf_url
        )
        SELECT
            (SELECT source_record_id FROM pdf_extraction_queue WHERE queue_id = p_queue_id),
            (SELECT schema_name FROM pdf_extraction_queue WHERE queue_id = p_queue_id),
            p_queue_id,
            v_clause->>'pattern_id',
            (SELECT category FROM clause_patterns WHERE pattern_id = v_clause->>'pattern_id'),
            v_clause->>'matched_text',
            v_clause->>'context',
            (v_clause->>'severity')::DECIMAL,
            0.85,  -- pattern match confidence
            p_extraction_confidence,
            (v_clause->>'page')::INT,
            (v_clause->>'offset')::INT,
            (SELECT pdf_url FROM pdf_extraction_queue WHERE queue_id = p_queue_id)
        ON CONFLICT (contract_id, pattern_id, char_offset) DO NOTHING;

        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$function$;
CREATE OR REPLACE FUNCTION atlas.enforce_live_data_signal_candidate_currentness_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'atlas', 'extensions', 'pg_temp'
AS $function$
declare
  v_prior_current_id uuid;
  v_transition_at timestamptz;
  v_reactivation boolean := false;
begin
  new.semantic_key := atlas.live_data_signal_candidate_semantic_key_v2(
    new.rule_id,
    new.signal_type,
    new.primary_stream_id,
    new.jurisdiction_id,
    new.title,
    new.entity_ids
  );

  if tg_op = 'UPDATE' then
    new.first_detected_at := old.first_detected_at;
    if new.candidate_hash = old.candidate_hash then
      new.detected_at := old.detected_at;
    end if;

    if new.last_run_id is not distinct from old.last_run_id then
      return new;
    end if;

    v_transition_at := case
      when new.last_replayed_at is distinct from old.last_replayed_at
        then coalesce(new.last_replayed_at, clock_timestamp())
      else clock_timestamp()
    end;
    v_reactivation := old.is_current is false
      and new.candidate_hash = old.candidate_hash;
  else
    if new.first_detected_at is null then
      new.first_detected_at := coalesce(new.detected_at, clock_timestamp());
    end if;
    v_transition_at := coalesce(new.detected_at, new.first_detected_at, clock_timestamp());
  end if;

  select candidate_id
    into v_prior_current_id
    from atlas.live_data_signal_candidate
   where semantic_key = new.semantic_key
     and is_current is true
     and candidate_id <> new.candidate_id
     -- Critical ON CONFLICT guard: a BEFORE INSERT trigger must never mutate
     -- the existing row that candidate_hash conflict resolution is about to update.
     and candidate_hash <> new.candidate_hash
   order by coalesce(last_replayed_at, detected_at, first_detected_at) desc,
            candidate_id desc
   limit 1
   for update;

  if v_prior_current_id is not null then
    update atlas.live_data_signal_candidate
       set is_current = false,
           retired_at = v_transition_at
     where candidate_id = v_prior_current_id;

    if v_reactivation then
      new.supersedes_candidate_id := old.supersedes_candidate_id;
    else
      new.supersedes_candidate_id := v_prior_current_id;
    end if;
  end if;

  new.is_current := true;
  new.retired_at := null;
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION atlas.engine_activate_discovered_schema(p_draft_id bigint, p_reviewed_by character varying, p_review_notes text)
 RETURNS TABLE(schema_name character varying, connector_id character varying, activated_at timestamp with time zone)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'atlas'
AS $function$
DECLARE
    v_draft RECORD;
    v_queue RECORD;
    v_schema_name VARCHAR(128);
    v_connector_id VARCHAR(64);
BEGIN
    SELECT * INTO v_draft FROM atlas.inferred_schema_draft WHERE draft_id = p_draft_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Draft % not found', p_draft_id;
    END IF;

    SELECT * INTO v_queue FROM atlas.endpoint_probe_queue WHERE queue_id = v_draft.queue_id;

    v_schema_name := v_draft.draft_schema_name;
    v_connector_id := COALESCE(v_draft.draft_connector_json->>'connector_id', v_queue.platform_id || '_' || v_queue.jurisdiction);

    INSERT INTO atlas.connector_registry (
        connector_id, display_name, base_url, auth_type,
        config_template, pagination_strategy, rate_limit_rps, created_at
    )
    SELECT
        v_connector_id,
        v_queue.dataset_name,
        (SELECT domain FROM atlas.jurisdiction_domains WHERE jurisdiction = v_queue.jurisdiction AND platform_id = v_queue.platform_id LIMIT 1),
        (SELECT default_auth_type FROM atlas.discovery_platforms WHERE platform_id = v_queue.platform_id),
        '{}',
        (SELECT default_pagination_strategy FROM atlas.discovery_platforms WHERE platform_id = v_queue.platform_id),
        (SELECT rate_limit_rps FROM atlas.discovery_platforms WHERE platform_id = v_queue.platform_id),
        NOW()
    ON CONFLICT (connector_id) DO NOTHING;

    INSERT INTO atlas.schema_registry (schema_name, schema_def, created_at)
    VALUES (v_schema_name, v_draft.draft_schema_json, NOW())
    ON CONFLICT (schema_name) DO UPDATE SET
        schema_def = EXCLUDED.schema_def,
        updated_at = NOW();

    UPDATE atlas.endpoint_probe_queue
    SET probe_status = 'approved',
        reviewed_by = p_reviewed_by,
        reviewed_at = NOW(),
        review_notes = p_review_notes,
        activated_schema_name = v_schema_name,
        activated_connector_id = v_connector_id
    WHERE queue_id = v_draft.queue_id;

    UPDATE atlas.inferred_schema_draft
    SET approved_by = p_reviewed_by,
        approved_at = NOW(),
        approval_notes = p_review_notes
    WHERE draft_id = p_draft_id;

    schema_name := v_schema_name;
    connector_id := v_connector_id;
    activated_at := NOW();
    RETURN NEXT;
END;
$function$;
CREATE OR REPLACE FUNCTION atlas.engine_extract_entity(p_schema_name character varying, p_target_table character varying, p_source_record_id character varying, p_jurisdiction character varying, p_entity_type character varying, p_name character varying, p_address character varying, p_email character varying, p_phone character varying, p_raw_payload jsonb)
 RETURNS character varying
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'atlas'
AS $function$
DECLARE
    v_entity_id VARCHAR(128);
    v_name_hash VARCHAR(64);
    v_address_hash VARCHAR(64);
    v_normalized_name VARCHAR(512);
    v_normalized_address VARCHAR(512);
    v_normalized_phone VARCHAR(32);
    v_existing_systems JSONB;
BEGIN
    IF p_name IS NULL OR TRIM(p_name) = '' THEN
        RETURN NULL;
    END IF;

    v_normalized_name := UPPER(REGEXP_REPLACE(TRIM(p_name), '[^A-Z0-9]', '', 'g'));
    v_normalized_address := UPPER(REGEXP_REPLACE(TRIM(COALESCE(p_address, '')), '\s+', ' ', 'g'));
    v_normalized_phone := REGEXP_REPLACE(COALESCE(p_phone, ''), '[^0-9]', '', 'g');

    v_name_hash := ENCODE(extensions.digest(v_normalized_name::bytea, 'sha256'), 'hex');
    v_address_hash := CASE WHEN v_normalized_address <> ''
        THEN ENCODE(extensions.digest(v_normalized_address::bytea, 'sha256'), 'hex')
        ELSE NULL END;

    v_entity_id := ENCODE(extensions.digest(
        (v_normalized_name || COALESCE(v_address_hash, '') || p_entity_type)::bytea,
        'sha256'
    ), 'hex');

    INSERT INTO atlas.entity_registry (
        entity_id, entity_type, primary_name, canonical_address,
        canonical_address_hash, canonical_email, canonical_phone,
        first_seen_jurisdiction, source_population_id, source_population_table,
        source_systems, last_verified
    ) VALUES (
        v_entity_id, p_entity_type, p_name, p_address,
        v_address_hash, p_email, v_normalized_phone,
        p_jurisdiction, p_source_record_id, p_target_table,
        jsonb_build_array(p_schema_name), NOW()
    )
    ON CONFLICT (entity_id) DO UPDATE SET
        canonical_email = COALESCE(EXCLUDED.canonical_email, atlas.entity_registry.canonical_email),
        canonical_phone = COALESCE(EXCLUDED.canonical_phone, atlas.entity_registry.canonical_phone),
        last_verified = NOW(),
        updated_at = NOW()
    RETURNING source_systems INTO v_existing_systems;

    IF NOT v_existing_systems @> jsonb_build_array(p_schema_name) THEN
        UPDATE atlas.entity_registry
        SET source_systems = source_systems || jsonb_build_array(p_schema_name),
            jurisdiction_count = (
                SELECT COUNT(DISTINCT source_population_table)
                FROM atlas.entity_registry e2
                WHERE e2.entity_id = v_entity_id
            ),
            updated_at = NOW()
        WHERE entity_id = v_entity_id;
    END IF;

    IF p_email IS NOT NULL AND TRIM(p_email) <> '' THEN
        INSERT INTO atlas.contact_registry (
            entity_id, source_population_id, source_population_table,
            source_schema_name, contact_type, contact_value, normalized_value
        ) VALUES (
            v_entity_id, p_source_record_id, p_target_table,
            p_schema_name, 'email', TRIM(p_email), LOWER(TRIM(p_email))
        )
        ON CONFLICT (entity_id, contact_type, contact_value) DO UPDATE SET
            last_seen_at = NOW(),
            updated_at = NOW();
    END IF;

    IF v_normalized_phone <> '' THEN
        INSERT INTO atlas.contact_registry (
            entity_id, source_population_id, source_population_table,
            source_schema_name, contact_type, contact_value, normalized_value
        ) VALUES (
            v_entity_id, p_source_record_id, p_target_table,
            p_schema_name, 'phone', v_normalized_phone, v_normalized_phone
        )
        ON CONFLICT (entity_id, contact_type, contact_value) DO UPDATE SET
            last_seen_at = NOW(),
            updated_at = NOW();
    END IF;

    IF p_address IS NOT NULL AND TRIM(p_address) <> '' THEN
        INSERT INTO atlas.location_registry (
            entity_id, source_population_id, source_population_table,
            address_raw, address_normalized, address_hash, location_type
        ) VALUES (
            v_entity_id, p_source_record_id, p_target_table,
            p_address, v_normalized_address, v_address_hash, 'service_site'
        )
        ON CONFLICT (entity_id, address_hash) DO UPDATE SET
            updated_at = NOW();
    END IF;

    RETURN v_entity_id;
END;
$function$;
CREATE OR REPLACE FUNCTION atlas.engine_probe_platform(p_platform_id character varying, p_jurisdiction character varying, p_listing_response jsonb)
 RETURNS TABLE(queue_id bigint, dataset_name character varying, endpoint_url character varying, probe_status character varying)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'atlas'
AS $function$
DECLARE
    v_platform RECORD;
    v_domain TEXT;
    v_dataset JSONB;
    v_dataset_id TEXT;
    v_dataset_name TEXT;
    v_queue_id BIGINT;
    v_metadata_url TEXT;
BEGIN
    SELECT * INTO v_platform
    FROM atlas.discovery_platforms
    WHERE platform_id = p_platform_id AND active = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown or inactive platform: %', p_platform_id;
    END IF;

    SELECT domain INTO v_domain
    FROM atlas.jurisdiction_domains
    WHERE jurisdiction = p_jurisdiction
      AND platform_id = p_platform_id
      AND is_active = TRUE
    LIMIT 1;

    IF v_domain IS NULL THEN
        RAISE EXCEPTION 'No domain configured for jurisdiction % on platform %', p_jurisdiction, p_platform_id;
    END IF;

    FOR v_dataset IN
        SELECT jsonb_array_elements(p_listing_response)
    LOOP
        v_dataset_id := v_dataset->>(REPLACE(v_platform.dataset_id_path, '[]', ''));
        v_dataset_name := v_dataset->>(REPLACE(v_platform.dataset_name_path, '[]', ''));

        IF v_dataset_id IS NULL THEN
            CONTINUE;
        END IF;

        v_metadata_url := REPLACE(v_platform.metadata_endpoint_template, '{{domain}}', v_domain);
        v_metadata_url := REPLACE(v_metadata_url, '{{dataset_id}}', v_dataset_id);

        INSERT INTO atlas.endpoint_probe_queue (
            platform_id, jurisdiction, endpoint_url, dataset_name, dataset_id,
            probe_status, last_probed_at, response_sample
        ) VALUES (
            p_platform_id, p_jurisdiction, v_metadata_url,
            COALESCE(v_dataset_name, 'Untitled Dataset'), v_dataset_id,
            'schema_inferred', NOW(), v_dataset
        )
        ON CONFLICT (platform_id, jurisdiction, dataset_id)
        DO UPDATE SET
            dataset_name = EXCLUDED.dataset_name,
            last_probed_at = NOW(),
            response_sample = EXCLUDED.response_sample,
            probe_status = 'schema_inferred'
        RETURNING atlas.endpoint_probe_queue.queue_id INTO v_queue_id;

        queue_id := v_queue_id;
        dataset_name := COALESCE(v_dataset_name, 'Untitled Dataset');
        endpoint_url := v_metadata_url;
        probe_status := 'schema_inferred';

        RETURN NEXT;
    END LOOP;

    RETURN;
END;
$function$;
CREATE OR REPLACE FUNCTION atlas.entity_type_compatible_v1(p_expected_entity_type text, p_actual_entity_type text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public', 'atlas', 'extensions'
AS $function$
  SELECT CASE
    WHEN p_expected_entity_type IS NULL OR btrim(p_expected_entity_type) = '' THEN true
    WHEN p_actual_entity_type IS NULL OR btrim(p_actual_entity_type) = '' THEN false
    WHEN lower(p_expected_entity_type) = lower(p_actual_entity_type) THEN true
    WHEN lower(p_expected_entity_type) = 'organization' THEN lower(p_actual_entity_type) IN (
      'organization',
      'corporation',
      'nonprofit',
      'political_committee',
      'government_agency',
      'financial_institution',
      'telecom_company',
      'media_company',
      'contractor_business',
      'landlord_entity'
    )
    WHEN lower(p_expected_entity_type) = 'government_agency' THEN lower(p_actual_entity_type) IN (
      'government_agency',
      'agency',
      'court'
    )
    WHEN lower(p_expected_entity_type) = 'person' THEN lower(p_actual_entity_type) IN (
      'person',
      'individual_person',
      'legislator',
      'lobbyist',
      'judge'
    )
    WHEN lower(p_expected_entity_type) = 'nonprofit' THEN lower(p_actual_entity_type) = 'nonprofit'
    ELSE false
  END;
$function$;
CREATE OR REPLACE FUNCTION atlas.event_entity_source_system_text_v1(p_source_population_table text, p_source_systems jsonb, p_metadata jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public', 'atlas', 'extensions'
AS $function$
DECLARE
  v_source_systems_text text := '';
BEGIN
  IF jsonb_typeof(p_source_systems) = 'array' THEN
    SELECT COALESCE(string_agg(value, ' ' ORDER BY value), '')
    INTO v_source_systems_text
    FROM jsonb_array_elements_text(p_source_systems) AS source_system(value);
  END IF;

  RETURN lower(concat_ws(
    ' ',
    COALESCE(p_source_population_table, ''),
    v_source_systems_text,
    COALESCE(p_metadata->>'source', '')
  ));
END;
$function$;
CREATE OR REPLACE FUNCTION atlas.fail_pdf_extraction(p_queue_id bigint, p_error_message text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'atlas'
AS $function$
DECLARE
    v_attempts INT;
    v_max INT;
BEGIN
    SELECT download_attempts, max_attempts
    INTO v_attempts, v_max
    FROM pdf_extraction_queue
    WHERE queue_id = p_queue_id;

    IF v_attempts >= v_max THEN
        UPDATE pdf_extraction_queue
        SET extraction_status = 'failed',
            last_error = p_error_message,
            updated_at = NOW()
        WHERE queue_id = p_queue_id;
    ELSE
        UPDATE pdf_extraction_queue
        SET extraction_status = 'retrying',
            last_error = p_error_message,
            next_retry_at = NOW() + (v_attempts || ' minutes')::INTERVAL,
            updated_at = NOW()
        WHERE queue_id = p_queue_id;
    END IF;
END;
$function$;
CREATE OR REPLACE FUNCTION atlas.guard_signal_event_entity_resolution_immutable_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'atlas', 'extensions'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'signal-event entity resolutions are immutable and cannot be deleted';
  END IF;

  IF (
    to_jsonb(NEW) - ARRAY['last_run_id', 'last_replayed_at', 'is_current']::text[]
  ) IS DISTINCT FROM (
    to_jsonb(OLD) - ARRAY['last_run_id', 'last_replayed_at', 'is_current']::text[]
  ) THEN
    RAISE EXCEPTION 'canonical signal-event entity resolution fields are immutable';
  END IF;

  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION atlas.guard_signal_event_entity_resolution_rule_immutable_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'atlas', 'extensions'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'signal-event entity resolution rules cannot be deleted; retire the prior version';
  END IF;

  IF (to_jsonb(NEW) - 'is_active') IS DISTINCT FROM (to_jsonb(OLD) - 'is_active') THEN
    RAISE EXCEPTION 'signal-event entity resolution rule contracts are immutable; publish a new version';
  END IF;

  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION atlas.infer_entity_identifier_type_v1(p_source_population_table text, p_source_systems jsonb, p_metadata jsonb, p_value text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public', 'atlas', 'extensions'
AS $function$
DECLARE
  v_source_text text;
  v_raw text;
  v_digits text;
  v_compact text;
BEGIN
  IF p_value IS NULL OR btrim(p_value) = '' THEN
    RETURN 'generic';
  END IF;

  v_source_text := atlas.event_entity_source_system_text_v1(
    p_source_population_table,
    p_source_systems,
    p_metadata
  );
  v_raw := normalize(p_value, NFKC);
  v_digits := regexp_replace(v_raw, '[^0-9]', '', 'g');
  v_compact := regexp_replace(upper(v_raw), '[^A-Z0-9]', '', 'g');

  IF (
    position('pro_publica' IN v_source_text) > 0
    OR position('nonprofit' IN v_source_text) > 0
    OR position('irs' IN v_source_text) > 0
  ) AND length(v_digits) = 9 THEN
    RETURN 'ein';
  END IF;

  IF position('sec' IN v_source_text) > 0
     OR position('edgar' IN v_source_text) > 0 THEN
    RETURN 'cik';
  END IF;

  IF position('usaspending' IN v_source_text) > 0
     OR position('sam_gov' IN v_source_text) > 0 THEN
    IF length(v_compact) = 12 THEN
      RETURN 'uei';
    END IF;
    IF length(v_digits) = 9 THEN
      RETURN 'duns';
    END IF;
  END IF;

  RETURN 'generic';
END;
$function$;
CREATE OR REPLACE FUNCTION atlas.live_data_signal_candidate_semantic_key_v1(p_rule_id text, p_signal_type text, p_primary_stream_id text, p_jurisdiction_id text, p_title text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'extensions', 'pg_temp'
AS $function$
  select encode(
    extensions.digest(
      convert_to(
        concat_ws(
          chr(31),
          coalesce(p_rule_id, ''),
          coalesce(p_signal_type, ''),
          case
            when p_rule_id = 'atlas.domain3.cross_category_entity' then ''
            else coalesce(p_primary_stream_id, '')
          end,
          coalesce(p_jurisdiction_id, ''),
          coalesce(p_title, '')
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
$function$;
CREATE OR REPLACE FUNCTION atlas.live_data_signal_candidate_semantic_key_v2(p_rule_id text, p_signal_type text, p_primary_stream_id text, p_jurisdiction_id text, p_title text, p_entity_ids text[])
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'extensions', 'pg_temp'
AS $function$
  select encode(
    extensions.digest(
      convert_to(
        concat_ws(
          chr(31),
          coalesce(p_rule_id, ''),
          coalesce(p_signal_type, ''),
          case
            when p_rule_id = 'atlas.domain3.cross_category_entity' then ''
            else coalesce(p_primary_stream_id, '')
          end,
          coalesce(p_jurisdiction_id, ''),
          coalesce(p_title, ''),
          case
            when p_rule_id = 'atlas.propublica_unresolved_filing_metadata_rate'
              then coalesce((select string_agg(value, chr(30) order by value) from unnest(coalesce(p_entity_ids, array[]::text[])) value), '')
            else ''
          end
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
$function$;
CREATE OR REPLACE FUNCTION atlas.log_provenance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'atlas'
AS $function$
BEGIN
    INSERT INTO atlas.provenance (table_name, record_id, action, actor_id, old_data, new_data, created_at)
    VALUES (
        TG_TABLE_NAME,
        COALESCE(NEW.id, OLD.id),
        TG_OP,
        auth.uid(),
        to_jsonb(OLD),
        to_jsonb(NEW),
        now()
    );
    RETURN COALESCE(NEW, OLD);
END;
$function$;
CREATE OR REPLACE FUNCTION atlas.map_severity_to_enum(p_severity numeric)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'atlas'
AS $function$
BEGIN
    IF p_severity >= 0.90 THEN
        RETURN 'critical';
    ELSIF p_severity >= 0.80 THEN
        RETURN 'high';
    ELSIF p_severity >= 0.60 THEN
        RETURN 'medium';
    ELSE
        RETURN 'low';
    END IF;
END;
$function$;
CREATE OR REPLACE FUNCTION atlas.prevent_civic_genome_legislative_projection_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'atlas'
AS $function$
begin
  raise exception 'Atlas Civic Genome legislative projection receipts are immutable';
end;
$function$;
CREATE OR REPLACE FUNCTION atlas.prevent_civic_genome_snapshot_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'atlas'
AS $function$ begin raise exception 'Atlas Civic Genome external snapshots are immutable'; end; $function$;
CREATE OR REPLACE FUNCTION atlas.prevent_civic_genome_trait_accounting_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'atlas'
AS $function$
begin
  raise exception 'Atlas Civic Genome trait accounting receipts are immutable';
end;
$function$;
CREATE OR REPLACE FUNCTION atlas.prevent_convergence_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'atlas'
AS $function$
begin
  raise exception 'Atlas convergence persistence is immutable';
end;
$function$;
CREATE OR REPLACE FUNCTION atlas.resolve_signal_event_entity_candidate_exact_v1(p_normalized_entity_value text, p_source_identifier_type text, p_normalized_identifier_value text, p_expected_entity_type text)
 RETURNS TABLE(expected_resolution_status text, expected_match_method text, expected_entity_id text, expected_candidate_entity_ids text[])
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'atlas', 'extensions'
AS $function$
DECLARE
  v_identifier_type text := lower(NULLIF(btrim(p_source_identifier_type), ''));
  v_identifier_ids text[] := ARRAY[]::text[];
  v_primary_ids text[] := ARRAY[]::text[];
  v_variant_ids text[] := ARRAY[]::text[];
  v_alias_ids text[] := ARRAY[]::text[];
  v_name_ids text[] := ARRAY[]::text[];
  v_all_ids text[] := ARRAY[]::text[];
  v_status text := 'unresolved';
  v_method text;
  v_entity_id text := NULL;
  v_prospective_entity_id text := NULL;
  v_actual_entity_type text;
BEGIN
  v_method := CASE
    WHEN p_normalized_identifier_value IS NOT NULL OR p_normalized_entity_value IS NOT NULL
      THEN 'no_exact_match'
    ELSE 'no_usable_identity_value'
  END;

  IF p_normalized_identifier_value IS NOT NULL AND v_identifier_type IS NOT NULL THEN
    IF v_identifier_type = 'canonical_entity_id' THEN
      SELECT COALESCE(array_agg(er.entity_id::text ORDER BY er.entity_id::text), ARRAY[]::text[])
      INTO v_identifier_ids
      FROM atlas.entity_registry er
      WHERE er.is_active IS DISTINCT FROM false
        AND er.entity_id::text = p_normalized_identifier_value;
    ELSE
      SELECT COALESCE(
        array_agg(DISTINCT er.entity_id::text ORDER BY er.entity_id::text),
        ARRAY[]::text[]
      )
      INTO v_identifier_ids
      FROM atlas.entity_registry er
      WHERE er.is_active IS DISTINCT FROM false
        AND (
          public.atlas_normalize_entity_identifier_v1(
            v_identifier_type,
            er.metadata->>v_identifier_type
          ) = p_normalized_identifier_value
          OR (
            atlas.infer_entity_identifier_type_v1(
              er.source_population_table,
              er.source_systems,
              er.metadata,
              er.source_external_id
            ) = v_identifier_type
            AND public.atlas_normalize_entity_identifier_v1(
              v_identifier_type,
              er.source_external_id
            ) = p_normalized_identifier_value
          )
          OR (
            atlas.infer_entity_identifier_type_v1(
              er.source_population_table,
              er.source_systems,
              er.metadata,
              er.source_population_id
            ) = v_identifier_type
            AND public.atlas_normalize_entity_identifier_v1(
              v_identifier_type,
              er.source_population_id
            ) = p_normalized_identifier_value
          )
        );
    END IF;
  END IF;

  IF p_normalized_entity_value IS NOT NULL THEN
    SELECT COALESCE(
      array_agg(DISTINCT er.entity_id::text ORDER BY er.entity_id::text),
      ARRAY[]::text[]
    )
    INTO v_primary_ids
    FROM atlas.entity_registry er
    WHERE er.is_active IS DISTINCT FROM false
      AND public.atlas_normalize_entity_name_v1(er.primary_name) = p_normalized_entity_value;

    SELECT COALESCE(
      array_agg(DISTINCT er.entity_id::text ORDER BY er.entity_id::text),
      ARRAY[]::text[]
    )
    INTO v_variant_ids
    FROM atlas.entity_registry er
    WHERE er.is_active IS DISTINCT FROM false
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(er.name_variants) = 'array' THEN er.name_variants
            ELSE '[]'::jsonb
          END
        ) AS variant(value)
        WHERE public.atlas_normalize_entity_name_v1(
          CASE
            WHEN jsonb_typeof(variant.value) = 'string' THEN variant.value #>> '{}'
            WHEN jsonb_typeof(variant.value) = 'object' THEN COALESCE(
              variant.value->>'name',
              variant.value->>'value',
              variant.value->>'alias'
            )
            ELSE NULL
          END
        ) = p_normalized_entity_value
      );

    SELECT COALESCE(
      array_agg(DISTINCT er.entity_id::text ORDER BY er.entity_id::text),
      ARRAY[]::text[]
    )
    INTO v_alias_ids
    FROM atlas.entity_aliases ea
    JOIN atlas.entity_registry er ON er.entity_id = ea.entity_id
    WHERE er.is_active IS DISTINCT FROM false
      AND ea.alias_type IS DISTINCT FROM 'fuzzy_match'
      AND ea.confidence_score = 1.00
      AND public.atlas_normalize_entity_name_v1(ea.alias_text) = p_normalized_entity_value;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT candidate_id ORDER BY candidate_id), ARRAY[]::text[])
  INTO v_name_ids
  FROM (
    SELECT unnest(v_primary_ids) AS candidate_id
    UNION ALL
    SELECT unnest(v_variant_ids) AS candidate_id
    UNION ALL
    SELECT unnest(v_alias_ids) AS candidate_id
  ) names;

  SELECT COALESCE(array_agg(DISTINCT candidate_id ORDER BY candidate_id), ARRAY[]::text[])
  INTO v_all_ids
  FROM (
    SELECT unnest(v_identifier_ids) AS candidate_id
    UNION ALL
    SELECT unnest(v_name_ids) AS candidate_id
  ) candidates;

  IF cardinality(v_identifier_ids) = 1 THEN
    v_prospective_entity_id := v_identifier_ids[1];
    IF EXISTS (
      SELECT 1
      FROM unnest(v_name_ids) AS name_candidate(name_entity_id)
      WHERE name_entity_id <> v_prospective_entity_id
    ) THEN
      v_status := 'ambiguous';
      v_method := 'identifier_name_conflict';
      v_prospective_entity_id := NULL;
    ELSE
      v_method := CASE
        WHEN v_identifier_type = 'canonical_entity_id' THEN 'exact_canonical_entity_id'
        ELSE 'exact_external_identifier'
      END;
    END IF;
  ELSIF cardinality(v_identifier_ids) > 1 THEN
    v_status := 'ambiguous';
    v_method := 'duplicate_external_identifier';
  ELSIF cardinality(v_name_ids) = 1 THEN
    v_prospective_entity_id := v_name_ids[1];
    v_method := CASE
      WHEN v_prospective_entity_id = ANY(v_primary_ids) THEN 'exact_primary_name'
      WHEN v_prospective_entity_id = ANY(v_variant_ids) THEN 'exact_name_variant'
      ELSE 'exact_alias'
    END;
  ELSIF cardinality(v_name_ids) > 1 THEN
    v_status := 'ambiguous';
    v_method := 'duplicate_exact_name';
  END IF;

  IF v_prospective_entity_id IS NOT NULL THEN
    SELECT er.entity_type
    INTO v_actual_entity_type
    FROM atlas.entity_registry er
    WHERE er.entity_id = v_prospective_entity_id
      AND er.is_active IS DISTINCT FROM false;

    IF atlas.entity_type_compatible_v1(p_expected_entity_type, v_actual_entity_type) THEN
      v_status := 'resolved';
      v_entity_id := v_prospective_entity_id;
    ELSE
      v_status := 'unresolved';
      v_method := 'exact_match_entity_type_mismatch';
      v_entity_id := NULL;
    END IF;
  END IF;

  RETURN QUERY SELECT v_status, v_method, v_entity_id, v_all_ids;
END;
$function$;
CREATE OR REPLACE FUNCTION atlas.signal_event_identity_hash_v1(p_stream_id text, p_timestamp timestamp with time zone, p_signal_type text, p_spacetime jsonb, p_provenance jsonb, p_payload jsonb, p_source_id text, p_jurisdiction_id text, p_module_hint text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog', 'extensions'
AS $function$
  select encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'stream_id', p_stream_id,
          'timestamp', to_char(p_timestamp at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'signal_type', p_signal_type,
          'spacetime', coalesce(p_spacetime, '{}'::jsonb),
          'provenance', coalesce(p_provenance, '{}'::jsonb) - 'received_at' - 'ingested_at',
          'payload', coalesce(p_payload, '{}'::jsonb) - 'provenance_tracking',
          'source_id', p_source_id,
          'jurisdiction_id', p_jurisdiction_id,
          'module_hint', p_module_hint
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$function$;
CREATE OR REPLACE FUNCTION atlas.signal_event_source_record_key_v1(p_payload jsonb, p_provenance jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'extensions'
AS $function$
  select encode(
    extensions.digest(
      convert_to(
        concat_ws(
          '|',
          coalesce(p_payload->>'external_id', ''),
          coalesce(p_payload->>'opportunity_number', ''),
          coalesce(p_payload->>'pdf_url', ''),
          coalesce(p_payload->>'source_url', ''),
          coalesce(p_provenance->>'source_url', ''),
          coalesce(p_payload#>>'{raw,id}', ''),
          coalesce(p_payload#>>'{raw,ein}', ''),
          coalesce(p_payload#>>'{raw,updated}', '')
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$function$;
CREATE OR REPLACE FUNCTION atlas.trigger_set_timestamp()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'atlas'
AS $function$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.atlas_bridge_config_for(p_bridge_id text)
 RETURNS TABLE(target_url text, target_service_key text, enabled boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'atlas', 'public'
AS $function$
  select bridge_config.target_url, bridge_config.target_service_key, bridge_config.enabled
  from atlas.bridge_config
  where bridge_config.bridge_id = p_bridge_id
  limit 1;
$function$;
CREATE OR REPLACE FUNCTION public.atlas_bridge_latest_log_for(p_bridge_id text, p_sync_type text, p_source_record_id text)
 RETURNS TABLE(bridge_id text, sync_type text, source_table text, source_record_id text, target_table text, target_record_id text, status text, request_payload jsonb, response_payload jsonb, error_message text, synced_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'atlas', 'public'
AS $function$
  select
    bridge_sync_log.bridge_id,
    bridge_sync_log.sync_type,
    bridge_sync_log.source_table,
    bridge_sync_log.source_record_id,
    bridge_sync_log.target_table,
    bridge_sync_log.target_record_id,
    bridge_sync_log.status,
    bridge_sync_log.request_payload,
    bridge_sync_log.response_payload,
    bridge_sync_log.error_message,
    bridge_sync_log.synced_at
  from atlas.bridge_sync_log
  where bridge_sync_log.bridge_id = p_bridge_id
    and bridge_sync_log.sync_type = p_sync_type
    and bridge_sync_log.source_record_id = p_source_record_id
  order by bridge_sync_log.synced_at desc
  limit 1;
$function$;
CREATE OR REPLACE FUNCTION public.atlas_bridge_was_sent(p_bridge_id text, p_sync_type text, p_source_table text, p_source_record_id text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'atlas', 'public'
AS $function$
  select exists (
    select 1
    from atlas.bridge_sync_log
    where bridge_id = p_bridge_id
      and sync_type = p_sync_type
      and source_table = p_source_table
      and source_record_id = p_source_record_id
      and status = 'sent'
    limit 1
  );
$function$;
CREATE OR REPLACE FUNCTION public.atlas_civic_genome_legislative_projection_persist_v1(p_bundle jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'atlas'
AS $function$
declare
  v_projection_key text := p_bundle->>'projection_key';
  v_snapshot_id text := p_bundle->>'source_snapshot_id';
  v_snapshot_hash text := p_bundle->>'source_snapshot_hash';
  v_observation_count integer := (p_bundle->>'observation_count')::integer;
  v_existing atlas.civic_genome_legislative_projection_run%rowtype;
  v_source atlas.civic_genome_external_snapshot%rowtype;
  v_observation jsonb;
  v_ingest jsonb;
  v_receipt jsonb;
begin
  if p_bundle->>'bundle_version' <> 'atlas_civic_genome_legislative_projection.v1' then
    raise exception 'atlas_civic_genome_projection_bundle_version_invalid';
  end if;
  if v_projection_key !~ '^[0-9a-f]{64}$'
     or p_bundle->>'mapping_rule_hash' !~ '^[0-9a-f]{64}$'
     or p_bundle->>'version_manifest_hash' !~ '^[0-9a-f]{64}$'
     or p_bundle->>'observation_hash' !~ '^[0-9a-f]{64}$' then
    raise exception 'atlas_civic_genome_projection_hash_invalid';
  end if;
  if jsonb_typeof(p_bundle->'observations') <> 'array'
     or jsonb_array_length(p_bundle->'observations') <> v_observation_count then
    raise exception 'atlas_civic_genome_projection_observation_count_mismatch';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_projection_key, 0));
  select * into v_existing
  from atlas.civic_genome_legislative_projection_run
  where projection_key = v_projection_key;
  if found then
    if v_existing.source_snapshot_hash is distinct from v_snapshot_hash
       or v_existing.observation_hash is distinct from p_bundle->>'observation_hash'
       or v_existing.version_manifest_hash is distinct from p_bundle->>'version_manifest_hash'
       or v_existing.observation_count is distinct from v_observation_count then
      raise exception 'atlas_civic_genome_projection_identity_collision';
    end if;
    return jsonb_build_object(
      'status','idempotent',
      'projection_key',v_existing.projection_key,
      'source_snapshot_id',v_existing.source_snapshot_id,
      'observation_count',v_existing.observation_count,
      'events_inserted',v_existing.events_inserted,
      'replays_suppressed',v_existing.replays_suppressed,
      'persisted_at',v_existing.persisted_at
    );
  end if;

  select * into v_source
  from atlas.civic_genome_external_snapshot
  where source_snapshot_id = v_snapshot_id;
  if not found or v_source.source_snapshot_hash is distinct from v_snapshot_hash then
    raise exception 'atlas_civic_genome_projection_source_snapshot_mismatch';
  end if;
  if v_source.methodology_version <> 'civic_genome_external_family_snapshot.1.1.0' then
    raise exception 'atlas_civic_genome_projection_source_methodology_invalid';
  end if;

  for v_observation in select value from jsonb_array_elements(p_bundle->'observations')
  loop
    if v_observation->>'stream_id' <> 'civic_genome_legislative_versions'
       or v_observation->>'source_id' <> 'lighthouse_civic_genome_snapshot'
       or v_observation->>'module_hint' <> 'legislative_history'
       or v_observation->'payload'->>'source_snapshot_id' <> v_snapshot_id
       or v_observation->'payload'->>'source_snapshot_hash' <> v_snapshot_hash
       or v_observation->'payload'->>'mapping_rule_hash' <> p_bundle->>'mapping_rule_hash' then
      raise exception 'atlas_civic_genome_projection_observation_boundary_invalid';
    end if;
  end loop;

  select public.persist_signal_event_batch_v2(p_bundle->'observations') into v_ingest;
  if v_ingest->>'status' <> 'completed'
     or coalesce((v_ingest->>'records_failed')::integer, 0) <> 0 then
    raise exception 'atlas_civic_genome_projection_signal_ingest_failed: %', v_ingest::text;
  end if;

  v_receipt := jsonb_build_object(
    'projection_key',v_projection_key,
    'mapping_rule_id',p_bundle->'mapping_rule'->>'rule_id',
    'mapping_rule_version',p_bundle->'mapping_rule'->>'rule_version',
    'mapping_rule_hash',p_bundle->>'mapping_rule_hash',
    'source_snapshot_id',v_snapshot_id,
    'source_snapshot_hash',v_snapshot_hash,
    'version_manifest_hash',p_bundle->>'version_manifest_hash',
    'source_version_count',(p_bundle->>'source_version_count')::integer,
    'observation_count',v_observation_count,
    'observation_hash',p_bundle->>'observation_hash',
    'ingest',v_ingest,
    'no_upstream_mutation',true,
    'no_consequence_interpretation',true
  );

  insert into atlas.civic_genome_legislative_projection_run (
    projection_key,mapping_rule_id,mapping_rule_version,mapping_rule_hash,
    source_snapshot_id,source_snapshot_hash,version_manifest_hash,
    source_version_count,observation_count,observation_hash,ingest_run_id,
    events_inserted,replays_suppressed,status,receipt_json
  ) values (
    v_projection_key,
    p_bundle->'mapping_rule'->>'rule_id',
    p_bundle->'mapping_rule'->>'rule_version',
    p_bundle->>'mapping_rule_hash',
    v_snapshot_id,v_snapshot_hash,p_bundle->>'version_manifest_hash',
    (p_bundle->>'source_version_count')::integer,
    v_observation_count,p_bundle->>'observation_hash',(v_ingest->>'run_id')::uuid,
    (v_ingest->>'events_inserted')::integer,
    (v_ingest->>'replays_suppressed')::integer,
    'completed',v_receipt
  );

  return jsonb_build_object(
    'status','inserted',
    'projection_key',v_projection_key,
    'source_snapshot_id',v_snapshot_id,
    'source_version_count',(p_bundle->>'source_version_count')::integer,
    'observation_count',v_observation_count,
    'events_inserted',(v_ingest->>'events_inserted')::integer,
    'replays_suppressed',(v_ingest->>'replays_suppressed')::integer,
    'ingest_run_id',v_ingest->>'run_id'
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.atlas_civic_genome_legislative_trait_accounting_persist_v1(p_receipt jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'atlas'
AS $function$
declare
  v_existing atlas.civic_genome_legislative_trait_binding_accounting%rowtype;
  v_projection atlas.civic_genome_legislative_projection_run%rowtype;
  v_source atlas.civic_genome_external_snapshot%rowtype;
  v_projection_key text := p_receipt->>'projection_key';
  v_snapshot_id text := p_receipt->>'source_snapshot_id';
  v_accounting_hash text := p_receipt->>'accounting_hash';
begin
  if v_accounting_hash !~ '^[0-9a-f]{64}$'
     or p_receipt->>'accounting_rule_hash' !~ '^[0-9a-f]{64}$'
     or p_receipt->>'source_snapshot_hash' !~ '^[0-9a-f]{64}$' then
    raise exception 'atlas_civic_genome_trait_accounting_hash_invalid';
  end if;
  if (p_receipt->>'total_trait_count')::integer
     <> (p_receipt->>'exact_version_bound_trait_count')::integer
      + (p_receipt->>'historical_same_source_trait_count')::integer
      + (p_receipt->>'unresolved_trait_count')::integer then
    raise exception 'atlas_civic_genome_trait_accounting_count_mismatch';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_projection_key || ':' || (p_receipt->>'accounting_rule_hash'), 0)
  );
  select * into v_existing
  from atlas.civic_genome_legislative_trait_binding_accounting
  where projection_key=v_projection_key
    and accounting_rule_hash=p_receipt->>'accounting_rule_hash';
  if found then
    if v_existing.accounting_hash is distinct from v_accounting_hash
       or v_existing.receipt_json is distinct from p_receipt then
      raise exception 'atlas_civic_genome_trait_accounting_identity_collision';
    end if;
    return jsonb_build_object(
      'status','idempotent',
      'accounting_hash',v_existing.accounting_hash,
      'projection_key',v_existing.projection_key,
      'total_trait_count',v_existing.total_trait_count,
      'exact_version_bound_trait_count',v_existing.exact_version_bound_trait_count,
      'historical_same_source_trait_count',v_existing.historical_same_source_trait_count,
      'unresolved_trait_count',v_existing.unresolved_trait_count,
      'completeness_state',v_existing.completeness_state,
      'persisted_at',v_existing.persisted_at
    );
  end if;

  select * into v_projection
  from atlas.civic_genome_legislative_projection_run
  where projection_key=v_projection_key;
  if not found or v_projection.source_snapshot_id is distinct from v_snapshot_id then
    raise exception 'atlas_civic_genome_trait_accounting_projection_mismatch';
  end if;
  select * into v_source
  from atlas.civic_genome_external_snapshot
  where source_snapshot_id=v_snapshot_id;
  if not found or v_source.source_snapshot_hash is distinct from p_receipt->>'source_snapshot_hash' then
    raise exception 'atlas_civic_genome_trait_accounting_source_mismatch';
  end if;

  insert into atlas.civic_genome_legislative_trait_binding_accounting (
    accounting_hash,accounting_rule_id,accounting_rule_version,accounting_rule_hash,
    projection_key,source_snapshot_id,source_snapshot_hash,total_trait_count,
    exact_version_bound_trait_count,historical_same_source_trait_count,
    unresolved_trait_count,completeness_state,receipt_json
  ) values (
    v_accounting_hash,
    p_receipt->'accounting_rule'->>'rule_id',
    p_receipt->'accounting_rule'->>'rule_version',
    p_receipt->>'accounting_rule_hash',
    v_projection_key,v_snapshot_id,p_receipt->>'source_snapshot_hash',
    (p_receipt->>'total_trait_count')::integer,
    (p_receipt->>'exact_version_bound_trait_count')::integer,
    (p_receipt->>'historical_same_source_trait_count')::integer,
    (p_receipt->>'unresolved_trait_count')::integer,
    p_receipt->>'completeness_state',p_receipt
  );

  return jsonb_build_object(
    'status','inserted',
    'accounting_hash',v_accounting_hash,
    'projection_key',v_projection_key,
    'total_trait_count',(p_receipt->>'total_trait_count')::integer,
    'exact_version_bound_trait_count',(p_receipt->>'exact_version_bound_trait_count')::integer,
    'historical_same_source_trait_count',(p_receipt->>'historical_same_source_trait_count')::integer,
    'unresolved_trait_count',(p_receipt->>'unresolved_trait_count')::integer,
    'completeness_state',p_receipt->>'completeness_state'
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.atlas_civic_genome_snapshot_get_v1(p_snapshot_id text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'atlas'
AS $function$
  select snapshot_json
  from atlas.civic_genome_external_snapshot
  where source_snapshot_id = p_snapshot_id
$function$;
CREATE OR REPLACE FUNCTION public.atlas_civic_genome_snapshot_persist_v1(p_record jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'atlas'
AS $function$
declare
  v_snapshot jsonb := p_record->'snapshot';
  v_existing atlas.civic_genome_external_snapshot%rowtype;
  v_snapshot_id text := v_snapshot->>'snapshot_id';
  v_snapshot_hash text := v_snapshot->>'snapshot_hash';
  v_component_count integer := (v_snapshot->>'component_count')::integer;
begin
  if p_record->>'source_schema_id' <> 'https://luminari.org/civic-genome/contracts/external-snapshot.v1.schema.json' then
    raise exception 'atlas_civic_genome_source_schema_mismatch';
  end if;
  if v_snapshot->>'contract_id' <> 'civic_genome.external_snapshot.v1'
     or v_snapshot->>'contract_version' <> '1.0.0'
     or v_snapshot->>'canonical_owner' <> 'lighthouse/civic_genome'
     or v_snapshot->>'snapshot_kind' <> 'baseline_export'
     or coalesce((v_snapshot->>'immutable')::boolean, false) is distinct from true then
    raise exception 'atlas_civic_genome_source_contract_mismatch';
  end if;
  if v_snapshot_id is null or v_snapshot_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'atlas_civic_genome_snapshot_identity_invalid';
  end if;
  if jsonb_typeof(v_snapshot->'components') <> 'array'
     or jsonb_array_length(v_snapshot->'components') <> v_component_count then
    raise exception 'atlas_civic_genome_component_count_mismatch';
  end if;
  if p_record->>'atlas_binding_hash' !~ '^[0-9a-f]{64}$'
     or p_record->>'delivery_receipt_hash' !~ '^[0-9a-f]{64}$' then
    raise exception 'atlas_civic_genome_delivery_identity_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_snapshot_id, 0));
  select * into v_existing from atlas.civic_genome_external_snapshot
   where source_snapshot_id = v_snapshot_id;

  if found then
    if v_existing.source_snapshot_hash is distinct from v_snapshot_hash then
      raise exception 'atlas_civic_genome_snapshot_identity_collision';
    end if;
    return jsonb_build_object(
      'status','idempotent',
      'source_snapshot_id',v_existing.source_snapshot_id,
      'source_snapshot_hash',v_existing.source_snapshot_hash,
      'atlas_binding_hash',v_existing.atlas_binding_hash,
      'received_at',v_existing.received_at
    );
  end if;

  insert into atlas.civic_genome_external_snapshot (
    source_snapshot_id, source_snapshot_hash, source_schema_id,
    source_contract_id, source_contract_version, source_owner, snapshot_kind,
    source_as_of, methodology_version, scope_json, component_count,
    completeness_state, unresolved_conditions, excluded_component_types,
    source_export_receipt_id, source_export_receipt_hash, deterministic_replay_key,
    source_commit_sha, snapshot_json, atlas_binding_hash, delivery_key_id,
    delivery_receipt_hash
  ) values (
    v_snapshot_id,
    v_snapshot_hash,
    p_record->>'source_schema_id',
    v_snapshot->>'contract_id',
    v_snapshot->>'contract_version',
    v_snapshot->>'canonical_owner',
    v_snapshot->>'snapshot_kind',
    (v_snapshot->>'as_of')::timestamptz,
    v_snapshot->>'methodology_version',
    v_snapshot->'scope',
    v_component_count,
    v_snapshot->>'completeness_state',
    coalesce(v_snapshot->'unresolved_conditions','[]'::jsonb),
    coalesce(v_snapshot->'excluded_component_types','[]'::jsonb),
    v_snapshot->'export_receipt'->>'export_receipt_id',
    v_snapshot->'export_receipt'->>'export_receipt_hash',
    v_snapshot->'export_receipt'->>'deterministic_replay_key',
    nullif(v_snapshot->'export_receipt'->>'source_commit_sha',''),
    v_snapshot,
    p_record->>'atlas_binding_hash',
    p_record->>'delivery_key_id',
    p_record->>'delivery_receipt_hash'
  );

  return jsonb_build_object(
    'status','inserted',
    'source_snapshot_id',v_snapshot_id,
    'source_snapshot_hash',v_snapshot_hash,
    'atlas_binding_hash',p_record->>'atlas_binding_hash'
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.atlas_convergence_get_replay_bundle_v1(p_run_key text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'atlas'
AS $function$
  select jsonb_build_object(
    'manifest', to_jsonb(manifest) - 'persisted_at',
    'registry', jsonb_build_object(
      'registry_hash', registry.registry_hash,
      'registry_version', registry.registry_version,
      'jurisdiction', registry.jurisdiction,
      'analysis_level', registry.analysis_level,
      'source_id', registry.source_id,
      'source_version', registry.source_version,
      'source_url', registry.source_url,
      'entries_json', registry.entries_json,
      'provenance_records', registry.provenance_records
    ),
    'snapshots', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'run_key', snapshot.run_key,
          'snapshot_type', snapshot.snapshot_type,
          'population_hash', snapshot.population_hash,
          'record_count', snapshot.record_count,
          'records', snapshot.records_json
        )
        order by snapshot.snapshot_type
      )
      from atlas.convergence_signal_snapshot snapshot
      where snapshot.run_key = manifest.run_key
    ), '[]'::jsonb),
    'receipts', coalesce((
      select jsonb_agg(to_jsonb(receipt) - 'persisted_at' order by receipt.geography_id)
      from atlas.convergence_receipt receipt
      where receipt.run_key = manifest.run_key
    ), '[]'::jsonb),
    'result', to_jsonb(result) - 'persisted_at'
  )
  from atlas.convergence_run_manifest manifest
  join atlas.geography_registry_snapshot registry
    on registry.registry_hash = manifest.analysis_registry_hash
  join atlas.convergence_result_payload result using (run_key)
  where manifest.run_key = p_run_key
$function$;
CREATE OR REPLACE FUNCTION public.atlas_convergence_get_run_v1(p_run_key text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'atlas'
AS $function$
  select jsonb_build_object(
    'manifest', to_jsonb(manifest) - 'persisted_at',
    'result', to_jsonb(result) - 'persisted_at',
    'receipts', coalesce((
      select jsonb_agg(to_jsonb(receipt) - 'persisted_at' order by receipt.geography_id)
      from atlas.convergence_receipt receipt
      where receipt.run_key = manifest.run_key
    ), '[]'::jsonb)
  )
  from atlas.convergence_run_manifest manifest
  join atlas.convergence_result_payload result using (run_key)
  where manifest.run_key = p_run_key
$function$;
CREATE OR REPLACE FUNCTION public.atlas_convergence_persist_run_v1(p_bundle jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'atlas'
 SET statement_timeout TO '120s'
AS $function$
declare
  v_registry jsonb := p_bundle->'registry';
  v_manifest jsonb := p_bundle->'manifest';
  v_result jsonb := p_bundle->'result';
  v_snapshot jsonb;
  v_receipt jsonb;
  v_run_key text := v_manifest->>'run_key';
  v_existing_manifest atlas.convergence_run_manifest%rowtype;
  v_existing_registry atlas.geography_registry_snapshot%rowtype;
  v_existing_result atlas.convergence_result_payload%rowtype;
  v_expected_receipts integer := jsonb_array_length(coalesce(p_bundle->'receipts', '[]'::jsonb));
  v_expected_snapshots integer := jsonb_array_length(coalesce(p_bundle->'snapshots', '[]'::jsonb));
begin
  if p_bundle->>'bundle_version' <> 'atlas_convergence_persistence.v2.1.0' then
    raise exception 'unsupported convergence persistence bundle version';
  end if;
  if v_run_key is null or v_run_key !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid convergence run_key';
  end if;
  if v_expected_receipts < 1 or v_expected_receipts <> (v_manifest->>'receipt_count')::integer then
    raise exception 'receipt count does not match manifest';
  end if;
  if v_expected_snapshots <> 3 then
    raise exception 'exactly three source/transformed/deduplicated snapshots are required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_run_key, 0));

  select * into v_existing_manifest
  from atlas.convergence_run_manifest
  where run_key = v_run_key;

  if found then
    select * into v_existing_result
    from atlas.convergence_result_payload
    where run_key = v_run_key;

    if v_existing_manifest.output_hash is distinct from v_result->>'output_hash'
       or v_existing_manifest.configuration_json is distinct from v_manifest->'configuration_json'
       or v_existing_manifest.source_population_hash is distinct from v_manifest->>'source_population_hash'
       or v_existing_manifest.receipt_count is distinct from v_expected_receipts
       or v_existing_result.output_hash is distinct from v_result->>'output_hash'
       or v_existing_result.payload_json is distinct from v_result->'payload_json'
       or v_existing_result.receipt_count is distinct from v_expected_receipts then
      raise exception 'run_key % already exists with different governed content', v_run_key;
    end if;

    return jsonb_build_object(
      'status', 'idempotent',
      'run_key', v_run_key,
      'output_hash', v_existing_result.output_hash,
      'receipt_count', v_existing_result.receipt_count
    );
  end if;

  insert into atlas.geography_registry_snapshot (
    registry_hash, registry_version, jurisdiction, analysis_level,
    source_id, source_version, source_url, record_count,
    entries_json, provenance_records
  ) values (
    v_registry->>'registry_hash',
    v_registry->>'registry_version',
    v_registry->>'jurisdiction',
    v_registry->>'analysis_level',
    v_registry->>'source_id',
    v_registry->>'source_version',
    v_registry->>'source_url',
    jsonb_array_length(v_registry->'entries_json'->'entries'),
    v_registry->'entries_json',
    v_registry->'provenance_records'
  ) on conflict (registry_hash) do nothing;

  select * into v_existing_registry
  from atlas.geography_registry_snapshot
  where registry_hash = v_registry->>'registry_hash';

  if not found
     or v_existing_registry.registry_version is distinct from v_registry->>'registry_version'
     or v_existing_registry.analysis_level is distinct from v_registry->>'analysis_level'
     or v_existing_registry.entries_json is distinct from v_registry->'entries_json'
     or v_existing_registry.provenance_records is distinct from v_registry->'provenance_records' then
    raise exception 'geography registry hash conflict';
  end if;

  insert into atlas.convergence_run_manifest (
    run_key, engine_version, as_of, time_window_ms, temporal_bucket_ms,
    geography_registry_version, analysis_registry_hash, analysis_level,
    rule_manifest_hash, configuration_hash, configuration_json,
    source_population_hash, transformed_population_hash,
    deduplicated_population_hash, total_source_rows, total_signals_raw,
    total_signals_deduplicated, total_geographies, receipt_count, output_hash
  ) values (
    v_run_key,
    v_manifest->>'engine_version',
    (v_manifest->>'as_of')::bigint,
    (v_manifest->>'time_window_ms')::bigint,
    (v_manifest->>'temporal_bucket_ms')::bigint,
    v_manifest->>'geography_registry_version',
    v_manifest->>'analysis_registry_hash',
    v_manifest->>'analysis_level',
    v_manifest->>'rule_manifest_hash',
    v_manifest->>'configuration_hash',
    v_manifest->'configuration_json',
    v_manifest->>'source_population_hash',
    v_manifest->>'transformed_population_hash',
    v_manifest->>'deduplicated_population_hash',
    (v_manifest->>'total_source_rows')::integer,
    (v_manifest->>'total_signals_raw')::integer,
    (v_manifest->>'total_signals_deduplicated')::integer,
    (v_manifest->>'total_geographies')::integer,
    (v_manifest->>'receipt_count')::integer,
    v_manifest->>'output_hash'
  );

  for v_snapshot in select value from jsonb_array_elements(p_bundle->'snapshots')
  loop
    insert into atlas.convergence_signal_snapshot (
      run_key, snapshot_type, population_hash, record_count, records_json
    ) values (
      v_run_key,
      v_snapshot->>'snapshot_type',
      v_snapshot->>'population_hash',
      jsonb_array_length(v_snapshot->'records'),
      v_snapshot->'records'
    );
  end loop;

  for v_receipt in select value from jsonb_array_elements(p_bundle->'receipts')
  loop
    if v_receipt->>'run_key' is distinct from v_run_key then
      raise exception 'receipt run_key mismatch';
    end if;
    insert into atlas.convergence_receipt (
      run_key, geography_id, receipt_identity, equation_id, engine_version,
      rule_manifest_hash, as_of, configuration_hash, source_population_hash,
      input_hash, output_hash, source_signal_ids, geography_registry_version,
      expected_count, observed_count, z_score, convergence_detected, status,
      reason_unresolved, computed_outputs, timestamp_computed
    ) values (
      v_run_key,
      v_receipt->>'geography_id',
      v_receipt->>'receipt_identity',
      v_receipt->>'equation_id',
      v_receipt->>'engine_version',
      v_receipt->>'rule_manifest_hash',
      (v_receipt->>'as_of')::bigint,
      v_receipt->>'configuration_hash',
      v_receipt->>'source_population_hash',
      v_receipt->>'input_hash',
      v_receipt->>'output_hash',
      v_receipt->'source_signal_ids',
      v_receipt->>'geography_registry_version',
      nullif(v_receipt->>'expected_count', '')::numeric,
      (v_receipt->>'observed_count')::integer,
      nullif(v_receipt->>'z_score', '')::numeric,
      (v_receipt->>'convergence_detected')::boolean,
      v_receipt->>'status',
      v_receipt->>'reason_unresolved',
      v_receipt->'computed_outputs',
      (v_receipt->>'timestamp_computed')::bigint
    );
  end loop;

  insert into atlas.convergence_result_payload (
    run_key, output_hash, payload_json, receipt_count
  ) values (
    v_run_key,
    v_result->>'output_hash',
    v_result->'payload_json',
    (v_result->>'receipt_count')::integer
  );

  return jsonb_build_object(
    'status', 'created',
    'run_key', v_run_key,
    'output_hash', v_result->>'output_hash',
    'receipt_count', v_expected_receipts
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.atlas_convergence_source_population_page_v1(p_from_timestamp timestamp with time zone, p_to_timestamp timestamp with time zone, p_after_stream_id text DEFAULT NULL::text, p_after_offset bigint DEFAULT NULL::bigint, p_limit integer DEFAULT 1000)
 RETURNS TABLE(row_json jsonb)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'atlas'
AS $function$
  select jsonb_build_object(
    'stream_id', event.stream_id,
    'offset', event.offset::text,
    'timestamp', event.timestamp,
    'signal_type', event.signal_type,
    'spacetime', event.spacetime,
    'provenance', event.provenance,
    'payload', event.payload,
    'source_id', event.source_id,
    'jurisdiction_id', event.jurisdiction_id,
    'module_hint', event.module_hint,
    'ingested_at', event.ingested_at,
    'event_identity_hash', identity.event_identity_hash,
    'canonical_identity', jsonb_build_object(
      'canonical_offset', identity.canonical_offset::text,
      'source_record_key', identity.source_record_key,
      'first_seen_at', identity.first_seen_at,
      'source_timestamp', identity.source_timestamp
    )
  ) as row_json
  from public.signal_events event
  join atlas.signal_event_identity identity
    on identity.stream_id = event.stream_id
   and identity.canonical_offset = event.offset
   and identity.event_identity_hash = event.event_identity_hash
  where event.timestamp >= p_from_timestamp
    and event.timestamp <= p_to_timestamp
    and (
      p_after_stream_id is null
      or event.stream_id > p_after_stream_id
      or (event.stream_id = p_after_stream_id and event.offset > p_after_offset)
    )
  order by event.stream_id, event.offset
  limit least(greatest(coalesce(p_limit, 1000), 1), 1000)
$function$;
CREATE OR REPLACE FUNCTION public.atlas_event_entity_candidate_key_v1(p_rule_id text, p_rule_version text, p_entity_role text, p_source_field text, p_normalized_entity_value text, p_source_identifier_field text, p_source_identifier_type text, p_normalized_identifier_value text, p_expected_entity_type text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
  SELECT encode(
    extensions.digest(
      concat_ws(
        chr(31),
        COALESCE(p_rule_id, ''),
        COALESCE(p_rule_version, ''),
        COALESCE(p_entity_role, ''),
        COALESCE(p_source_field, ''),
        COALESCE(p_normalized_entity_value, ''),
        COALESCE(p_source_identifier_field, ''),
        COALESCE(p_source_identifier_type, ''),
        COALESCE(p_normalized_identifier_value, ''),
        COALESCE(p_expected_entity_type, '')
      ),
      'sha256'
    ),
    'hex'
  );
$function$;
CREATE OR REPLACE FUNCTION public.atlas_event_entity_resolution_hash_v1(p_event_input_hash text, p_entity_index_hash text, p_rule_manifest_hash text, p_rule_id text, p_rule_version text, p_candidate_key text, p_entity_role text, p_source_field text, p_normalized_entity_value text, p_source_identifier_field text, p_source_identifier_type text, p_normalized_identifier_value text, p_expected_entity_type text, p_resolution_status text, p_entity_id text, p_match_method text, p_candidate_entity_ids text[], p_resolver_id text, p_resolver_version text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
  SELECT encode(
    extensions.digest(
      concat_ws(
        chr(31),
        COALESCE(p_event_input_hash, ''),
        COALESCE(p_entity_index_hash, ''),
        COALESCE(p_rule_manifest_hash, ''),
        COALESCE(p_rule_id, ''),
        COALESCE(p_rule_version, ''),
        COALESCE(p_candidate_key, ''),
        COALESCE(p_entity_role, ''),
        COALESCE(p_source_field, ''),
        COALESCE(p_normalized_entity_value, ''),
        COALESCE(p_source_identifier_field, ''),
        COALESCE(p_source_identifier_type, ''),
        COALESCE(p_normalized_identifier_value, ''),
        COALESCE(p_expected_entity_type, ''),
        COALESCE(p_resolution_status, ''),
        COALESCE(p_entity_id, ''),
        COALESCE(p_match_method, ''),
        COALESCE((
          SELECT string_agg(candidate_id, chr(30) ORDER BY candidate_id)
          FROM unnest(COALESCE(p_candidate_entity_ids, ARRAY[]::text[])) AS candidate(candidate_id)
        ), ''),
        COALESCE(p_resolver_id, ''),
        COALESCE(p_resolver_version, '')
      ),
      'sha256'
    ),
    'hex'
  );
$function$;
CREATE OR REPLACE FUNCTION public.atlas_event_entity_source_value_v1(p_rule_id text, p_source_field text, p_source_field_value text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_value text;
  v_match text[];
BEGIN
  IF p_source_field = '__none__' OR p_source_field_value IS NULL THEN
    RETURN NULL;
  END IF;

  v_value := NULLIF(btrim(p_source_field_value), '');
  IF v_value IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_rule_id = 'usa_spending.award_recipient'
     AND p_source_field = 'payload.title' THEN
    v_match := regexp_match(
      v_value,
      '^(Contract|Award|Grant)[[:space:]]*:[[:space:]]*(.+)[[:space:]]+[—–-][[:space:]]+\$.*$',
      'i'
    );

    IF v_match IS NULL THEN
      v_match := regexp_match(
        v_value,
        '^(Contract|Award|Grant)[[:space:]]*:[[:space:]]*(.+)[[:space:]]+[—–-][[:space:]]+.*$',
        'i'
      );
    END IF;

    IF v_match IS NULL THEN
      v_match := regexp_match(
        v_value,
        '^(Contract|Award|Grant)[[:space:]]*:[[:space:]]*(.+)$',
        'i'
      );
    END IF;

    IF v_match IS NOT NULL THEN
      RETURN NULLIF(btrim(v_match[2]), '');
    END IF;
  END IF;

  RETURN v_value;
END;
$function$;
CREATE OR REPLACE FUNCTION public.atlas_event_payload_field_text_v1(p_payload jsonb, p_source_field text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_path text;
  v_parts text[];
BEGIN
  IF p_source_field = '__none__' THEN
    RETURN NULL;
  END IF;
  IF p_source_field !~ '^payload(\.|\[)' THEN
    RAISE EXCEPTION 'unsupported event payload source field: %', p_source_field;
  END IF;

  v_path := regexp_replace(p_source_field, '^payload\.?', '');
  v_path := regexp_replace(v_path, '\[([0-9]+)\]', '.\1', 'g');
  v_parts := string_to_array(v_path, '.');
  RETURN p_payload #>> v_parts;
END;
$function$;
CREATE OR REPLACE FUNCTION public.atlas_insert_bridge_sync_log(p_bridge_id text, p_sync_type text, p_source_table text, p_source_record_id text, p_target_table text, p_target_record_id text, p_status text, p_request_payload jsonb, p_response_payload jsonb, p_error_message text, p_duration_ms integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'atlas', 'public'
AS $function$
begin
  insert into atlas.bridge_sync_log (
    bridge_id,
    sync_type,
    source_table,
    source_record_id,
    target_table,
    target_record_id,
    status,
    request_payload,
    response_payload,
    error_message,
    duration_ms
  ) values (
    p_bridge_id,
    p_sync_type,
    p_source_table,
    p_source_record_id,
    p_target_table,
    p_target_record_id,
    p_status,
    coalesce(p_request_payload, '{}'::jsonb),
    p_response_payload,
    p_error_message,
    p_duration_ms
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.atlas_normalize_entity_identifier_v1(p_identifier_type text, p_value text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_type text := lower(COALESCE(p_identifier_type, 'generic'));
  v_raw text;
  v_digits text;
  v_compact text;
BEGIN
  IF p_value IS NULL THEN
    RETURN NULL;
  END IF;

  v_raw := btrim(normalize(p_value, NFKC));
  IF v_raw = '' THEN
    RETURN NULL;
  END IF;

  IF v_type = 'canonical_entity_id' THEN
    RETURN v_raw;
  END IF;

  IF v_type IN ('ein', 'duns', 'cik') THEN
    v_digits := regexp_replace(v_raw, '[^0-9]', '', 'g');
    IF v_type IN ('ein', 'duns') THEN
      RETURN CASE WHEN length(v_digits) = 9 THEN v_digits ELSE NULL END;
    END IF;
    RETURN CASE
      WHEN length(v_digits) BETWEEN 1 AND 10 THEN lpad(v_digits, 10, '0')
      ELSE NULL
    END;
  END IF;

  v_compact := regexp_replace(upper(v_raw), '[^A-Z0-9]', '', 'g');
  IF v_type = 'uei' THEN
    RETURN CASE WHEN length(v_compact) = 12 THEN v_compact ELSE NULL END;
  END IF;

  RETURN NULLIF(v_compact, '');
END;
$function$;
CREATE OR REPLACE FUNCTION public.atlas_normalize_entity_name_v1(p_value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
  SELECT NULLIF(
    regexp_replace(
      upper(btrim(p_value)),
      '[^A-Z0-9]',
      '',
      'g'
    ),
    ''
  );
$function$;
CREATE OR REPLACE FUNCTION public.atlas_set_source_fallback_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.atlas_signal_event_input_hash_v1(p_stream_id text, p_offset bigint, p_timestamp timestamp with time zone, p_signal_type text, p_spacetime jsonb, p_provenance jsonb, p_payload jsonb, p_source_id text, p_jurisdiction_id text, p_module_hint text, p_ingested_at timestamp with time zone)
 RETURNS text
 LANGUAGE sql
 STABLE STRICT
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
  SELECT encode(
    extensions.digest(
      concat_ws(
        chr(31),
        p_stream_id,
        p_offset::text,
        to_char(p_timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        p_signal_type,
        p_spacetime::text,
        p_provenance::text,
        p_payload::text,
        p_source_id,
        p_jurisdiction_id,
        p_module_hint,
        to_char(p_ingested_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      ),
      'sha256'
    ),
    'hex'
  );
$function$;
CREATE OR REPLACE FUNCTION public.bridge_atlas_stream_runtime_snapshot_v1(p_snapshot jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'atlas', 'extensions', 'pg_temp'
AS $function$
declare
  v_config record;
  v_response extensions.http_response;
  v_body jsonb;
begin
  if jsonb_typeof(p_snapshot) <> 'object'
     or jsonb_typeof(p_snapshot->'streams') <> 'array'
     or coalesce(p_snapshot->>'snapshot_hash','') !~ '^[0-9a-f]{64}$' then
    raise exception 'atlas_stream_runtime_snapshot_invalid';
  end if;

  select
    config.target_url,
    config.enabled,
    config.config_json->>'domain3_receipt_token' as bridge_token
    into v_config
    from atlas.bridge_config config
   where config.bridge_id = 'atlas-to-lighthouse'
   limit 1;

  if not found or not coalesce(v_config.enabled,false) then
    raise exception 'Atlas-to-Lighthouse bridge configuration is unavailable or disabled';
  end if;
  if coalesce(v_config.target_url,'') = '' then
    raise exception 'Atlas-to-Lighthouse target URL is missing';
  end if;
  if coalesce(length(v_config.bridge_token),0) < 32 then
    raise exception 'Atlas-to-Lighthouse scoped receipt token is missing';
  end if;

  select * into v_response
    from extensions.http((
      'POST',
      rtrim(v_config.target_url,'/') || '/api/atlas-domain3/streams',
      array[
        extensions.http_header('x-atlas-domain3-token', v_config.bridge_token),
        extensions.http_header('Accept','application/json')
      ],
      'application/json',
      p_snapshot::text
    )::extensions.http_request);

  if v_response.status < 200 or v_response.status >= 300 then
    raise exception 'Lighthouse stream projection HTTP %: %',
      v_response.status,
      left(coalesce(v_response.content,''),1000);
  end if;
  if coalesce(v_response.content,'') = '' then
    raise exception 'Lighthouse stream projection returned empty response';
  end if;

  v_body := v_response.content::jsonb;
  if jsonb_typeof(v_body) <> 'object'
     or coalesce((v_body->>'ok')::boolean,false) is not true
     or coalesce(v_body->>'snapshot_hash','') <> p_snapshot->>'snapshot_hash' then
    raise exception 'Lighthouse stream projection receipt invalid: %', left(v_response.content,1000);
  end if;

  return jsonb_build_object(
    'status','completed',
    'streams_registered',coalesce((v_body->>'streams_registered')::integer,0),
    'snapshot_hash',v_body->>'snapshot_hash',
    'observed_at',v_body->>'observed_at',
    'registered_at',v_body->>'registered_at',
    'transport','atlas_lighthouse_stream_runtime_receipt_v1',
    'http_status',v_response.status
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.bridge_live_data_signal_candidates_v1(p_run_id uuid, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'atlas', 'extensions', 'pg_temp'
AS $function$
declare
  v_config record;
  v_candidate record;
  v_response extensions.http_response;
  v_body jsonb;
  v_lighthouse_record_id uuid;
  v_record jsonb;
  v_bridged integer := 0;
  v_idempotent integer := 0;
  v_failed integer := 0;
  v_seen integer := 0;
  v_error text;
  v_receipts jsonb := '[]'::jsonb;
  v_projected_entity_state text;
  v_projected_verification_state text;
begin
  if p_run_id is null then
    raise exception 'p_run_id is required';
  end if;

  select
    config.target_url,
    config.enabled,
    config.config_json->>'domain3_receipt_token' as domain3_receipt_token
  into v_config
  from atlas.bridge_config config
  where config.bridge_id = 'atlas-to-lighthouse'
  limit 1;

  if not found or not coalesce(v_config.enabled, false) then
    raise exception 'Atlas-to-Lighthouse bridge configuration is unavailable or disabled';
  end if;
  if coalesce(v_config.target_url, '') = '' then
    raise exception 'Atlas-to-Lighthouse target URL is missing';
  end if;
  if coalesce(length(v_config.domain3_receipt_token), 0) < 32 then
    raise exception 'Atlas-to-Lighthouse scoped Domain 3 receipt token is missing';
  end if;

  for v_candidate in
    select candidate.*
    from atlas.live_data_signal_candidate candidate
    where candidate.last_run_id = p_run_id
    order by candidate.candidate_id
    limit least(greatest(coalesce(p_limit, 100), 1), 1000)
  loop
    v_seen := v_seen + 1;
    v_lighthouse_record_id := null;
    v_body := null;

    v_projected_entity_state := case
      when v_candidate.entity_resolution_status in ('resolved','ambiguous','unresolved','ignored')
        then v_candidate.entity_resolution_status
      else 'unresolved'
    end;

    v_projected_verification_state := case
      when v_candidate.verification_state in (
        'supported_one_source','supported_multiple_sources','contradicted',
        'disputed','incomplete','unresolved','verified'
      ) then v_candidate.verification_state
      else 'unresolved'
    end;

    v_record := jsonb_build_object(
      'atlas_candidate_id', v_candidate.candidate_id,
      'atlas_candidate_hash', v_candidate.candidate_hash,
      'atlas_semantic_key', v_candidate.semantic_key,
      'signal_type', v_candidate.signal_type,
      'title', v_candidate.title,
      'description', v_candidate.description,
      'primary_stream_id', v_candidate.primary_stream_id,
      'source_event_refs', v_candidate.source_event_refs,
      'entity_ids', to_jsonb(v_candidate.entity_ids),
      'entity_resolution_status', v_projected_entity_state,
      'jurisdiction_id', v_candidate.jurisdiction_id,
      'severity', v_candidate.severity,
      'confidence_score', v_candidate.confidence_score,
      'verification_state', v_projected_verification_state,
      'supporting_statistics', v_candidate.supporting_statistics || jsonb_build_object(
        'atlas_candidate_verification_state', v_candidate.verification_state,
        'atlas_candidate_entity_resolution_status', v_candidate.entity_resolution_status
      ),
      'evidence_refs', v_candidate.evidence_refs,
      'detection_rule_id', v_candidate.rule_id,
      'detection_rule_version', v_candidate.rule_version,
      'engine_id', v_candidate.engine_id,
      'engine_version', v_candidate.engine_version,
      'source_freshness_at', v_candidate.source_freshness_at,
      'detected_at', v_candidate.detected_at,
      'governance_status', 'observation_candidate'
    );

    begin
      select *
      into v_response
      from extensions.http((
        'POST',
        rtrim(v_config.target_url, '/') || '/api/atlas-domain3/receipt',
        array[
          extensions.http_header('x-atlas-domain3-token', v_config.domain3_receipt_token),
          extensions.http_header('Accept', 'application/json')
        ],
        'application/json',
        v_record::text
      )::extensions.http_request);

      if v_response.status < 200 or v_response.status >= 300 then
        raise exception 'Lighthouse registration HTTP %: %',
          v_response.status,
          left(coalesce(v_response.content, ''), 1000);
      end if;
      if coalesce(v_response.content, '') = '' then
        raise exception 'Lighthouse registration returned an empty response body';
      end if;

      v_body := v_response.content::jsonb;
      if jsonb_typeof(v_body) <> 'object'
         or coalesce((v_body->>'ok')::boolean, false) is not true then
        raise exception 'Lighthouse registration returned a malformed receipt: %',
          left(v_response.content, 1000);
      end if;

      v_lighthouse_record_id := nullif(v_body->>'live_data_signal_id', '')::uuid;
      if v_lighthouse_record_id is null then
        raise exception 'Lighthouse registration receipt contains no live_data_signal_id: %',
          left(v_response.content, 1000);
      end if;

      if v_candidate.lighthouse_status = 'bridged'
         and v_candidate.lighthouse_record_id = v_lighthouse_record_id then
        v_idempotent := v_idempotent + 1;
      else
        v_bridged := v_bridged + 1;
      end if;

      update atlas.live_data_signal_candidate
      set lighthouse_status = 'bridged',
          lighthouse_record_id = v_lighthouse_record_id,
          lighthouse_last_error = null,
          lighthouse_bridged_at = clock_timestamp()
      where candidate_id = v_candidate.candidate_id;

      v_receipts := v_receipts || jsonb_build_array(jsonb_build_object(
        'candidate_id', v_candidate.candidate_id,
        'candidate_hash', v_candidate.candidate_hash,
        'semantic_key', v_candidate.semantic_key,
        'lighthouse_record_id', v_lighthouse_record_id,
        'signal_hash', v_body->>'signal_hash',
        'governance_status', v_body->>'governance_status',
        'projected_verification_state', v_projected_verification_state,
        'projected_entity_resolution_status', v_projected_entity_state,
        'status', case
          when v_candidate.lighthouse_status = 'bridged'
           and v_candidate.lighthouse_record_id = v_lighthouse_record_id
          then 'idempotent'
          else 'bridged'
        end,
        'http_status', v_response.status
      ));
    exception when others then
      get stacked diagnostics v_error = message_text;
      v_failed := v_failed + 1;

      update atlas.live_data_signal_candidate
      set lighthouse_status = 'failed',
          lighthouse_last_error = left(v_error, 2000)
      where candidate_id = v_candidate.candidate_id;

      v_receipts := v_receipts || jsonb_build_array(jsonb_build_object(
        'candidate_id', v_candidate.candidate_id,
        'candidate_hash', v_candidate.candidate_hash,
        'semantic_key', v_candidate.semantic_key,
        'status', 'failed',
        'error', left(v_error, 1000)
      ));
    end;
  end loop;

  return jsonb_build_object(
    'run_id', p_run_id,
    'candidates_seen', v_seen,
    'bridged', v_bridged,
    'idempotent', v_idempotent,
    'failed', v_failed,
    'transport', 'atlas_lighthouse_direct_postgres_receipt_v2',
    'state_projection', 'atlas_candidate_identity_to_lighthouse_governed_state_v2',
    'target_project', 'lighthouse',
    'completed_at', clock_timestamp(),
    'receipts', v_receipts
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.bridge_live_data_signal_retirements_v1(p_run_id uuid, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'atlas', 'extensions', 'pg_temp'
AS $function$
declare
  v_config record;
  v_retirement record;
  v_response extensions.http_response;
  v_body jsonb;
  v_seen integer := 0;
  v_bridged integer := 0;
  v_idempotent integer := 0;
  v_failed integer := 0;
  v_error text;
  v_receipts jsonb := '[]'::jsonb;
begin
  if p_run_id is null then raise exception 'p_run_id is required'; end if;

  select config.target_url,config.enabled,config.config_json->>'domain3_receipt_token' as domain3_receipt_token
    into v_config
  from atlas.bridge_config config
  where config.bridge_id='atlas-to-lighthouse'
  limit 1;
  if not found or not coalesce(v_config.enabled,false) then
    raise exception 'Atlas-to-Lighthouse bridge configuration is unavailable or disabled';
  end if;
  if coalesce(v_config.target_url,'')='' then raise exception 'Atlas-to-Lighthouse target URL is missing'; end if;
  if coalesce(length(v_config.domain3_receipt_token),0)<32 then
    raise exception 'Atlas-to-Lighthouse scoped Domain 3 receipt token is missing';
  end if;

  for v_retirement in
    select r.*
    from atlas.live_data_signal_candidate_retirement_v1 r
    where r.run_id=p_run_id
      and r.lighthouse_status in ('pending','failed')
    order by r.retirement_id
    limit least(greatest(coalesce(p_limit,100),1),1000)
  loop
    v_seen := v_seen+1;
    begin
      select * into v_response
      from extensions.http((
        'POST',
        rtrim(v_config.target_url,'/')||'/api/atlas-domain3/retirement',
        array[
          extensions.http_header('x-atlas-domain3-token',v_config.domain3_receipt_token),
          extensions.http_header('Accept','application/json')
        ],
        'application/json',
        jsonb_build_object(
          'semantic_key',v_retirement.semantic_key,
          'atlas_candidate_id',v_retirement.candidate_id,
          'atlas_candidate_hash',v_retirement.candidate_hash,
          'atlas_run_id',v_retirement.run_id,
          'lighthouse_record_id',v_retirement.lighthouse_record_id,
          'retirement_reason',v_retirement.retirement_reason,
          'retirement_hash',v_retirement.retirement_hash,
          'retired_at',v_retirement.retired_at
        )::text
      )::extensions.http_request);

      if v_response.status<200 or v_response.status>=300 then
        raise exception 'Lighthouse retirement HTTP %: %',v_response.status,left(coalesce(v_response.content,''),1000);
      end if;
      if coalesce(v_response.content,'')='' then
        raise exception 'Lighthouse retirement returned an empty response body';
      end if;
      v_body := v_response.content::jsonb;
      if jsonb_typeof(v_body)<>'object' or coalesce((v_body->>'ok')::boolean,false) is not true then
        raise exception 'Lighthouse retirement returned a malformed receipt: %',left(v_response.content,1000);
      end if;

      if v_retirement.lighthouse_status='bridged' then
        v_idempotent := v_idempotent+1;
      else
        v_bridged := v_bridged+1;
      end if;
      update atlas.live_data_signal_candidate_retirement_v1
         set lighthouse_status='bridged',
             lighthouse_last_error=null,
             lighthouse_bridged_at=clock_timestamp()
       where retirement_id=v_retirement.retirement_id;
      v_receipts := v_receipts || jsonb_build_array(jsonb_build_object(
        'retirement_id',v_retirement.retirement_id,
        'candidate_id',v_retirement.candidate_id,
        'semantic_key',v_retirement.semantic_key,
        'status',coalesce(v_body->>'status','retired'),
        'http_status',v_response.status,
        'lighthouse_retirement_receipt_id',v_body->>'retirement_receipt_id'
      ));
    exception when others then
      get stacked diagnostics v_error=message_text;
      v_failed := v_failed+1;
      update atlas.live_data_signal_candidate_retirement_v1
         set lighthouse_status='failed',
             lighthouse_last_error=left(v_error,2000)
       where retirement_id=v_retirement.retirement_id;
      v_receipts := v_receipts || jsonb_build_array(jsonb_build_object(
        'retirement_id',v_retirement.retirement_id,
        'candidate_id',v_retirement.candidate_id,
        'semantic_key',v_retirement.semantic_key,
        'status','failed',
        'error',left(v_error,1000)
      ));
    end;
  end loop;

  return jsonb_build_object(
    'run_id',p_run_id,
    'retirements_seen',v_seen,
    'bridged',v_bridged,
    'idempotent',v_idempotent,
    'failed',v_failed,
    'transport','atlas_lighthouse_signal_retirement_v1',
    'completed_at',clock_timestamp(),
    'receipts',v_receipts
  );
end
$function$;
CREATE OR REPLACE FUNCTION public.complete_atlas_event_entity_resolution_run_v1(p_run_id uuid, p_status text, p_counts jsonb DEFAULT '{}'::jsonb, p_last_stream_id text DEFAULT NULL::text, p_last_offset bigint DEFAULT NULL::bigint, p_error_message text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'atlas', 'extensions'
AS $function$
DECLARE
  v_run atlas.signal_event_entity_resolution_run%ROWTYPE;
BEGIN
  IF p_status NOT IN ('completed', 'partial', 'failed') THEN
    RAISE EXCEPTION 'completion status must be completed, partial, or failed';
  END IF;

  SELECT * INTO v_run
  FROM atlas.signal_event_entity_resolution_run
  WHERE run_id = p_run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'resolution run not found: %', p_run_id;
  END IF;

  IF v_run.status <> 'running' THEN
    IF v_run.status = p_status THEN
      RETURN jsonb_build_object(
        'run_id', v_run.run_id,
        'status', v_run.status,
        'idempotent', true,
        'processed_event_count', v_run.processed_event_count,
        'resolution_row_count', v_run.resolution_row_count,
        'last_stream_id', v_run.last_stream_id,
        'last_offset', v_run.last_offset,
        'completed_at', v_run.completed_at,
        'error_message', v_run.error_message
      );
    END IF;
    RAISE EXCEPTION 'run % is already %, cannot complete as %', p_run_id, v_run.status, p_status;
  END IF;

  IF p_counts ? 'processed_event_count'
     AND (p_counts->>'processed_event_count')::bigint <> v_run.processed_event_count THEN
    RAISE EXCEPTION 'processed event count mismatch for run %', p_run_id;
  END IF;
  IF p_counts ? 'resolution_row_count'
     AND (p_counts->>'resolution_row_count')::bigint <> v_run.resolution_row_count THEN
    RAISE EXCEPTION 'resolution row count mismatch for run %', p_run_id;
  END IF;
  IF p_counts ? 'resolved_count'
     AND (p_counts->>'resolved_count')::bigint <> v_run.resolved_count THEN
    RAISE EXCEPTION 'resolved count mismatch for run %', p_run_id;
  END IF;
  IF p_counts ? 'ambiguous_count'
     AND (p_counts->>'ambiguous_count')::bigint <> v_run.ambiguous_count THEN
    RAISE EXCEPTION 'ambiguous count mismatch for run %', p_run_id;
  END IF;
  IF p_counts ? 'unresolved_count'
     AND (p_counts->>'unresolved_count')::bigint <> v_run.unresolved_count THEN
    RAISE EXCEPTION 'unresolved count mismatch for run %', p_run_id;
  END IF;
  IF p_counts ? 'ignored_count'
     AND (p_counts->>'ignored_count')::bigint <> v_run.ignored_count THEN
    RAISE EXCEPTION 'ignored count mismatch for run %', p_run_id;
  END IF;
  IF p_counts ? 'inserted_count'
     AND (p_counts->>'inserted_count')::bigint <> v_run.inserted_count THEN
    RAISE EXCEPTION 'inserted count mismatch for run %', p_run_id;
  END IF;
  IF p_counts ? 'idempotent_count'
     AND (p_counts->>'idempotent_count')::bigint <> v_run.idempotent_count THEN
    RAISE EXCEPTION 'idempotent count mismatch for run %', p_run_id;
  END IF;

  UPDATE atlas.signal_event_entity_resolution_run
  SET status = p_status,
      last_stream_id = p_last_stream_id,
      last_offset = p_last_offset,
      error_message = p_error_message,
      completed_at = now()
  WHERE run_id = p_run_id
  RETURNING * INTO v_run;

  RETURN jsonb_build_object(
    'run_id', v_run.run_id,
    'status', v_run.status,
    'idempotent', false,
    'processed_event_count', v_run.processed_event_count,
    'resolution_row_count', v_run.resolution_row_count,
    'resolved_count', v_run.resolved_count,
    'ambiguous_count', v_run.ambiguous_count,
    'unresolved_count', v_run.unresolved_count,
    'ignored_count', v_run.ignored_count,
    'inserted_count', v_run.inserted_count,
    'idempotent_count', v_run.idempotent_count,
    'last_stream_id', v_run.last_stream_id,
    'last_offset', v_run.last_offset,
    'completed_at', v_run.completed_at,
    'error_message', v_run.error_message
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.detect_propublica_unresolved_metadata_v1(p_min_unique_records integer DEFAULT 10, p_min_unresolved_rate numeric DEFAULT 0.5, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'atlas', 'extensions'
AS $function$
declare
  v_run_id uuid := gen_random_uuid();
  v_rule_hash text;
  v_scanned bigint := 0;
  v_entities bigint := 0;
  v_candidates bigint := 0;
  v_result jsonb := '[]'::jsonb;
  v_error text;
  v_row record;
  v_candidate_hash text;
  v_candidate_id uuid;
  v_candidate_status text;
  v_candidate_lighthouse_id uuid;
begin
  select rule_contract_hash into v_rule_hash
  from atlas.live_data_signal_rule
  where rule_id = 'atlas.propublica_unresolved_filing_metadata_rate'
    and rule_version = '1.1.0'
    and is_active;

  if v_rule_hash is null then
    raise exception 'active ProPublica unresolved-metadata rule 1.1.0 is not registered';
  end if;

  insert into atlas.live_data_signal_run (
    run_id, rule_id, rule_version, rule_contract_hash, status
  ) values (
    v_run_id,
    'atlas.propublica_unresolved_filing_metadata_rate',
    '1.1.0',
    v_rule_hash,
    'running'
  );

  begin
    select count(*) into v_scanned
    from atlas.signal_event_identity
    where stream_id = 'pro_publica'
      and signal_type = 'nonprofit_990_filing';

    select count(*) into v_entities
    from atlas.v_propublica_unresolved_metadata_candidate_v1;

    for v_row in
      with eligible_raw as (
        select *
        from atlas.v_propublica_unresolved_metadata_candidate_v1
        where unique_record_count >= greatest(p_min_unique_records, 1)
          and unresolved_unique_rate >= greatest(p_min_unresolved_rate, 0)
      ), ranked as (
        select eligible_raw.*,
               row_number() over (
                 partition by entity_id, source_input_hash
                 order by unresolved_unique_rate desc,
                          unique_record_count desc,
                          primary_name,
                          normalized_entity_name
               ) as identity_rank
        from eligible_raw
      )
      select *
      from ranked
      where identity_rank = 1
      order by unresolved_unique_rate desc, unique_record_count desc, entity_id
      limit least(greatest(p_limit, 1), 1000)
    loop
      v_candidate_hash := encode(
        extensions.digest(
          convert_to(
            jsonb_build_object(
              'domain', 'live_data',
              'candidate_identity_version', '1.1.0',
              'signal_type', 'elevated_unresolved_record_rate',
              'entity_id', v_row.entity_id,
              'source_input_hash', v_row.source_input_hash,
              'rule_contract_hash', v_rule_hash
            )::text,
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      );

      insert into atlas.live_data_signal_candidate (
        candidate_hash, rule_id, rule_version, rule_contract_hash,
        engine_id, engine_version, signal_type, title, description,
        primary_stream_id, source_event_refs, entity_ids,
        entity_resolution_status, jurisdiction_id, severity, confidence_score,
        verification_state, supporting_statistics, evidence_refs,
        source_freshness_at, detected_at, source_input_hash,
        first_run_id, last_run_id
      ) values (
        v_candidate_hash,
        'atlas.propublica_unresolved_filing_metadata_rate',
        '1.1.0',
        v_rule_hash,
        'atlas.live_data_signal_exact',
        '1.1.0',
        'elevated_unresolved_record_rate',
        'Elevated unresolved nonprofit filing metadata rate',
        format(
          'Atlas observed %s of %s unique ProPublica filing records for %s with unresolved tax-period, form-type, or external-identity metadata. This is a data-quality observation, not a misconduct or legal finding.',
          v_row.unresolved_unique_record_count,
          v_row.unique_record_count,
          v_row.primary_name
        ),
        'pro_publica',
        v_row.source_event_refs,
        array[v_row.entity_id]::text[],
        'resolved',
        'us_federal',
        v_row.severity,
        1.0,
        'verified',
        v_row.supporting_statistics || jsonb_build_object(
          'minimum_unique_records', greatest(p_min_unique_records, 1),
          'minimum_unresolved_rate', greatest(p_min_unresolved_rate, 0),
          'candidate_identity_deduplicated', true,
          'persistence_mode', 'sequential_idempotent_upsert'
        ),
        v_row.source_event_refs,
        v_row.source_freshness_at,
        clock_timestamp(),
        v_row.source_input_hash,
        v_run_id,
        v_run_id
      )
      on conflict (candidate_hash) do update set
        last_run_id = excluded.last_run_id,
        last_replayed_at = clock_timestamp(),
        source_event_refs = excluded.source_event_refs,
        supporting_statistics = excluded.supporting_statistics,
        evidence_refs = excluded.evidence_refs,
        source_freshness_at = excluded.source_freshness_at
      returning candidate_id, lighthouse_status, lighthouse_record_id
      into v_candidate_id, v_candidate_status, v_candidate_lighthouse_id;

      v_candidates := v_candidates + 1;
      v_result := v_result || jsonb_build_array(
        jsonb_build_object(
          'candidate_id', v_candidate_id,
          'candidate_hash', v_candidate_hash,
          'lighthouse_record', jsonb_build_object(
            'signal_type', 'elevated_unresolved_record_rate',
            'title', 'Elevated unresolved nonprofit filing metadata rate',
            'description', format(
              'Atlas observed %s of %s unique ProPublica filing records for %s with unresolved tax-period, form-type, or external-identity metadata. This is a data-quality observation, not a misconduct or legal finding.',
              v_row.unresolved_unique_record_count,
              v_row.unique_record_count,
              v_row.primary_name
            ),
            'primary_stream_id', 'pro_publica',
            'source_event_refs', v_row.source_event_refs,
            'entity_ids', jsonb_build_array(v_row.entity_id),
            'entity_resolution_status', 'resolved',
            'jurisdiction_id', 'us_federal',
            'severity', v_row.severity,
            'confidence_score', 1.0,
            'verification_state', 'verified',
            'supporting_statistics', v_row.supporting_statistics,
            'evidence_refs', v_row.source_event_refs,
            'detection_rule_id', 'atlas.propublica_unresolved_filing_metadata_rate',
            'detection_rule_version', '1.1.0',
            'engine_id', 'atlas.live_data_signal_exact',
            'engine_version', '1.1.0',
            'source_freshness_at', v_row.source_freshness_at,
            'detected_at', clock_timestamp(),
            'governance_status', 'observation_candidate'
          ),
          'lighthouse_status', v_candidate_status,
          'lighthouse_record_id', v_candidate_lighthouse_id
        )
      );
    end loop;

    update atlas.live_data_signal_run
    set status = 'completed',
        canonical_events_scanned = v_scanned,
        entities_evaluated = v_entities,
        candidates_produced = v_candidates,
        completed_at = clock_timestamp()
    where run_id = v_run_id;
  exception when others then
    get stacked diagnostics v_error = message_text;
    update atlas.live_data_signal_run
    set status = 'failed',
        canonical_events_scanned = v_scanned,
        entities_evaluated = v_entities,
        candidates_produced = v_candidates,
        error_message = left(v_error, 2000),
        completed_at = clock_timestamp()
    where run_id = v_run_id;
    return jsonb_build_object(
      'run_id', v_run_id,
      'status', 'failed',
      'error_message', v_error,
      'candidates', '[]'::jsonb
    );
  end;

  return jsonb_build_object(
    'run_id', v_run_id,
    'status', 'completed',
    'rule_id', 'atlas.propublica_unresolved_filing_metadata_rate',
    'rule_version', '1.1.0',
    'rule_contract_hash', v_rule_hash,
    'canonical_events_scanned', v_scanned,
    'entities_evaluated', v_entities,
    'candidates_produced', v_candidates,
    'candidates', v_result
  );
end
$function$;
CREATE OR REPLACE FUNCTION public.enqueue_live_data_signal_candidates_v1(p_run_id uuid, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'atlas', 'net', 'extensions', 'pg_temp'
AS $function$
declare
  v_config record;
  v_candidate record;
  v_request_id bigint;
  v_record jsonb;
  v_seen integer := 0;
  v_queued integer := 0;
  v_existing integer := 0;
  v_failed integer := 0;
  v_error text;
  v_receipts jsonb := '[]'::jsonb;
begin
  if p_run_id is null then
    raise exception 'p_run_id is required';
  end if;

  if not exists (
    select 1
    from atlas.live_data_signal_run run
    where run.run_id = p_run_id
      and run.status = 'completed'
  ) then
    raise exception 'completed Domain 3 run not found: %', p_run_id;
  end if;

  select *
    into v_config
    from public.atlas_bridge_config_for('atlas-to-lighthouse');

  if not found or not coalesce(v_config.enabled, false) then
    raise exception 'Atlas-to-Lighthouse bridge configuration is unavailable or disabled';
  end if;

  if coalesce(v_config.target_url, '') = ''
     or coalesce(v_config.target_service_key, '') = '' then
    raise exception 'Atlas-to-Lighthouse bridge target credentials are incomplete';
  end if;

  for v_candidate in
    select candidate.*
      from atlas.live_data_signal_candidate candidate
     where candidate.last_run_id = p_run_id
     order by candidate.candidate_id
     limit least(greatest(coalesce(p_limit, 100), 1), 1000)
  loop
    v_seen := v_seen + 1;

    if exists (
      select 1
      from atlas.live_data_signal_bridge_attempt attempt
      where attempt.run_id = p_run_id
        and attempt.candidate_id = v_candidate.candidate_id
    ) then
      v_existing := v_existing + 1;
      continue;
    end if;

    v_record := jsonb_build_object(
      'signal_type', v_candidate.signal_type,
      'title', v_candidate.title,
      'description', v_candidate.description,
      'primary_stream_id', v_candidate.primary_stream_id,
      'source_event_refs', v_candidate.source_event_refs,
      'entity_ids', to_jsonb(v_candidate.entity_ids),
      'entity_resolution_status', v_candidate.entity_resolution_status,
      'jurisdiction_id', v_candidate.jurisdiction_id,
      'severity', v_candidate.severity,
      'confidence_score', v_candidate.confidence_score,
      'verification_state', v_candidate.verification_state,
      'supporting_statistics', v_candidate.supporting_statistics,
      'evidence_refs', v_candidate.evidence_refs,
      'detection_rule_id', v_candidate.rule_id,
      'detection_rule_version', v_candidate.rule_version,
      'engine_id', v_candidate.engine_id,
      'engine_version', v_candidate.engine_version,
      'source_freshness_at', v_candidate.source_freshness_at,
      'detected_at', v_candidate.detected_at,
      'governance_status', 'observation_candidate'
    );

    begin
      select net.http_post(
        url := rtrim(v_config.target_url, '/') ||
          '/rest/v1/rpc/register_live_data_signal_receipt_v1',
        body := jsonb_build_object('p_record', v_record),
        params := '{}'::jsonb,
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || v_config.target_service_key,
          'apikey', v_config.target_service_key,
          'Content-Type', 'application/json',
          'Accept', 'application/json'
        ),
        timeout_milliseconds := 10000
      ) into v_request_id;

      insert into atlas.live_data_signal_bridge_attempt (
        run_id, candidate_id, candidate_hash, request_id, status,
        was_already_bridged, prior_lighthouse_record_id
      ) values (
        p_run_id, v_candidate.candidate_id, v_candidate.candidate_hash,
        v_request_id, 'queued', v_candidate.lighthouse_status = 'bridged',
        v_candidate.lighthouse_record_id
      );

      update atlas.live_data_signal_candidate
         set lighthouse_status = 'pending',
             lighthouse_last_error = null
       where candidate_id = v_candidate.candidate_id;

      v_queued := v_queued + 1;
      v_receipts := v_receipts || jsonb_build_array(jsonb_build_object(
        'candidate_id', v_candidate.candidate_id,
        'candidate_hash', v_candidate.candidate_hash,
        'request_id', v_request_id,
        'status', 'queued'
      ));
    exception when others then
      get stacked diagnostics v_error = message_text;
      v_failed := v_failed + 1;

      insert into atlas.live_data_signal_bridge_attempt (
        run_id, candidate_id, candidate_hash, request_id, status,
        was_already_bridged, prior_lighthouse_record_id,
        error_message, settled_at
      ) values (
        p_run_id, v_candidate.candidate_id, v_candidate.candidate_hash,
        null, 'failed', v_candidate.lighthouse_status = 'bridged',
        v_candidate.lighthouse_record_id, left(v_error, 2000), clock_timestamp()
      )
      on conflict (run_id, candidate_id) do nothing;

      update atlas.live_data_signal_candidate
         set lighthouse_status = 'failed',
             lighthouse_last_error = left(v_error, 2000)
       where candidate_id = v_candidate.candidate_id;

      v_receipts := v_receipts || jsonb_build_array(jsonb_build_object(
        'candidate_id', v_candidate.candidate_id,
        'candidate_hash', v_candidate.candidate_hash,
        'status', 'enqueue_failed',
        'error', left(v_error, 1000)
      ));
    end;
  end loop;

  return jsonb_build_object(
    'run_id', p_run_id,
    'candidates_seen', v_seen,
    'queued', v_queued,
    'existing_attempts', v_existing,
    'enqueue_failed', v_failed,
    'transport', 'atlas_pg_net_receipt_v1',
    'completed_at', clock_timestamp(),
    'receipts', v_receipts
  );
end
$function$;
CREATE OR REPLACE FUNCTION public.evaluate_canonical_payload_usefulness(p_record_kind text, p_contacts jsonb, p_legal_basis jsonb, p_escalation_paths jsonb, p_source_url text, p_source_anchor text, p_verbatim_text text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  has_contact_or_escalation boolean;
  has_source_basis boolean;
  has_legal_or_action_value boolean;
begin
  has_contact_or_escalation :=
    public.jsonb_array_count(coalesce(p_contacts->'phones','[]'::jsonb)) > 0
    or public.jsonb_array_count(coalesce(p_contacts->'emails','[]'::jsonb)) > 0
    or public.jsonb_array_count(coalesce(p_contacts->'urls','[]'::jsonb)) > 0
    or public.jsonb_array_count(coalesce(p_contacts->'addresses','[]'::jsonb)) > 0
    or public.jsonb_array_count(coalesce(p_escalation_paths->'steps','[]'::jsonb)) > 0
    or public.jsonb_array_count(coalesce(p_escalation_paths->'contacts','[]'::jsonb)) > 0;

  has_source_basis :=
    length(coalesce(p_verbatim_text,'')) > 0
    and (
      length(coalesce(p_source_url,'')) > 0
      or length(coalesce(p_source_anchor,'')) > 0
      or public.jsonb_array_count(coalesce(p_contacts->'urls','[]'::jsonb)) > 0
    );

  has_legal_or_action_value :=
    public.jsonb_array_count(coalesce(p_legal_basis->'statutes','[]'::jsonb)) > 0
    or public.jsonb_array_count(coalesce(p_legal_basis->'deadlines','[]'::jsonb)) > 0
    or coalesce(p_record_kind,'') in ('program','workflow','oversight','access_point','legislator','committee','agency','benefit','resource','escalation','legal_authority');

  if has_contact_or_escalation and has_source_basis and has_legal_or_action_value then
    return 'useful';
  elsif has_source_basis and has_legal_or_action_value then
    return 'needs_repair';
  else
    return 'not_useful';
  end if;
end;
$function$;
CREATE OR REPLACE FUNCTION public.fetch_atlas_entity_cross_stream_correlations_v1(p_min_streams integer DEFAULT 2, p_limit integer DEFAULT 100, p_entity_id text DEFAULT NULL::text)
 RETURNS TABLE(entity_id text, canonical_entity_name text, canonical_entity_type text, resolved_event_count bigint, stream_count bigint, stream_ids text[], signal_type_count bigint, signal_types text[], first_event_at timestamp with time zone, latest_event_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
  SELECT
    summary.entity_id::text,
    summary.canonical_entity_name::text,
    summary.canonical_entity_type::text,
    summary.resolved_event_count,
    summary.stream_count,
    summary.stream_ids,
    summary.signal_type_count,
    summary.signal_types,
    summary.first_event_at,
    summary.latest_event_at
  FROM public.v_atlas_entity_cross_stream_summary_v1 summary
  WHERE summary.stream_count >= GREATEST(2, LEAST(COALESCE(p_min_streams, 2), 1000))
    AND (p_entity_id IS NULL OR summary.entity_id = p_entity_id)
  ORDER BY
    summary.stream_count DESC,
    summary.resolved_event_count DESC,
    summary.latest_event_at DESC,
    summary.entity_id
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 5000));
$function$;
CREATE OR REPLACE FUNCTION public.fetch_atlas_event_entity_resolution_review_v1(p_resolution_status text DEFAULT NULL::text, p_min_event_count integer DEFAULT 1, p_limit integer DEFAULT 100)
 RETURNS TABLE(review_key text, resolution_status text, rule_id text, rule_version text, entity_role text, expected_entity_type text, normalized_entity_value text, source_identifier_type text, normalized_identifier_value text, sample_source_entity_value text, sample_source_identifier_value text, event_count bigint, stream_count bigint, stream_ids text[], source_fields text[], candidate_sets jsonb, first_event_at timestamp with time zone, latest_event_at timestamp with time zone, rule_manifest_hash text, entity_index_hash text, resolver_id text, resolver_version text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
  SELECT
    review.review_key,
    review.resolution_status,
    review.rule_id,
    review.rule_version,
    review.entity_role,
    review.expected_entity_type,
    review.normalized_entity_value,
    review.source_identifier_type,
    review.normalized_identifier_value,
    review.sample_source_entity_value,
    review.sample_source_identifier_value,
    review.event_count,
    review.stream_count,
    review.stream_ids,
    review.source_fields,
    review.candidate_sets,
    review.first_event_at,
    review.latest_event_at,
    review.rule_manifest_hash,
    review.entity_index_hash,
    review.resolver_id,
    review.resolver_version
  FROM public.v_atlas_event_entity_resolution_review_v1 review
  WHERE (
      p_resolution_status IS NULL
      OR (
        p_resolution_status IN ('ambiguous', 'unresolved')
        AND review.resolution_status = p_resolution_status
      )
    )
    AND review.event_count >= GREATEST(1, COALESCE(p_min_event_count, 1))
  ORDER BY
    review.event_count DESC,
    review.stream_count DESC,
    review.latest_event_at DESC,
    review.review_key
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 5000));
$function$;
CREATE OR REPLACE FUNCTION public.fetch_atlas_resolved_entity_events_v1(p_entity_id text, p_limit integer DEFAULT 100, p_before_timestamp timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(stream_id text, event_offset bigint, event_timestamp timestamp with time zone, signal_type text, source_id text, jurisdiction_id text, module_hint text, entity_role text, entity_id text, canonical_entity_name text, canonical_entity_type text, rule_id text, rule_version text, match_method text, resolution_hash text, resolver_id text, resolver_version text, entity_index_hash text, spacetime jsonb, provenance jsonb, payload jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
  SELECT
    resolved.stream_id,
    resolved.event_offset,
    resolved.event_timestamp,
    resolved.signal_type,
    resolved.source_id,
    resolved.jurisdiction_id,
    resolved.module_hint,
    resolved.entity_role,
    resolved.entity_id::text,
    resolved.canonical_entity_name::text,
    resolved.canonical_entity_type::text,
    resolved.rule_id,
    resolved.rule_version,
    resolved.match_method,
    resolved.resolution_hash,
    resolved.resolver_id,
    resolved.resolver_version,
    resolved.entity_index_hash,
    resolved.spacetime,
    resolved.provenance,
    resolved.payload
  FROM public.v_atlas_resolved_signal_event_entities_v1 resolved
  WHERE COALESCE(btrim(p_entity_id), '') <> ''
    AND resolved.entity_id = p_entity_id
    AND (p_before_timestamp IS NULL OR resolved.event_timestamp < p_before_timestamp)
  ORDER BY resolved.event_timestamp DESC, resolved.stream_id, resolved.event_offset DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 5000));
$function$;
CREATE OR REPLACE FUNCTION public.fetch_atlas_signal_events_for_entity_resolution_v1(p_batch_size integer DEFAULT 500, p_stream_id text DEFAULT NULL::text, p_after_stream_id text DEFAULT NULL::text, p_after_offset bigint DEFAULT '-1'::integer)
 RETURNS TABLE(stream_id text, "offset" bigint, "timestamp" timestamp with time zone, signal_type text, spacetime jsonb, provenance jsonb, payload jsonb, source_id text, jurisdiction_id text, module_hint text, ingested_at timestamp with time zone, event_input_hash text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
  SELECT
    se.stream_id,
    se."offset",
    se."timestamp",
    se.signal_type,
    se.spacetime,
    se.provenance,
    se.payload,
    se.source_id,
    se.jurisdiction_id,
    se.module_hint,
    se.ingested_at,
    public.atlas_signal_event_input_hash_v1(
      se.stream_id,
      se."offset",
      se."timestamp",
      se.signal_type,
      se.spacetime,
      se.provenance,
      se.payload,
      se.source_id,
      se.jurisdiction_id,
      se.module_hint,
      se.ingested_at
    ) AS event_input_hash
  FROM public.signal_events se
  WHERE (p_stream_id IS NULL OR se.stream_id = p_stream_id)
    AND (
      p_after_stream_id IS NULL
      OR (se.stream_id, se."offset") > (p_after_stream_id, COALESCE(p_after_offset, -1))
    )
  ORDER BY se.stream_id, se."offset"
  LIMIT GREATEST(1, LEAST(COALESCE(p_batch_size, 500), 5000));
$function$;
CREATE OR REPLACE FUNCTION public.get_lighthouse_signal_events(p_stream_id text, p_offset bigint DEFAULT 0, p_limit integer DEFAULT 1000)
 RETURNS TABLE(stream_id text, "offset" bigint, "timestamp" timestamp with time zone, signal_type text, spacetime jsonb, provenance jsonb, payload jsonb, source_id text, jurisdiction_id text, module_hint text, ingested_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'atlas'
AS $function$
select event.stream_id,event."offset",event."timestamp",event.signal_type,event.spacetime,event.provenance,event.payload,event.source_id,event.jurisdiction_id,event.module_hint,identity.last_seen_at as ingested_at
from atlas.signal_event_identity identity join public.signal_events event on event.stream_id=identity.stream_id and event."offset"=identity.canonical_offset join private.lighthouse_stream_export_allowlist allowlist on allowlist.stream_id=event.stream_id and allowlist.export_enabled
where event.stream_id=p_stream_id and event."offset">=greatest(coalesce(p_offset,0),0) order by event."offset" limit least(greatest(coalesce(p_limit,1000),1),1000)
$function$;
CREATE OR REPLACE FUNCTION public.get_lighthouse_stream_definition(p_stream_id text)
 RETURNS TABLE(stream_id text, source_id text, jurisdiction_id text, module_hint text, throughput_profile text, safety_profile text, governance_contract_id text, status text, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
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
    stream.updated_at
  from public.streams stream
  join private.lighthouse_stream_export_allowlist allowlist
    on allowlist.stream_id = stream.stream_id
   and allowlist.export_enabled
  where stream.stream_id = p_stream_id
  limit 1
$function$;
CREATE OR REPLACE FUNCTION public.ingest_canonical_extracted_record_batch(p_records jsonb)
 RETURNS TABLE(inserted_id uuid, record_name text, record_kind text, usefulness_status text)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  item jsonb;
  v_id uuid;
begin
  if jsonb_typeof(p_records) <> 'array' then
    raise exception 'p_records must be a jsonb array';
  end if;
  for item in select value from jsonb_array_elements(p_records) loop
    v_id := public.ingest_canonical_extracted_record(item);
    return query select cer.id, cer.record_name, cer.record_kind, cer.usefulness_status from public.canonical_extracted_records cer where cer.id = v_id;
  end loop;
end;
$function$;
CREATE OR REPLACE FUNCTION public.ingest_canonical_extracted_record(p_record jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_id uuid;
  v_facts jsonb := '{}'::jsonb;
  v_contacts jsonb := '{}'::jsonb;
  v_legal_basis jsonb := '{}'::jsonb;
  v_relationships jsonb := '{}'::jsonb;
  v_escalation_paths jsonb := '{}'::jsonb;
  v_hash text;
  v_signals text[] := '{}';
  v_source_url text := '';
  v_verbatim text := '';
  v_kind text := 'unknown';
  v_usefulness text := 'unchecked';
begin
  v_facts := coalesce(p_record->'facts', '{}'::jsonb);
  v_kind := coalesce(p_record->>'record_kind', p_record->>'entity_type', 'unknown');
  v_source_url := coalesce(p_record->>'source_url', '');
  v_verbatim := coalesce(p_record->>'verbatim_text', p_record->>'raw_text', '');

  v_contacts := jsonb_build_object(
    'phones', coalesce(v_facts->'phones', p_record->'phones', '[]'::jsonb),
    'emails', coalesce(v_facts->'emails', p_record->'emails', '[]'::jsonb),
    'urls', coalesce(v_facts->'urls', p_record->'urls', '[]'::jsonb),
    'addresses', coalesce(v_facts->'addresses', p_record->'addresses', '[]'::jsonb)
  );

  v_legal_basis := jsonb_build_object(
    'statutes', coalesce(v_facts->'statutes', p_record->'statutes', '[]'::jsonb),
    'deadlines', coalesce(v_facts->'deadlines', p_record->'deadlines', '[]'::jsonb),
    'dates', coalesce(v_facts->'dates', p_record->'dates', '[]'::jsonb),
    'source_url', v_source_url,
    'source_anchor', coalesce(p_record->>'source_anchor', ''),
    'verbatim_text', v_verbatim
  );

  v_relationships := coalesce(p_record->'relationships', jsonb_build_object(
    'committees', coalesce(p_record->'committees', '[]'::jsonb),
    'memberships', coalesce(p_record->'memberships', '[]'::jsonb),
    'roles', coalesce(p_record->'roles', '[]'::jsonb)
  ));

  v_escalation_paths := coalesce(p_record->'escalation_paths', jsonb_build_object(
    'steps', coalesce(p_record->'steps', '[]'::jsonb),
    'contacts', coalesce(p_record->'escalation_contacts', '[]'::jsonb)
  ));

  v_hash := coalesce(p_record->>'provenance_hash', encode(extensions.digest(coalesce(p_record::text,''), 'sha256'), 'hex'));

  if jsonb_typeof(p_record->'signal_families') = 'array' then
    select coalesce(array_agg(value), '{}') into v_signals from jsonb_array_elements_text(p_record->'signal_families') as t(value);
  end if;

  v_usefulness := public.evaluate_canonical_payload_usefulness(
    v_kind,
    v_contacts,
    v_legal_basis,
    v_escalation_paths,
    v_source_url,
    coalesce(p_record->>'source_anchor', ''),
    v_verbatim
  );

  insert into public.canonical_extracted_records (
    external_record_id, entity_type, record_kind, record_name, jurisdiction, category, registry_layer,
    signal_families, source_file, source_path, source_anchor, source_url, source_hash, provenance_hash,
    raw_text, verbatim_text, canonical_payload, facts, contacts, relationships, legal_basis, escalation_paths,
    usefulness_status, verification_status
  ) values (
    p_record->>'record_id',
    coalesce(p_record->>'entity_type', v_kind),
    v_kind,
    coalesce(p_record->>'record_name', p_record->>'name', 'unnamed_record'),
    coalesce(p_record->>'jurisdiction', p_record->>'state', p_record->>'jurisdiction_code'),
    p_record->>'category',
    p_record->>'registry_layer',
    v_signals,
    p_record->>'source_file',
    p_record->>'source_path',
    p_record->>'source_anchor',
    v_source_url,
    p_record->>'source_hash',
    v_hash,
    coalesce(p_record->>'raw_text', ''),
    v_verbatim,
    p_record,
    v_facts,
    v_contacts,
    v_relationships,
    v_legal_basis,
    v_escalation_paths,
    v_usefulness,
    'needs_review'
  )
  on conflict (provenance_hash) do update set
    entity_type = excluded.entity_type,
    record_kind = excluded.record_kind,
    record_name = excluded.record_name,
    jurisdiction = excluded.jurisdiction,
    category = excluded.category,
    registry_layer = excluded.registry_layer,
    signal_families = excluded.signal_families,
    source_file = excluded.source_file,
    source_path = excluded.source_path,
    source_anchor = excluded.source_anchor,
    source_url = excluded.source_url,
    source_hash = excluded.source_hash,
    raw_text = excluded.raw_text,
    verbatim_text = excluded.verbatim_text,
    canonical_payload = excluded.canonical_payload,
    facts = excluded.facts,
    contacts = excluded.contacts,
    relationships = excluded.relationships,
    legal_basis = excluded.legal_basis,
    escalation_paths = excluded.escalation_paths,
    usefulness_status = excluded.usefulness_status,
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$function$;
CREATE OR REPLACE FUNCTION public.ingest_extraction_candidate_batch(p_records jsonb)
 RETURNS TABLE(inserted_id uuid, record_name text, candidate_kind text, confidence numeric)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  item jsonb;
  inserted_row public.extraction_candidates%rowtype;
begin
  if jsonb_typeof(p_records) <> 'array' then
    raise exception 'p_records must be a jsonb array';
  end if;

  for item in
    select value
    from jsonb_array_elements(p_records)
  loop
    insert into public.extraction_candidates (
      source_file,
      source_path,
      source_type,
      source_anchor,
      source_hash,
      extraction_run_id,
      extractor_id,
      extractor_version,
      raw_text,
      extracted_payload,
      candidate_kind,
      signal_families,
      layer,
      confidence
    )
    values (
      item->>'source_file',
      item->>'source_path',
      coalesce(item->>'source_type', 'sample_json'),
      item->>'source_anchor',
      item->>'source_hash',
      item->>'extraction_run_id',
      item->>'extractor_id',
      item->>'extractor_version',
      item->>'raw_text',
      coalesce(item->'extracted_payload', '{}'::jsonb),
      item->>'candidate_kind',
      coalesce(
        array(
          select jsonb_array_elements_text(coalesce(item->'signal_families', '[]'::jsonb))
        ),
        '{}'
      ),
      item->>'layer',
      nullif(item->>'confidence', '')::numeric
    )
    returning *
    into inserted_row;

    inserted_id := inserted_row.id;
    record_name := inserted_row.extracted_payload->>'record_name';
    candidate_kind := inserted_row.candidate_kind;
    confidence := inserted_row.confidence;

    return next;
  end loop;
end;
$function$;
CREATE OR REPLACE FUNCTION public.jsonb_array_count(p_value jsonb)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select case when jsonb_typeof(p_value) = 'array' then jsonb_array_length(p_value) else 0 end;
$function$;
CREATE OR REPLACE FUNCTION public.mark_live_data_signal_candidate_bridge_v1(p_candidate_id uuid, p_status text, p_lighthouse_record_id uuid DEFAULT NULL::uuid, p_error_message text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'atlas'
AS $function$
begin
  if p_status not in('bridged','failed') then raise exception 'unsupported bridge status: %',p_status; end if;
  update atlas.live_data_signal_candidate set lighthouse_status=p_status,lighthouse_record_id=case when p_status='bridged' then p_lighthouse_record_id else lighthouse_record_id end,lighthouse_last_error=case when p_status='failed' then left(p_error_message,2000) else null end,lighthouse_bridged_at=case when p_status='bridged' then clock_timestamp() else lighthouse_bridged_at end where candidate_id=p_candidate_id;
  if not found then raise exception 'live-data signal candidate not found: %',p_candidate_id; end if;
end
$function$;
CREATE OR REPLACE FUNCTION public.persist_atlas_event_entity_resolution_batch_v1(p_run_id uuid, p_resolver_id text, p_resolver_version text, p_rule_manifest_hash text, p_entity_index_hash text, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'atlas', 'extensions'
AS $function$
DECLARE
  v_run atlas.signal_event_entity_resolution_run%ROWTYPE;
  v_rule atlas.signal_event_entity_resolution_rule%ROWTYPE;
  v_row jsonb;
  v_event public.signal_events%ROWTYPE;
  v_stream_id text;
  v_event_offset bigint;
  v_rule_id text;
  v_rule_version text;
  v_candidate_key text;
  v_expected_candidate_key text;
  v_entity_role text;
  v_source_field text;
  v_source_field_value text;
  v_source_identifier_field text;
  v_source_identifier_type text;
  v_source_identifier_value text;
  v_actual_source_field_value text;
  v_actual_identifier_field_value text;
  v_expected_source_entity_value text;
  v_expected_normalized_entity_value text;
  v_expected_normalized_identifier_value text;
  v_source_field_allowed boolean;
  v_status text;
  v_entity_id text;
  v_candidate_ids text[];
  v_verified_status text;
  v_verified_match_method text;
  v_verified_entity_id text;
  v_verified_candidate_ids text[];
  v_event_hash text;
  v_expected_hash text;
  v_supplied_hash text;
  v_existing_hash text;
  v_inserted integer := 0;
  v_idempotent integer := 0;
  v_row_count integer := 0;
  v_batch_event_count integer := 0;
  v_resolved integer := 0;
  v_ambiguous integer := 0;
  v_unresolved integer := 0;
  v_ignored integer := 0;
BEGIN
  SELECT * INTO v_run
  FROM atlas.signal_event_entity_resolution_run
  WHERE run_id = p_run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'resolution run not found: %', p_run_id;
  END IF;
  IF v_run.status <> 'running' THEN
    RAISE EXCEPTION 'resolution run % is %, not running', p_run_id, v_run.status;
  END IF;
  IF v_run.resolver_id <> p_resolver_id
     OR v_run.resolver_version <> p_resolver_version
     OR v_run.rule_manifest_hash <> p_rule_manifest_hash
     OR v_run.entity_index_hash <> p_entity_index_hash THEN
    RAISE EXCEPTION 'resolver or input-state contract mismatch for run %', p_run_id;
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be a JSON array';
  END IF;
  IF jsonb_array_length(p_rows) > 10000 THEN
    RAISE EXCEPTION 'p_rows exceeds 10000-row safety bound';
  END IF;

  SELECT count(*) INTO v_batch_event_count
  FROM (
    SELECT DISTINCT value->>'stream_id' AS stream_id, value->>'event_offset' AS event_offset
    FROM jsonb_array_elements(p_rows)
  ) events;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    v_row_count := v_row_count + 1;
    v_stream_id := v_row->>'stream_id';
    v_event_offset := (v_row->>'event_offset')::bigint;
    v_rule_id := v_row->>'rule_id';
    v_rule_version := v_row->>'rule_version';
    v_candidate_key := v_row->>'candidate_key';
    v_entity_role := v_row->>'entity_role';
    v_source_field := v_row->>'source_field';
    v_source_field_value := v_row->>'source_field_value';
    v_source_identifier_field := NULLIF(v_row->>'source_identifier_field', '');
    v_source_identifier_type := NULLIF(v_row->>'source_identifier_type', '');
    v_source_identifier_value := v_row->>'source_identifier_value';
    v_status := v_row->>'resolution_status';
    v_entity_id := NULLIF(v_row->>'entity_id', '');
    v_supplied_hash := v_row->>'resolution_hash';

    IF COALESCE(v_stream_id, '') = ''
       OR COALESCE(v_rule_id, '') = ''
       OR COALESCE(v_rule_version, '') = ''
       OR COALESCE(v_entity_role, '') = ''
       OR COALESCE(v_source_field, '') = '' THEN
      RAISE EXCEPTION 'resolution row is missing event, rule, or source-field identity: %', v_row;
    END IF;
    IF v_candidate_key !~ '^[0-9a-f]{64}$' OR v_supplied_hash !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'candidate key and resolution hash must be lowercase SHA-256 values';
    END IF;
    IF v_row->>'rule_manifest_hash' IS DISTINCT FROM p_rule_manifest_hash
       OR v_row->>'entity_index_hash' IS DISTINCT FROM p_entity_index_hash THEN
      RAISE EXCEPTION 'resolution row input-state hashes do not match run %', p_run_id;
    END IF;
    IF v_row->>'resolver_id' IS DISTINCT FROM p_resolver_id
       OR v_row->>'resolver_version' IS DISTINCT FROM p_resolver_version THEN
      RAISE EXCEPTION 'resolution row resolver identity does not match run %', p_run_id;
    END IF;
    IF v_status NOT IN ('resolved', 'ambiguous', 'unresolved', 'ignored') THEN
      RAISE EXCEPTION 'invalid resolution status: %', v_status;
    END IF;
    IF COALESCE(v_row->>'match_method', '') = '' THEN
      RAISE EXCEPTION 'match_method is required';
    END IF;
    IF v_status = 'resolved' AND v_entity_id IS NULL THEN
      RAISE EXCEPTION 'resolved row must contain entity_id for %:%', v_stream_id, v_event_offset;
    END IF;
    IF v_status <> 'resolved' AND v_entity_id IS NOT NULL THEN
      RAISE EXCEPTION 'non-resolved row cannot contain entity_id for %:%', v_stream_id, v_event_offset;
    END IF;

    SELECT * INTO v_event
    FROM public.signal_events
    WHERE stream_id = v_stream_id AND "offset" = v_event_offset;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'signal event not found: %:%', v_stream_id, v_event_offset;
    END IF;

    SELECT * INTO v_rule
    FROM atlas.signal_event_entity_resolution_rule
    WHERE rule_id = v_rule_id
      AND rule_version = v_rule_version
      AND is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'active event-entity rule not found: % version %', v_rule_id, v_rule_version;
    END IF;
    IF v_rule.rule_manifest_hash <> p_rule_manifest_hash THEN
      RAISE EXCEPTION 'rule % version % is not part of run manifest %',
        v_rule_id, v_rule_version, p_rule_manifest_hash;
    END IF;
    IF v_rule.stream_id <> '*' AND v_rule.stream_id <> v_event.stream_id THEN
      RAISE EXCEPTION 'rule % does not apply to stream %', v_rule_id, v_event.stream_id;
    END IF;
    IF NOT ('*' = ANY(v_rule.signal_types) OR v_event.signal_type = ANY(v_rule.signal_types)) THEN
      RAISE EXCEPTION 'rule % does not apply to signal type %', v_rule_id, v_event.signal_type;
    END IF;
    IF v_entity_role IS DISTINCT FROM v_rule.entity_role THEN
      RAISE EXCEPTION 'entity role % does not match locked rule role % for %',
        v_entity_role, v_rule.entity_role, v_rule_id;
    END IF;
    IF NULLIF(v_row->>'expected_entity_type', '') IS DISTINCT FROM v_rule.expected_entity_type THEN
      RAISE EXCEPTION 'expected entity type does not match locked rule %', v_rule_id;
    END IF;

    v_source_field_allowed := (
      v_source_field = ANY(v_rule.name_fields)
      OR (
        'payload.sponsors[*]' = ANY(v_rule.name_fields)
        AND v_source_field ~ '^payload\.sponsors\[[0-9]+\](\.(name|full_name|sponsor_name))?$'
      )
      OR (
        v_source_field = '__none__'
        AND v_rule.transform IN ('exact_canonical_entity_id', 'explicit_ignored_outcome')
      )
    );
    IF v_source_field_allowed IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'source field % is not allowed by rule %', v_source_field, v_rule_id;
    END IF;
    IF v_source_field <> '__none__' AND v_source_field_value IS NULL THEN
      RAISE EXCEPTION 'declared source field % has no preserved source value for %:%',
        v_source_field, v_stream_id, v_event_offset;
    END IF;
    IF v_source_field = '__none__' AND v_source_field_value IS NOT NULL THEN
      RAISE EXCEPTION '__none__ source field cannot carry a source value for %:%',
        v_stream_id, v_event_offset;
    END IF;

    IF v_source_identifier_field IS NOT NULL
       AND NOT (v_source_identifier_field = ANY(v_rule.identifier_fields)) THEN
      RAISE EXCEPTION 'identifier field % is not allowed by rule %',
        v_source_identifier_field, v_rule_id;
    END IF;
    IF v_source_identifier_type IS NOT NULL
       AND NOT (v_source_identifier_type = ANY(v_rule.exact_identifier_types)) THEN
      RAISE EXCEPTION 'identifier type % is not allowed by rule %',
        v_source_identifier_type, v_rule_id;
    END IF;
    IF v_source_identifier_field IS NULL AND v_source_identifier_value IS NOT NULL THEN
      RAISE EXCEPTION 'identifier value cannot exist without an identifier source field for %:%',
        v_stream_id, v_event_offset;
    END IF;
    IF v_source_identifier_field IS NOT NULL AND v_source_identifier_type IS NULL THEN
      RAISE EXCEPTION 'identifier source field requires an identifier type for %:%',
        v_stream_id, v_event_offset;
    END IF;
    IF v_source_identifier_field IS NOT NULL AND v_source_identifier_value IS NULL THEN
      RAISE EXCEPTION 'identifier source field requires its exact preserved source value for %:%',
        v_stream_id, v_event_offset;
    END IF;
    IF lower(v_row->>'match_method') LIKE '%fuzzy%' THEN
      RAISE EXCEPTION 'fuzzy match methods are forbidden';
    END IF;
    IF v_rule.transform = 'explicit_ignored_outcome' AND v_status <> 'ignored' THEN
      RAISE EXCEPTION 'no-entity rule must produce ignored outcome';
    END IF;
    IF v_rule.transform <> 'explicit_ignored_outcome' AND v_status = 'ignored' THEN
      RAISE EXCEPTION 'only the no-entity rule may produce ignored outcome';
    END IF;

    v_event_hash := public.atlas_signal_event_input_hash_v1(
      v_event.stream_id,
      v_event."offset",
      v_event."timestamp",
      v_event.signal_type,
      v_event.spacetime,
      v_event.provenance,
      v_event.payload,
      v_event.source_id,
      v_event.jurisdiction_id,
      v_event.module_hint,
      v_event.ingested_at
    );

    IF v_event_hash <> v_row->>'event_input_hash' THEN
      RAISE EXCEPTION 'event input hash mismatch for %:%', v_stream_id, v_event_offset;
    END IF;

    v_actual_source_field_value := public.atlas_event_payload_field_text_v1(
      v_event.payload,
      v_source_field
    );
    IF v_actual_source_field_value IS DISTINCT FROM v_source_field_value THEN
      RAISE EXCEPTION 'source field provenance mismatch for %:% field %',
        v_stream_id, v_event_offset, v_source_field;
    END IF;

    v_expected_source_entity_value := public.atlas_event_entity_source_value_v1(
      v_rule_id,
      v_source_field,
      v_actual_source_field_value
    );
    IF v_expected_source_entity_value IS DISTINCT FROM NULLIF(v_row->>'source_entity_value', '') THEN
      RAISE EXCEPTION 'source entity extraction mismatch for %:% rule % field %',
        v_stream_id, v_event_offset, v_rule_id, v_source_field;
    END IF;

    v_expected_normalized_entity_value := public.atlas_normalize_entity_name_v1(
      v_expected_source_entity_value
    );
    IF v_expected_normalized_entity_value IS DISTINCT FROM NULLIF(v_row->>'normalized_entity_value', '') THEN
      RAISE EXCEPTION 'normalized entity value mismatch for %:% rule %',
        v_stream_id, v_event_offset, v_rule_id;
    END IF;

    IF v_source_identifier_field IS NOT NULL THEN
      v_actual_identifier_field_value := public.atlas_event_payload_field_text_v1(
        v_event.payload,
        v_source_identifier_field
      );
      IF v_actual_identifier_field_value IS DISTINCT FROM v_source_identifier_value THEN
        RAISE EXCEPTION 'identifier field provenance mismatch for %:% field %',
          v_stream_id, v_event_offset, v_source_identifier_field;
      END IF;
    ELSE
      v_actual_identifier_field_value := NULL;
    END IF;

    v_expected_normalized_identifier_value := public.atlas_normalize_entity_identifier_v1(
      v_source_identifier_type,
      v_actual_identifier_field_value
    );
    IF v_expected_normalized_identifier_value IS DISTINCT FROM NULLIF(v_row->>'normalized_identifier_value', '') THEN
      RAISE EXCEPTION 'normalized identifier value mismatch for %:% rule %',
        v_stream_id, v_event_offset, v_rule_id;
    END IF;

    v_expected_candidate_key := public.atlas_event_entity_candidate_key_v1(
      v_rule_id,
      v_rule_version,
      v_entity_role,
      v_source_field,
      NULLIF(v_row->>'normalized_entity_value', ''),
      NULLIF(v_row->>'source_identifier_field', ''),
      NULLIF(v_row->>'source_identifier_type', ''),
      NULLIF(v_row->>'normalized_identifier_value', ''),
      NULLIF(v_row->>'expected_entity_type', '')
    );

    IF v_expected_candidate_key <> v_candidate_key THEN
      RAISE EXCEPTION 'candidate key mismatch for %:% %/%',
        v_stream_id, v_event_offset, v_entity_role, v_source_field;
    END IF;

    SELECT COALESCE(array_agg(DISTINCT candidate_id ORDER BY candidate_id), ARRAY[]::text[])
    INTO v_candidate_ids
    FROM jsonb_array_elements_text(COALESCE(v_row->'candidate_entity_ids', '[]'::jsonb)) AS candidate(candidate_id);

    IF v_status = 'ambiguous' AND cardinality(v_candidate_ids) < 2 THEN
      RAISE EXCEPTION 'ambiguous row requires at least two candidates for %:%', v_stream_id, v_event_offset;
    END IF;
    IF v_status = 'resolved' AND NOT (v_entity_id = ANY(v_candidate_ids)) THEN
      RAISE EXCEPTION 'resolved entity must be included in candidate set for %:%', v_stream_id, v_event_offset;
    END IF;

    IF v_entity_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM atlas.entity_registry
      WHERE entity_id = v_entity_id
        AND is_active IS DISTINCT FROM false
    ) THEN
      RAISE EXCEPTION 'resolved entity does not exist or is inactive: %', v_entity_id;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM unnest(v_candidate_ids) AS candidate(candidate_id)
      WHERE NOT EXISTS (
        SELECT 1
        FROM atlas.entity_registry er
        WHERE er.entity_id = candidate_id
          AND er.is_active IS DISTINCT FROM false
      )
    ) THEN
      RAISE EXCEPTION 'candidate entity set contains an unknown or inactive entity for %:%',
        v_stream_id, v_event_offset;
    END IF;

    IF v_rule.transform = 'explicit_ignored_outcome' THEN
      v_verified_status := 'ignored';
      v_verified_match_method := 'no_declared_entity_rule';
      v_verified_entity_id := NULL;
      v_verified_candidate_ids := ARRAY[]::text[];
    ELSE
      SELECT
        expected_resolution_status,
        expected_match_method,
        expected_entity_id,
        expected_candidate_entity_ids
      INTO
        v_verified_status,
        v_verified_match_method,
        v_verified_entity_id,
        v_verified_candidate_ids
      FROM atlas.resolve_signal_event_entity_candidate_exact_v1(
        NULLIF(v_row->>'normalized_entity_value', ''),
        NULLIF(v_row->>'source_identifier_type', ''),
        NULLIF(v_row->>'normalized_identifier_value', ''),
        NULLIF(v_row->>'expected_entity_type', '')
      );
    END IF;

    IF v_verified_status IS DISTINCT FROM v_status
       OR v_verified_match_method IS DISTINCT FROM v_row->>'match_method'
       OR v_verified_entity_id IS DISTINCT FROM v_entity_id
       OR v_verified_candidate_ids IS DISTINCT FROM v_candidate_ids THEN
      RAISE EXCEPTION 'SQL exact-match recomputation mismatch for %:% rule %: supplied status/method/entity/candidates %/%/%/% expected %/%/%/%',
        v_stream_id,
        v_event_offset,
        v_rule_id,
        v_status,
        v_row->>'match_method',
        v_entity_id,
        v_candidate_ids,
        v_verified_status,
        v_verified_match_method,
        v_verified_entity_id,
        v_verified_candidate_ids;
    END IF;

    v_expected_hash := public.atlas_event_entity_resolution_hash_v1(
      v_event_hash,
      p_entity_index_hash,
      p_rule_manifest_hash,
      v_rule_id,
      v_rule_version,
      v_candidate_key,
      v_entity_role,
      v_source_field,
      NULLIF(v_row->>'normalized_entity_value', ''),
      NULLIF(v_row->>'source_identifier_field', ''),
      NULLIF(v_row->>'source_identifier_type', ''),
      NULLIF(v_row->>'normalized_identifier_value', ''),
      NULLIF(v_row->>'expected_entity_type', ''),
      v_status,
      v_entity_id,
      v_row->>'match_method',
      v_candidate_ids,
      p_resolver_id,
      p_resolver_version
    );

    IF v_expected_hash <> v_supplied_hash THEN
      RAISE EXCEPTION 'resolution hash mismatch for %:% %/%',
        v_stream_id, v_event_offset, v_entity_role, v_source_field;
    END IF;

    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        concat_ws(
          chr(31),
          v_stream_id,
          v_event_offset::text,
          v_candidate_key,
          p_resolver_id,
          p_resolver_version,
          p_entity_index_hash
        ),
        0
      )
    );

    SELECT resolution_hash INTO v_existing_hash
    FROM atlas.signal_event_entity_resolution
    WHERE stream_id = v_stream_id
      AND event_offset = v_event_offset
      AND candidate_key = v_candidate_key
      AND resolver_id = p_resolver_id
      AND resolver_version = p_resolver_version
      AND entity_index_hash = p_entity_index_hash;

    IF FOUND THEN
      IF v_existing_hash <> v_expected_hash THEN
        RAISE EXCEPTION 'deterministic replay violation for %:% candidate % resolver % % input %',
          v_stream_id,
          v_event_offset,
          v_candidate_key,
          p_resolver_id,
          p_resolver_version,
          p_entity_index_hash;
      END IF;

      UPDATE atlas.signal_event_entity_resolution
      SET last_run_id = p_run_id,
          last_replayed_at = now()
      WHERE stream_id = v_stream_id
        AND event_offset = v_event_offset
        AND candidate_key = v_candidate_key
        AND resolver_id = p_resolver_id
        AND resolver_version = p_resolver_version
        AND entity_index_hash = p_entity_index_hash;

      v_idempotent := v_idempotent + 1;
    ELSE
      UPDATE atlas.signal_event_entity_resolution
      SET is_current = false
      WHERE stream_id = v_stream_id
        AND event_offset = v_event_offset
        AND candidate_key = v_candidate_key
        AND resolver_id = p_resolver_id
        AND is_current = true;

      INSERT INTO atlas.signal_event_entity_resolution (
        stream_id,
        event_offset,
        event_timestamp,
        signal_type,
        source_id,
        jurisdiction_id,
        module_hint,
        rule_id,
        rule_version,
        candidate_key,
        entity_role,
        source_field,
        source_field_value,
        source_entity_value,
        normalized_entity_value,
        source_identifier_field,
        source_identifier_type,
        source_identifier_value,
        normalized_identifier_value,
        expected_entity_type,
        entity_id,
        resolution_status,
        match_method,
        candidate_entity_ids,
        match_evidence,
        event_input_hash,
        entity_index_hash,
        rule_manifest_hash,
        resolution_hash,
        resolver_id,
        resolver_version,
        first_run_id,
        last_run_id,
        is_current
      ) VALUES (
        v_stream_id,
        v_event_offset,
        v_event."timestamp",
        v_event.signal_type,
        v_event.source_id,
        v_event.jurisdiction_id,
        v_event.module_hint,
        v_rule_id,
        v_rule_version,
        v_candidate_key,
        v_entity_role,
        v_source_field,
        v_source_field_value,
        NULLIF(v_row->>'source_entity_value', ''),
        NULLIF(v_row->>'normalized_entity_value', ''),
        NULLIF(v_row->>'source_identifier_field', ''),
        NULLIF(v_row->>'source_identifier_type', ''),
        NULLIF(v_row->>'source_identifier_value', ''),
        NULLIF(v_row->>'normalized_identifier_value', ''),
        NULLIF(v_row->>'expected_entity_type', ''),
        v_entity_id,
        v_status,
        v_row->>'match_method',
        v_candidate_ids::varchar(128)[],
        COALESCE(v_row->'match_evidence', '{}'::jsonb),
        v_event_hash,
        p_entity_index_hash,
        p_rule_manifest_hash,
        v_expected_hash,
        p_resolver_id,
        p_resolver_version,
        p_run_id,
        p_run_id,
        true
      );

      v_inserted := v_inserted + 1;
    END IF;

    CASE v_status
      WHEN 'resolved' THEN v_resolved := v_resolved + 1;
      WHEN 'ambiguous' THEN v_ambiguous := v_ambiguous + 1;
      WHEN 'unresolved' THEN v_unresolved := v_unresolved + 1;
      WHEN 'ignored' THEN v_ignored := v_ignored + 1;
    END CASE;
  END LOOP;

  UPDATE atlas.signal_event_entity_resolution_run
  SET processed_event_count = processed_event_count + v_batch_event_count,
      resolution_row_count = resolution_row_count + v_row_count,
      resolved_count = resolved_count + v_resolved,
      ambiguous_count = ambiguous_count + v_ambiguous,
      unresolved_count = unresolved_count + v_unresolved,
      ignored_count = ignored_count + v_ignored,
      inserted_count = inserted_count + v_inserted,
      idempotent_count = idempotent_count + v_idempotent
  WHERE run_id = p_run_id;

  RETURN jsonb_build_object(
    'run_id', p_run_id,
    'batch_event_count', v_batch_event_count,
    'resolution_row_count', v_row_count,
    'resolved_count', v_resolved,
    'ambiguous_count', v_ambiguous,
    'unresolved_count', v_unresolved,
    'ignored_count', v_ignored,
    'inserted_count', v_inserted,
    'idempotent_count', v_idempotent
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.persist_domain3_population_run_v1(p_rule jsonb, p_run_id uuid, p_observations_scanned bigint, p_candidates jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'atlas', 'pg_temp'
AS $function$ declare v_candidate jsonb; v_produced integer := 0; v_replayed integer := 0; v_inserted integer := 0; v_entities integer := 0; v_rule_id text; v_rule_version text; v_rule_hash text; begin if p_run_id is null then raise exception 'domain3_run_id_required'; end if; if jsonb_typeof(p_rule) <> 'object' then raise exception 'domain3_rule_must_be_object'; end if; if jsonb_typeof(p_candidates) <> 'array' then raise exception 'domain3_candidates_must_be_array'; end if; v_rule_id:=p_rule->>'rule_id'; v_rule_version:=p_rule->>'rule_version'; v_rule_hash:=p_rule->>'rule_contract_hash'; if coalesce(v_rule_id,'')='' or coalesce(v_rule_version,'')='' or coalesce(v_rule_hash,'') !~ '^[0-9a-f]{64}$' then raise exception 'invalid_domain3_run_rule_identity'; end if; insert into atlas.live_data_signal_rule (rule_id,rule_version,signal_type,engine_id,engine_version,rule_contract,rule_contract_hash,is_active) values (v_rule_id,v_rule_version,p_rule->>'signal_type',p_rule->>'engine_id',p_rule->>'engine_version',p_rule->'rule_contract',v_rule_hash,coalesce((p_rule->>'is_active')::boolean,true)) on conflict (rule_id,rule_version) do update set signal_type=excluded.signal_type,engine_id=excluded.engine_id,engine_version=excluded.engine_version,rule_contract=excluded.rule_contract,rule_contract_hash=excluded.rule_contract_hash,is_active=excluded.is_active; v_produced:=jsonb_array_length(p_candidates); select count(*)::integer into v_replayed from jsonb_array_elements(p_candidates) c join atlas.live_data_signal_candidate existing on existing.candidate_hash=c->>'candidate_hash'; v_inserted:=v_produced-v_replayed; select count(*)::integer into v_entities from jsonb_array_elements(p_candidates) c where coalesce(c->'supporting_statistics'->>'entity_name','')<>''; insert into atlas.live_data_signal_run (run_id,rule_id,rule_version,rule_contract_hash,status,canonical_events_scanned,entities_evaluated,candidates_produced,started_at,completed_at) values (p_run_id,v_rule_id,v_rule_version,v_rule_hash,'completed',greatest(coalesce(p_observations_scanned,0),0),v_entities,v_produced,now(),now()) on conflict (run_id) do nothing; for v_candidate in select value from jsonb_array_elements(p_candidates) loop if coalesce(v_candidate->>'candidate_hash','') !~ '^[0-9a-f]{64}$' or coalesce(v_candidate->>'source_input_hash','') !~ '^[0-9a-f]{64}$' or jsonb_typeof(v_candidate->'source_event_refs') <> 'array' or jsonb_array_length(v_candidate->'source_event_refs')=0 or jsonb_typeof(v_candidate->'supporting_statistics') <> 'object' or v_candidate->'supporting_statistics'='{}'::jsonb then raise exception 'invalid_domain3_candidate_contract'; end if; insert into atlas.live_data_signal_candidate (candidate_hash,rule_id,rule_version,rule_contract_hash,engine_id,engine_version,signal_type,title,description,primary_stream_id,source_event_refs,entity_ids,entity_resolution_status,jurisdiction_id,severity,confidence_score,verification_state,supporting_statistics,evidence_refs,source_freshness_at,detected_at,source_input_hash,first_run_id,last_run_id) values (v_candidate->>'candidate_hash',v_rule_id,v_rule_version,v_rule_hash,p_rule->>'engine_id',p_rule->>'engine_version',v_candidate->>'signal_type',v_candidate->>'title',v_candidate->>'description',v_candidate->>'primary_stream_id',v_candidate->'source_event_refs',array(select jsonb_array_elements_text(coalesce(v_candidate->'entity_ids','[]'::jsonb))),v_candidate->>'entity_resolution_status',v_candidate->>'jurisdiction_id',v_candidate->>'severity',(v_candidate->>'confidence_score')::numeric,v_candidate->>'verification_state',v_candidate->'supporting_statistics',coalesce(v_candidate->'evidence_refs','[]'::jsonb),(v_candidate->>'source_freshness_at')::timestamptz,(v_candidate->>'detected_at')::timestamptz,v_candidate->>'source_input_hash',p_run_id,p_run_id) on conflict (candidate_hash) do update set last_run_id=excluded.last_run_id,last_replayed_at=now(),source_event_refs=excluded.source_event_refs,supporting_statistics=excluded.supporting_statistics,evidence_refs=excluded.evidence_refs,source_freshness_at=excluded.source_freshness_at,detected_at=excluded.detected_at; end loop; return jsonb_build_object('status','completed','run_id',p_run_id,'rule_id',v_rule_id,'observations_scanned',greatest(coalesce(p_observations_scanned,0),0),'candidates_produced',v_produced,'candidates_inserted',v_inserted,'candidates_replayed',v_replayed); end; $function$;
CREATE OR REPLACE FUNCTION public.persist_signal_event_batch_v2(p_events jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'atlas', 'extensions'
AS $function$
declare
  v_run_id uuid := gen_random_uuid();
  v_event jsonb;
  v_stream_id text;
  v_identity_hash text;
  v_source_record_key text;
  v_existing_offset bigint;
  v_next_offset bigint;
  v_inserted integer := 0;
  v_replayed integer := 0;
  v_seen integer := 0;
  v_failed integer := 0;
  v_cursor_before bigint;
  v_cursor_after bigint;
  v_stream_count integer;
  v_receipts jsonb := '[]'::jsonb;
  v_error text := null;
  v_status text;
begin
  if jsonb_typeof(p_events) <> 'array' then raise exception 'p_events must be a JSON array'; end if;
  select count(distinct value->>'stream_id') into v_stream_count from jsonb_array_elements(p_events);
  if v_stream_count > 1 then raise exception 'one ingest batch may contain only one stream_id'; end if;
  select nullif(value->>'stream_id', '') into v_stream_id from jsonb_array_elements(p_events) limit 1;
  select max("offset") into v_cursor_before from public.signal_events where stream_id = v_stream_id;
  insert into atlas.signal_event_ingest_run(run_id,stream_id,status,records_seen,cursor_before) values(v_run_id,v_stream_id,'running',jsonb_array_length(p_events),v_cursor_before);
  perform pg_advisory_xact_lock(hashtextextended(coalesce(v_stream_id, ''), 0));
  for v_event in select value from jsonb_array_elements(p_events) loop
    v_seen := v_seen + 1;
    v_existing_offset := null;
    begin
      if coalesce(v_event->>'stream_id','')='' or coalesce(v_event->>'timestamp','')='' or coalesce(v_event->>'signal_type','')='' or coalesce(v_event->>'source_id','')='' or coalesce(v_event->>'jurisdiction_id','')='' or coalesce(v_event->>'module_hint','')='' then raise exception 'event % is missing canonical identity fields',v_seen; end if;
      if jsonb_typeof(v_event->'spacetime')<>'object' or jsonb_typeof(v_event->'provenance')<>'object' or jsonb_typeof(v_event->'payload')<>'object' then raise exception 'event % has invalid spacetime, provenance, or payload',v_seen; end if;
      v_identity_hash:=atlas.signal_event_identity_hash_v1(v_event->>'stream_id',(v_event->>'timestamp')::timestamptz,v_event->>'signal_type',v_event->'spacetime',v_event->'provenance',v_event->'payload',v_event->>'source_id',v_event->>'jurisdiction_id',v_event->>'module_hint');
      v_source_record_key:=atlas.signal_event_source_record_key_v1(v_event->'payload',v_event->'provenance');
      select canonical_offset into v_existing_offset from atlas.signal_event_identity where stream_id=v_event->>'stream_id' and event_identity_hash=v_identity_hash;
      if v_existing_offset is not null then
        update atlas.signal_event_identity set replay_count=replay_count+1,last_seen_at=clock_timestamp(),updated_at=clock_timestamp() where stream_id=v_event->>'stream_id' and event_identity_hash=v_identity_hash;
        v_replayed:=v_replayed+1;
        if jsonb_array_length(v_receipts)<50 then v_receipts:=v_receipts||jsonb_build_array(jsonb_build_object('event_identity_hash',v_identity_hash,'canonical_offset',v_existing_offset,'inserted',false,'replay_suppressed',true)); end if;
      else
        select coalesce(max("offset")+1,0) into v_next_offset from public.signal_events where stream_id=v_event->>'stream_id';
        insert into public.signal_events(stream_id,"offset",timestamp,signal_type,spacetime,provenance,payload,source_id,jurisdiction_id,module_hint,ingested_at,event_identity_hash)
        values(v_event->>'stream_id',v_next_offset,(v_event->>'timestamp')::timestamptz,v_event->>'signal_type',v_event->'spacetime',v_event->'provenance',v_event->'payload',v_event->>'source_id',v_event->>'jurisdiction_id',v_event->>'module_hint',clock_timestamp(),v_identity_hash);
        insert into atlas.signal_event_identity(stream_id,event_identity_hash,canonical_offset,latest_historical_offset,historical_event_count,replay_count,source_record_key,first_seen_at,last_seen_at,source_timestamp,signal_type,source_id,jurisdiction_id,module_hint)
        values(v_event->>'stream_id',v_identity_hash,v_next_offset,v_next_offset,1,0,v_source_record_key,clock_timestamp(),clock_timestamp(),(v_event->>'timestamp')::timestamptz,v_event->>'signal_type',v_event->>'source_id',v_event->>'jurisdiction_id',v_event->>'module_hint');
        v_inserted:=v_inserted+1;
        if jsonb_array_length(v_receipts)<50 then v_receipts:=v_receipts||jsonb_build_array(jsonb_build_object('event_identity_hash',v_identity_hash,'canonical_offset',v_next_offset,'inserted',true,'replay_suppressed',false)); end if;
      end if;
    exception when others then
      get stacked diagnostics v_error=message_text;
      v_failed:=v_failed+1;
      if jsonb_array_length(v_receipts)<50 then v_receipts:=v_receipts||jsonb_build_array(jsonb_build_object('event_index',v_seen,'inserted',false,'replay_suppressed',false,'error',left(v_error,1000))); end if;
      exit;
    end;
  end loop;
  select max("offset") into v_cursor_after from public.signal_events where stream_id=v_stream_id;
  v_status:=case when v_failed=0 then 'completed' when v_inserted>0 or v_replayed>0 then 'partial' else 'failed' end;
  update atlas.signal_event_ingest_run set status=v_status,records_seen=v_seen,events_inserted=v_inserted,replays_suppressed=v_replayed,cursor_after=v_cursor_after,partial_completion=v_status='partial',error_message=case when v_failed>0 then left(v_error,2000) else null end,completed_at=clock_timestamp() where run_id=v_run_id;
  return jsonb_build_object('run_id',v_run_id,'stream_id',v_stream_id,'status',v_status,'records_seen',v_seen,'events_inserted',v_inserted,'replays_suppressed',v_replayed,'records_failed',v_failed,'cursor_before',v_cursor_before,'cursor_after',v_cursor_after,'partial_completion',v_status='partial','error_message',case when v_failed>0 then v_error else null end,'receipts',v_receipts);
end
$function$;
CREATE OR REPLACE FUNCTION public.promote_verified_chronicle()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_signal_families text[];
  v_source_count integer;
  v_chronicle_hash text;
begin
  if new.verification_status = 'verified'
     and new.verification_score >= 0.75
     and new.conflict_status in ('none', 'resolved')
  then
    select coalesce(ec.signal_families, '{}') into v_signal_families
    from public.extraction_candidates ec
    where ec.id = new.candidate_id;

    select count(*) into v_source_count
    from public.verification_evidence ve
    where ve.claim_id = new.id and ve.supports_claim = true;

    v_chronicle_hash := encode(extensions.digest(coalesce(new.claim_hash, '') || ':' || coalesce(new.verification_status, '') || ':' || coalesce(new.verification_score::text, '') || ':' || coalesce(new.conflict_status, ''), 'sha256'), 'hex');

    insert into public.verified_chronicle (
      claim_id, chronicle_hash, chronicle_kind, title, body, jurisdiction,
      entity_name, entity_type, signal_families, source_count, verification_score,
      valid_from, valid_until, provenance, immutable_payload
    ) values (
      new.id, v_chronicle_hash, new.claim_type, coalesce(new.subject, 'Verified claim'),
      coalesce(new.object_value, ''), new.jurisdiction, new.subject, new.claim_type,
      coalesce(v_signal_families, '{}'), coalesce(v_source_count, 0), new.verification_score,
      new.effective_date, new.expiration_date,
      jsonb_build_object('candidate_id', new.candidate_id, 'claim_hash', new.claim_hash, 'verification_status', new.verification_status, 'conflict_status', new.conflict_status, 'promoted_by', 'promote_verified_chronicle_v1'),
      new.normalized_payload
    ) on conflict (chronicle_hash) do nothing;
  end if;
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.reconcile_domain3_population_currentness_v1(p_rule_id text, p_rule_version text, p_run_id uuid, p_current_candidate_hashes jsonb, p_replay_complete boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'atlas', 'extensions', 'pg_temp'
AS $function$
declare
  v_run atlas.live_data_signal_run%rowtype;
  v_newer_run_id uuid;
  v_candidate record;
  v_hash text;
  v_retired_at timestamptz := clock_timestamp();
  v_retirement_hash text;
  v_count integer := 0;
  v_receipts jsonb := '[]'::jsonb;
begin
  if coalesce(p_rule_id,'')='' or coalesce(p_rule_version,'')='' or p_run_id is null then
    raise exception 'domain3_currentness_reconciliation_identity_required';
  end if;
  if jsonb_typeof(p_current_candidate_hashes) <> 'array' then
    raise exception 'domain3_current_candidate_hashes_must_be_array';
  end if;

  select * into v_run
  from atlas.live_data_signal_run
  where run_id=p_run_id
    and rule_id=p_rule_id
    and rule_version=p_rule_version
    and status='completed';
  if not found then
    raise exception 'domain3_currentness_reconciliation_requires_completed_run';
  end if;

  if coalesce(p_replay_complete,false) is not true then
    return jsonb_build_object(
      'status','skipped',
      'reason','replay_not_complete_or_truncated',
      'run_id',p_run_id,
      'rule_id',p_rule_id,
      'retired',0,
      'retirements','[]'::jsonb
    );
  end if;

  select run_id into v_newer_run_id
  from atlas.live_data_signal_run
  where rule_id=p_rule_id
    and rule_version=p_rule_version
    and status='completed'
    and (started_at,run_id) > (v_run.started_at,v_run.run_id)
  order by started_at desc,run_id desc
  limit 1;
  if v_newer_run_id is not null then
    return jsonb_build_object(
      'status','skipped',
      'reason','run_superseded_by_newer_completed_replay',
      'run_id',p_run_id,
      'newer_run_id',v_newer_run_id,
      'rule_id',p_rule_id,
      'retired',0,
      'retirements','[]'::jsonb
    );
  end if;

  for v_hash in select value from jsonb_array_elements_text(p_current_candidate_hashes)
  loop
    if v_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'domain3_current_candidate_hash_invalid';
    end if;
    perform 1 from atlas.live_data_signal_candidate
    where candidate_hash=v_hash
      and rule_id=p_rule_id
      and rule_version=p_rule_version
      and last_run_id=p_run_id;
    if not found then
      raise exception 'domain3_current_candidate_hash_not_bound_to_run';
    end if;
  end loop;

  perform pg_advisory_xact_lock(hashtextextended(p_rule_id || chr(31) || p_rule_version,0));

  for v_candidate in
    select c.*
    from atlas.live_data_signal_candidate c
    where c.rule_id=p_rule_id
      and c.rule_version=p_rule_version
      and c.is_current is true
      and not exists (
        select 1
        from jsonb_array_elements_text(p_current_candidate_hashes) h
        where h.value=c.candidate_hash
      )
    order by c.semantic_key,c.candidate_id
    for update
  loop
    update atlas.live_data_signal_candidate
       set is_current=false,
           retired_at=v_retired_at
     where candidate_id=v_candidate.candidate_id
       and is_current=true;

    v_retirement_hash := encode(
      extensions.digest(
        convert_to(
          concat_ws(chr(31),
            'atlas_domain3_negative_currentness_v1',
            p_run_id::text,
            v_candidate.candidate_id::text,
            v_candidate.candidate_hash,
            v_candidate.semantic_key,
            'not_observed_in_complete_replay'
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );

    insert into atlas.live_data_signal_candidate_retirement_v1(
      run_id,candidate_id,rule_id,rule_version,candidate_hash,semantic_key,
      lighthouse_record_id,retirement_reason,retirement_hash,retired_at,lighthouse_status
    ) values (
      p_run_id,v_candidate.candidate_id,p_rule_id,p_rule_version,
      v_candidate.candidate_hash,v_candidate.semantic_key,v_candidate.lighthouse_record_id,
      'not_observed_in_complete_replay',v_retirement_hash,v_retired_at,
      case when v_candidate.lighthouse_record_id is null then 'not_required' else 'pending' end
    )
    on conflict (run_id,candidate_id) do nothing;

    v_count := v_count + 1;
    v_receipts := v_receipts || jsonb_build_array(jsonb_build_object(
      'candidate_id',v_candidate.candidate_id,
      'candidate_hash',v_candidate.candidate_hash,
      'semantic_key',v_candidate.semantic_key,
      'lighthouse_record_id',v_candidate.lighthouse_record_id,
      'retirement_hash',v_retirement_hash,
      'retired_at',v_retired_at,
      'lighthouse_status',case when v_candidate.lighthouse_record_id is null then 'not_required' else 'pending' end
    ));
  end loop;

  return jsonb_build_object(
    'status','completed',
    'run_id',p_run_id,
    'rule_id',p_rule_id,
    'rule_version',p_rule_version,
    'replay_complete',true,
    'retired',v_count,
    'retirements',v_receipts
  );
end
$function$;
CREATE OR REPLACE FUNCTION public.register_domain3_population_rules_v1(p_rules jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'atlas', 'pg_temp'
AS $function$ declare v_rule jsonb; v_count integer := 0; begin if jsonb_typeof(p_rules) <> 'array' then raise exception 'domain3_rules_must_be_array'; end if; for v_rule in select value from jsonb_array_elements(p_rules) loop if coalesce(v_rule->>'rule_id','') = '' or coalesce(v_rule->>'rule_version','') = '' or coalesce(v_rule->>'signal_type','') = '' or coalesce(v_rule->>'engine_id','') = '' or coalesce(v_rule->>'engine_version','') = '' or coalesce(v_rule->>'rule_contract_hash','') !~ '^[0-9a-f]{64}$' or jsonb_typeof(v_rule->'rule_contract') <> 'object' then raise exception 'invalid_domain3_rule_contract'; end if; insert into atlas.live_data_signal_rule (rule_id,rule_version,signal_type,engine_id,engine_version,rule_contract,rule_contract_hash,is_active) values (v_rule->>'rule_id',v_rule->>'rule_version',v_rule->>'signal_type',v_rule->>'engine_id',v_rule->>'engine_version',v_rule->'rule_contract',v_rule->>'rule_contract_hash',coalesce((v_rule->>'is_active')::boolean,true)) on conflict (rule_id,rule_version) do update set signal_type=excluded.signal_type,engine_id=excluded.engine_id,engine_version=excluded.engine_version,rule_contract=excluded.rule_contract,rule_contract_hash=excluded.rule_contract_hash,is_active=excluded.is_active; v_count:=v_count+1; end loop; return jsonb_build_object('status','completed','rules_registered',v_count); end; $function$;
CREATE OR REPLACE FUNCTION public.search_atlas_pins(search_query text)
 RETURNS TABLE(id text, name text, address text, city text, pin_type text, latitude numeric, longitude numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'atlas'
AS $function$
  SELECT pantry_id, pantry_name, address_raw, city, 'food_bank'::text, latitude, longitude
  FROM atlas.food_banks
  WHERE (pantry_name ILIKE '%' || search_query || '%' OR city ILIKE '%' || search_query || '%')
    AND latitude IS NOT NULL AND longitude IS NOT NULL

  UNION ALL

  SELECT office_id, COALESCE(office_name, program_type), address_raw, city, 'benefits'::text, latitude, longitude
  FROM atlas.benefits_offices
  WHERE (COALESCE(office_name, program_type) ILIKE '%' || search_query || '%' OR city ILIKE '%' || search_query || '%')
    AND latitude IS NOT NULL AND longitude IS NOT NULL

  UNION ALL

  SELECT ein, organization_name, address_raw, city, 'nonprofit'::text, NULL::numeric, NULL::numeric
  FROM atlas.nonprofit_registry
  WHERE (organization_name ILIKE '%' || search_query || '%' OR city ILIKE '%' || search_query || '%')

  LIMIT 50;
$function$;
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.settle_live_data_signal_candidates_v1(p_run_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'atlas', 'net', 'extensions', 'pg_temp'
AS $function$
declare
  v_attempt record;
  v_response record;
  v_body jsonb;
  v_nested jsonb;
  v_lighthouse_record_id uuid;
  v_seen integer := 0;
  v_pending integer := 0;
  v_bridged integer := 0;
  v_idempotent integer := 0;
  v_failed integer := 0;
  v_error text;
  v_receipts jsonb := '[]'::jsonb;
begin
  for v_attempt in
    select attempt.*
      from atlas.live_data_signal_bridge_attempt attempt
     where attempt.status = 'queued'
       and (p_run_id is null or attempt.run_id = p_run_id)
     order by attempt.queued_at, attempt.attempt_id
  loop
    v_seen := v_seen + 1;
    v_lighthouse_record_id := null;
    v_body := null;
    v_nested := null;

    select response.*
      into v_response
      from net._http_response response
     where response.id = v_attempt.request_id;

    if not found then
      v_pending := v_pending + 1;
      continue;
    end if;

    begin
      if coalesce(v_response.timed_out, false) then
        raise exception 'Lighthouse registration request timed out';
      end if;

      if coalesce(v_response.error_msg, '') <> '' then
        raise exception 'Lighthouse registration transport error: %',
          left(v_response.error_msg, 1000);
      end if;

      if v_response.status_code < 200 or v_response.status_code >= 300 then
        raise exception 'Lighthouse registration HTTP %: %',
          v_response.status_code,
          left(coalesce(v_response.content, ''), 1000);
      end if;

      if coalesce(v_response.content, '') = '' then
        raise exception 'Lighthouse registration returned an empty response body';
      end if;

      v_body := v_response.content::jsonb;

      if jsonb_typeof(v_body) = 'object' then
        v_lighthouse_record_id := nullif(
          coalesce(
            v_body->>'live_data_signal_id',
            v_body->>'register_live_data_signal_receipt_v1'
          ),
          ''
        )::uuid;
      elsif jsonb_typeof(v_body) = 'array' then
        v_lighthouse_record_id := nullif(
          coalesce(
            v_body#>>'{0,live_data_signal_id}',
            v_body#>>'{0,register_live_data_signal_receipt_v1}'
          ),
          ''
        )::uuid;
      elsif jsonb_typeof(v_body) = 'string' then
        begin
          v_nested := (v_body #>> '{}')::jsonb;
          if jsonb_typeof(v_nested) = 'object' then
            v_lighthouse_record_id := nullif(
              coalesce(
                v_nested->>'live_data_signal_id',
                v_nested->>'register_live_data_signal_receipt_v1'
              ),
              ''
            )::uuid;
          end if;
        exception when others then
          v_lighthouse_record_id := nullif(v_body #>> '{}', '')::uuid;
        end;
      end if;

      if v_lighthouse_record_id is null then
        raise exception 'Lighthouse registration receipt contains no live_data_signal_id: %',
          left(v_response.content, 1000);
      end if;

      if v_attempt.was_already_bridged
         and v_attempt.prior_lighthouse_record_id = v_lighthouse_record_id then
        v_idempotent := v_idempotent + 1;
      else
        v_bridged := v_bridged + 1;
      end if;

      update atlas.live_data_signal_candidate
         set lighthouse_status = 'bridged',
             lighthouse_record_id = v_lighthouse_record_id,
             lighthouse_last_error = null,
             lighthouse_bridged_at = clock_timestamp()
       where candidate_id = v_attempt.candidate_id;

      update atlas.live_data_signal_bridge_attempt
         set status = 'completed',
             response_status = v_response.status_code,
             response_body = left(v_response.content, 10000),
             error_message = null,
             settled_at = clock_timestamp()
       where attempt_id = v_attempt.attempt_id;

      v_receipts := v_receipts || jsonb_build_array(jsonb_build_object(
        'candidate_id', v_attempt.candidate_id,
        'candidate_hash', v_attempt.candidate_hash,
        'request_id', v_attempt.request_id,
        'lighthouse_record_id', v_lighthouse_record_id,
        'status', case
          when v_attempt.was_already_bridged
           and v_attempt.prior_lighthouse_record_id = v_lighthouse_record_id
          then 'idempotent'
          else 'bridged'
        end,
        'http_status', v_response.status_code
      ));
    exception when others then
      get stacked diagnostics v_error = message_text;
      v_failed := v_failed + 1;

      update atlas.live_data_signal_candidate
         set lighthouse_status = 'failed',
             lighthouse_last_error = left(v_error, 2000)
       where candidate_id = v_attempt.candidate_id;

      update atlas.live_data_signal_bridge_attempt
         set status = 'failed',
             response_status = v_response.status_code,
             response_body = left(v_response.content, 10000),
             error_message = left(v_error, 2000),
             settled_at = clock_timestamp()
       where attempt_id = v_attempt.attempt_id;

      v_receipts := v_receipts || jsonb_build_array(jsonb_build_object(
        'candidate_id', v_attempt.candidate_id,
        'candidate_hash', v_attempt.candidate_hash,
        'request_id', v_attempt.request_id,
        'status', 'failed',
        'error', left(v_error, 1000)
      ));
    end;
  end loop;

  return jsonb_build_object(
    'run_id', p_run_id,
    'attempts_seen', v_seen,
    'pending', v_pending,
    'bridged', v_bridged,
    'idempotent', v_idempotent,
    'failed', v_failed,
    'transport', 'atlas_pg_net_receipt_v1',
    'completed_at', clock_timestamp(),
    'receipts', v_receipts
  );
end
$function$;
CREATE OR REPLACE FUNCTION public.start_atlas_event_entity_resolution_run_v1(p_run_id uuid, p_resolver_id text, p_resolver_version text, p_rule_manifest_hash text, p_entity_index_hash text, p_stream_id text, p_batch_size integer, p_input_manifest jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'atlas', 'extensions'
AS $function$
DECLARE
  v_manifest jsonb := COALESCE(p_input_manifest, '{}'::jsonb);
  v_manifest_hash text;
  v_rule_count integer;
  v_supplied_rule_count integer;
  v_existing atlas.signal_event_entity_resolution_run%ROWTYPE;
BEGIN
  IF p_run_id IS NULL THEN
    RAISE EXCEPTION 'p_run_id is required';
  END IF;
  IF COALESCE(btrim(p_resolver_id), '') = '' OR COALESCE(btrim(p_resolver_version), '') = '' THEN
    RAISE EXCEPTION 'resolver id and version are required';
  END IF;
  IF p_rule_manifest_hash !~ '^[0-9a-f]{64}$' OR p_entity_index_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'rule manifest hash and entity index hash must be lowercase SHA-256 values';
  END IF;
  IF p_batch_size < 1 OR p_batch_size > 5000 THEN
    RAISE EXCEPTION 'batch size must be between 1 and 5000';
  END IF;
  IF v_manifest->>'rule_manifest_hash' IS DISTINCT FROM p_rule_manifest_hash
     OR v_manifest->>'entity_index_hash' IS DISTINCT FROM p_entity_index_hash THEN
    RAISE EXCEPTION 'input manifest hashes do not match declared run hashes';
  END IF;
  IF v_manifest->>'resolver_id' IS DISTINCT FROM p_resolver_id
     OR v_manifest->>'resolver_version' IS DISTINCT FROM p_resolver_version THEN
    RAISE EXCEPTION 'input manifest resolver identity does not match declared run identity';
  END IF;
  IF COALESCE((v_manifest->>'no_fuzzy_matching')::boolean, false) IS DISTINCT FROM true
     OR COALESCE((v_manifest->>'no_silent_entity_creation')::boolean, false) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'input manifest must lock no-fuzzy and no-silent-entity-creation guarantees';
  END IF;

  SELECT count(*) INTO v_rule_count
  FROM atlas.signal_event_entity_resolution_rule
  WHERE is_active = true
    AND rule_manifest_hash = p_rule_manifest_hash;

  IF v_rule_count = 0 THEN
    RAISE EXCEPTION 'rule manifest % is not active in Atlas', p_rule_manifest_hash;
  END IF;
  IF COALESCE(v_manifest->>'rule_count', '') !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'input manifest rule_count is required';
  END IF;
  v_supplied_rule_count := (v_manifest->>'rule_count')::integer;
  IF v_supplied_rule_count <> v_rule_count THEN
    RAISE EXCEPTION 'input manifest rule_count % does not match active rule count %',
      v_supplied_rule_count, v_rule_count;
  END IF;
  IF jsonb_typeof(v_manifest->'rule_ids') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'input manifest rule_ids must be a JSON array';
  END IF;
  IF (
    SELECT count(*)
    FROM jsonb_array_elements_text(v_manifest->'rule_ids') supplied(rule_id)
  ) <> v_rule_count
  OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(v_manifest->'rule_ids') supplied(rule_id)
    LEFT JOIN atlas.signal_event_entity_resolution_rule r
      ON r.rule_id = supplied.rule_id
     AND r.is_active = true
     AND r.rule_manifest_hash = p_rule_manifest_hash
    WHERE r.rule_id IS NULL
  )
  OR EXISTS (
    SELECT 1
    FROM atlas.signal_event_entity_resolution_rule r
    WHERE r.is_active = true
      AND r.rule_manifest_hash = p_rule_manifest_hash
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(v_manifest->'rule_ids') supplied(rule_id)
        WHERE supplied.rule_id = r.rule_id
      )
  ) THEN
    RAISE EXCEPTION 'input manifest rule_ids do not equal the active locked rule set';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM atlas.signal_event_entity_resolution_run prior
    WHERE prior.resolver_id = p_resolver_id
      AND prior.resolver_version = p_resolver_version
      AND prior.rule_manifest_hash <> p_rule_manifest_hash
  ) THEN
    RAISE EXCEPTION 'resolver % version % has changed rule manifest; increment resolver version',
      p_resolver_id, p_resolver_version;
  END IF;

  v_manifest_hash := encode(extensions.digest(v_manifest::text, 'sha256'), 'hex');

  SELECT * INTO v_existing
  FROM atlas.signal_event_entity_resolution_run
  WHERE run_id = p_run_id;

  IF FOUND THEN
    IF v_existing.resolver_id <> p_resolver_id
       OR v_existing.resolver_version <> p_resolver_version
       OR v_existing.rule_manifest_hash <> p_rule_manifest_hash
       OR v_existing.entity_index_hash <> p_entity_index_hash
       OR v_existing.manifest_hash <> v_manifest_hash THEN
      RAISE EXCEPTION 'run id % already exists with a different deterministic manifest', p_run_id;
    END IF;
    RETURN jsonb_build_object(
      'run_id', p_run_id,
      'status', v_existing.status,
      'idempotent', true,
      'manifest_hash', v_existing.manifest_hash
    );
  END IF;

  INSERT INTO atlas.signal_event_entity_resolution_run (
    run_id,
    resolver_id,
    resolver_version,
    rule_manifest_hash,
    entity_index_hash,
    status,
    stream_id,
    batch_size,
    input_manifest,
    manifest_hash
  ) VALUES (
    p_run_id,
    p_resolver_id,
    p_resolver_version,
    p_rule_manifest_hash,
    p_entity_index_hash,
    'running',
    p_stream_id,
    p_batch_size,
    v_manifest,
    v_manifest_hash
  );

  RETURN jsonb_build_object(
    'run_id', p_run_id,
    'status', 'running',
    'idempotent', false,
    'manifest_hash', v_manifest_hash
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.trigger_connector_run(connector_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'atlas'
AS $function$
DECLARE
    result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'connector', connector_name,
        'status', 'queued',
        'message', 'Use HTTP POST to /functions/v1/atlas-engine with {"connector": "' || connector_name || '"}'
    ) INTO result;
    RETURN result;
END;
$function$;
CREATE OR REPLACE FUNCTION public.upsert_atlas_entity_registry(_entities jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'atlas', 'public', 'pg_temp'
AS $function$
DECLARE
  affected_rows integer := 0;
BEGIN
  IF _entities IS NULL OR jsonb_typeof(_entities) <> 'array' THEN
    RAISE EXCEPTION 'upsert_atlas_entity_registry expects a JSON array';
  END IF;

  INSERT INTO atlas.entity_registry (
    entity_id,
    entity_type,
    primary_name,
    name_variants,
    first_seen_jurisdiction,
    jurisdiction_count,
    source_systems,
    source_population_id,
    source_population_table,
    is_active,
    last_verified,
    updated_at,
    source_connector_id,
    raw_record_id,
    statute_id,
    source_url,
    extracted_at,
    extraction_method,
    source_field,
    source_external_id,
    metadata
  )
  SELECT
    e.entity_id,
    e.entity_type,
    e.primary_name,
    COALESCE(e.name_variants, '[]'::jsonb),
    e.first_seen_jurisdiction,
    COALESCE(e.jurisdiction_count, 0),
    COALESCE(e.source_systems, '[]'::jsonb),
    e.source_population_id,
    e.source_population_table,
    COALESCE(e.is_active, true),
    e.last_verified,
    COALESCE(e.updated_at, now()),
    e.source_connector_id,
    e.raw_record_id,
    e.statute_id,
    e.source_url,
    e.extracted_at,
    e.extraction_method,
    e.source_field,
    e.source_external_id,
    e.metadata
  FROM jsonb_to_recordset(_entities) AS e (
    entity_id varchar,
    entity_type varchar,
    primary_name varchar,
    name_variants jsonb,
    first_seen_jurisdiction varchar,
    jurisdiction_count integer,
    source_systems jsonb,
    source_population_id varchar,
    source_population_table varchar,
    is_active boolean,
    last_verified timestamptz,
    updated_at timestamptz,
    source_connector_id uuid,
    raw_record_id uuid,
    statute_id uuid,
    source_url text,
    extracted_at timestamptz,
    extraction_method text,
    source_field text,
    source_external_id text,
    metadata jsonb
  )
  WHERE e.entity_id IS NOT NULL
    AND e.entity_type IS NOT NULL
    AND e.primary_name IS NOT NULL
    AND e.extraction_method = 'deterministic_field_mapping'
  ON CONFLICT (entity_id) DO UPDATE SET
    entity_type = EXCLUDED.entity_type,
    primary_name = EXCLUDED.primary_name,
    name_variants = EXCLUDED.name_variants,
    first_seen_jurisdiction = EXCLUDED.first_seen_jurisdiction,
    jurisdiction_count = EXCLUDED.jurisdiction_count,
    source_systems = EXCLUDED.source_systems,
    source_population_id = EXCLUDED.source_population_id,
    source_population_table = EXCLUDED.source_population_table,
    is_active = EXCLUDED.is_active,
    last_verified = EXCLUDED.last_verified,
    updated_at = EXCLUDED.updated_at,
    source_connector_id = EXCLUDED.source_connector_id,
    raw_record_id = EXCLUDED.raw_record_id,
    statute_id = EXCLUDED.statute_id,
    source_url = EXCLUDED.source_url,
    extracted_at = EXCLUDED.extracted_at,
    extraction_method = EXCLUDED.extraction_method,
    source_field = EXCLUDED.source_field,
    source_external_id = EXCLUDED.source_external_id,
    metadata = EXCLUDED.metadata;

  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  RETURN affected_rows;
END;
$function$;
CREATE OR REPLACE FUNCTION public.upsert_openstates_civic_map_signals_v1(_signals jsonb)
 RETURNS TABLE(out_signal_id bigint, out_signal_type character varying, out_statute_id uuid, out_rule_id text, out_action text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'atlas', 'public', 'pg_temp'
AS $function$
DECLARE
  item jsonb;
  inserted_id bigint;
  affected_rows integer;
  signal_action text;
BEGIN
  IF _signals IS NULL OR jsonb_typeof(_signals) <> 'array' THEN
    RAISE EXCEPTION '_signals must be a JSON array';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(_signals)
  LOOP
    IF COALESCE(item->>'generation_method', '') <> 'deterministic_rule' THEN
      RAISE EXCEPTION 'Signal generation_method must be deterministic_rule';
    END IF;

    IF COALESCE(item->>'source_url', '') = '' THEN
      RAISE EXCEPTION 'Signal source_url is required';
    END IF;

    IF COALESCE(item->>'raw_record_id', '') = '' THEN
      RAISE EXCEPTION 'Signal raw_record_id is required';
    END IF;

    IF COALESCE(item->>'statute_id', '') = '' THEN
      RAISE EXCEPTION 'Signal statute_id is required';
    END IF;

    IF COALESCE(item->>'source_connector_id', '') = '' THEN
      RAISE EXCEPTION 'Signal source_connector_id is required';
    END IF;

    IF COALESCE(item->>'rule_id', '') = '' THEN
      RAISE EXCEPTION 'Signal rule_id is required';
    END IF;

    IF COALESCE(item->>'signal_type', '') NOT IN (
      'new_statute_or_bill',
      'jurisdiction_legislative_activity',
      'classification_activity'
    ) THEN
      RAISE EXCEPTION 'Signal type is not allowed for Open States Signal Generation v1: %', item->>'signal_type';
    END IF;

    INSERT INTO atlas.civic_map_signals (
      signal_type,
      geography_key,
      severity_score,
      metadata_json,
      source_table,
      source_record_id,
      detected_at,
      source_connector_id,
      raw_record_id,
      statute_id,
      entity_ids,
      jurisdiction_raw_value,
      jurisdiction_id,
      source_url,
      confidence_score,
      severity,
      signal_status,
      evidence_payload,
      generation_method,
      rule_id,
      rule_version,
      provenance_metadata,
      signal_dedup_key
    ) VALUES (
      item->>'signal_type',
      NULLIF(item->>'geography_key', ''),
      COALESCE(NULLIF(item->>'severity_score', '')::numeric, NULLIF(item->>'confidence_score', '')::numeric, 0.0),
      COALESCE(item->'metadata_json', '{}'::jsonb),
      COALESCE(NULLIF(item->>'source_table', ''), 'statutes'),
      item->>'statute_id',
      COALESCE(NULLIF(item->>'detected_at', '')::timestamptz, now()),
      (item->>'source_connector_id')::uuid,
      (item->>'raw_record_id')::uuid,
      (item->>'statute_id')::uuid,
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(item->'entity_ids', '[]'::jsonb))), ARRAY[]::text[]),
      item->>'jurisdiction_raw_value',
      NULLIF(item->>'jurisdiction_id', '')::uuid,
      item->>'source_url',
      COALESCE(NULLIF(item->>'confidence_score', '')::numeric, 1.0),
      COALESCE(NULLIF(item->>'severity', ''), 'informational'),
      COALESCE(NULLIF(item->>'signal_status', ''), 'active'),
      COALESCE(item->'evidence_payload', '{}'::jsonb),
      item->>'generation_method',
      item->>'rule_id',
      COALESCE(NULLIF(item->>'rule_version', ''), 'v1'),
      COALESCE(item->'provenance_metadata', '{}'::jsonb),
      item->>'signal_dedup_key'
    )
    ON CONFLICT (source_connector_id, signal_type, statute_id, rule_id)
      WHERE generation_method = 'deterministic_rule'
        AND source_connector_id IS NOT NULL
        AND statute_id IS NOT NULL
        AND rule_id IS NOT NULL
    DO UPDATE SET
      raw_record_id = EXCLUDED.raw_record_id,
      entity_ids = EXCLUDED.entity_ids,
      jurisdiction_raw_value = EXCLUDED.jurisdiction_raw_value,
      jurisdiction_id = EXCLUDED.jurisdiction_id,
      source_url = EXCLUDED.source_url,
      confidence_score = EXCLUDED.confidence_score,
      severity_score = EXCLUDED.severity_score,
      severity = EXCLUDED.severity,
      signal_status = EXCLUDED.signal_status,
      evidence_payload = EXCLUDED.evidence_payload,
      metadata_json = EXCLUDED.metadata_json,
      generation_method = EXCLUDED.generation_method,
      rule_version = EXCLUDED.rule_version,
      provenance_metadata = EXCLUDED.provenance_metadata,
      signal_dedup_key = EXCLUDED.signal_dedup_key,
      detected_at = EXCLUDED.detected_at
    RETURNING atlas.civic_map_signals.signal_id INTO inserted_id;

    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    signal_action := CASE WHEN affected_rows = 1 THEN 'upserted' ELSE 'unknown' END;

    out_signal_id := inserted_id;
    out_signal_type := item->>'signal_type';
    out_statute_id := (item->>'statute_id')::uuid;
    out_rule_id := item->>'rule_id';
    out_action := signal_action;
    RETURN NEXT;
  END LOOP;
END;
$function$;
CREATE OR REPLACE FUNCTION public.verify_atlas_tables()
 RETURNS TABLE(table_name text, row_count bigint)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'atlas'
AS $function$
BEGIN
    RETURN QUERY
    SELECT 'jurisdictions'::TEXT, COUNT(*)::BIGINT FROM jurisdictions
    UNION ALL SELECT 'schema_registry', COUNT(*) FROM schema_registry
    UNION ALL SELECT 'connector_registry', COUNT(*) FROM connector_registry
    UNION ALL SELECT 'raw_records', COUNT(*) FROM raw_records
    UNION ALL SELECT 'ingest_jobs', COUNT(*) FROM ingest_jobs
    UNION ALL SELECT 'statutes', COUNT(*) FROM statutes
    UNION ALL SELECT 'case_law', COUNT(*) FROM case_law
    UNION ALL SELECT 'entity_registry', COUNT(*) FROM entity_registry
    UNION ALL SELECT 'civic_map_signals', COUNT(*) FROM civic_map_signals;
END;
$function$;

-- ---- views ----
create view "atlas"."v_bridge_operational_status" ("total_queue_rows", "pending_count", "processing_count", "retrying_count", "completed_count", "failed_count", "oldest_pending_or_retrying_at", "last_completed_at", "last_processed_at") as
 SELECT count(*)::integer AS total_queue_rows,
    count(*) FILTER (WHERE status::text = 'pending'::text)::integer AS pending_count,
    count(*) FILTER (WHERE status::text = 'processing'::text)::integer AS processing_count,
    count(*) FILTER (WHERE status::text = 'retrying'::text)::integer AS retrying_count,
    count(*) FILTER (WHERE status::text = 'completed'::text)::integer AS completed_count,
    count(*) FILTER (WHERE status::text = 'failed'::text)::integer AS failed_count,
    min(created_at) FILTER (WHERE status::text = ANY (ARRAY['pending'::character varying, 'retrying'::character varying]::text[])) AS oldest_pending_or_retrying_at,
    max(completed_at) AS last_completed_at,
    max(processed_at) AS last_processed_at
   FROM atlas.lighthouse_bridge_queue;
create view "atlas"."v_bridge_status" ("bridge_id", "bridge_name", "target_project", "target_url", "enabled", "last_sync_at", "last_sync_status", "last_sync_error", "total_syncs", "successful_syncs", "failed_syncs", "pending_syncs", "last_sync_type", "created_at", "updated_at") as
 SELECT bc.bridge_id,
    bc.bridge_name,
    bc.target_project,
    bc.target_url,
    bc.enabled,
    bc.last_sync_at,
    bc.last_sync_status,
    bc.last_sync_error,
    COALESCE(stats.total_syncs, 0::bigint) AS total_syncs,
    COALESCE(stats.successful_syncs, 0::bigint) AS successful_syncs,
    COALESCE(stats.failed_syncs, 0::bigint) AS failed_syncs,
    COALESCE(stats.pending_syncs, 0::bigint) AS pending_syncs,
    stats.last_sync_type,
    bc.created_at,
    bc.updated_at
   FROM atlas.bridge_config bc
     LEFT JOIN LATERAL ( SELECT count(*) AS total_syncs,
            count(*) FILTER (WHERE bridge_sync_log.status::text = 'sent'::text) AS successful_syncs,
            count(*) FILTER (WHERE bridge_sync_log.status::text = 'error'::text) AS failed_syncs,
            count(*) FILTER (WHERE bridge_sync_log.status::text = 'pending'::text) AS pending_syncs,
            ( SELECT bridge_sync_log_1.sync_type
                   FROM atlas.bridge_sync_log bridge_sync_log_1
                  WHERE bridge_sync_log_1.bridge_id::text = bc.bridge_id::text
                  ORDER BY bridge_sync_log_1.synced_at DESC
                 LIMIT 1) AS last_sync_type
           FROM atlas.bridge_sync_log
          WHERE bridge_sync_log.bridge_id::text = bc.bridge_id::text) stats ON true
  ORDER BY bc.bridge_id;
create view "atlas"."v_bridge_sync_history" ("log_id", "bridge_id", "bridge_name", "sync_type", "source_table", "source_record_id", "target_table", "target_record_id", "status", "error_message", "duration_ms", "synced_at") as
 SELECT bsl.log_id,
    bsl.bridge_id,
    bc.bridge_name,
    bsl.sync_type,
    bsl.source_table,
    bsl.source_record_id,
    bsl.target_table,
    bsl.target_record_id,
    bsl.status,
    bsl.error_message,
    bsl.duration_ms,
    bsl.synced_at
   FROM atlas.bridge_sync_log bsl
     JOIN atlas.bridge_config bc ON bc.bridge_id::text = bsl.bridge_id::text
  ORDER BY bsl.synced_at DESC;
create view "atlas"."v_clauses_pending_review" ("clause_id", "contract_id", "pattern_id", "pattern_name", "category", "clause_text", "clause_context", "severity_score", "confidence_score", "extraction_confidence", "page_number", "pdf_url", "extracted_at", "status", "schema_name", "extraction_method") as
 SELECT cc.clause_id,
    cc.contract_id,
    cc.pattern_id,
    cp.pattern_name,
    cp.category,
    cc.clause_text,
    cc.clause_context,
    cc.severity_score,
    cc.confidence_score,
    cc.extraction_confidence,
    cc.page_number,
    cc.pdf_url,
    cc.extracted_at,
    cc.status,
    q.schema_name,
    q.extraction_method
   FROM atlas.contract_clauses cc
     JOIN atlas.clause_patterns cp ON cc.pattern_id::text = cp.pattern_id::text
     LEFT JOIN atlas.pdf_extraction_queue q ON cc.queue_id = q.queue_id
  WHERE cc.status::text = 'pending'::text
  ORDER BY cc.severity_score DESC, cc.extracted_at DESC;
create view "atlas"."v_cross_domain_entities" ("entity_id", "primary_name", "entity_type", "jurisdiction_count", "source_systems", "first_seen_jurisdiction", "last_verified", "domain_presence_count") as
 SELECT entity_id,
    primary_name,
    entity_type,
    jurisdiction_count,
    source_systems,
    first_seen_jurisdiction,
    last_verified,
    ( SELECT count(DISTINCT dr.domain_code) AS count
           FROM atlas.detection_rules dr
          WHERE (dr.target_table::text IN ( SELECT e2.source_population_table
                   FROM atlas.entity_registry e2
                  WHERE e2.entity_id::text = er.entity_id::text))) AS domain_presence_count
   FROM atlas.entity_registry er
  WHERE is_active = true
  ORDER BY (( SELECT count(DISTINCT dr.domain_code) AS count
           FROM atlas.detection_rules dr
          WHERE (dr.target_table::text IN ( SELECT e2.source_population_table
                   FROM atlas.entity_registry e2
                  WHERE e2.entity_id::text = er.entity_id::text)))) DESC, jurisdiction_count DESC;
create view "atlas"."v_entity_risk_score" ("entity_id", "primary_name", "entity_type", "total_signals", "max_severity", "avg_severity", "unique_signal_types", "composite_risk_score") as
 SELECT er.entity_id,
    er.primary_name,
    er.entity_type,
    count(DISTINCT s.signal_id) AS total_signals,
    max(s.severity_score) AS max_severity,
    avg(s.severity_score) AS avg_severity,
    count(DISTINCT s.signal_type) AS unique_signal_types,
    COALESCE(max(s.severity_score), 0::numeric) * 0.6 + count(DISTINCT s.signal_type)::numeric / 9::numeric * 0.4 AS composite_risk_score
   FROM atlas.entity_registry er
     LEFT JOIN atlas.civic_map_signals s ON (s.metadata_json ->> 'entity_id'::text) = er.entity_id::text
  WHERE er.is_active = true
  GROUP BY er.entity_id, er.primary_name, er.entity_type
  ORDER BY (COALESCE(max(s.severity_score), 0::numeric) * 0.6 + count(DISTINCT s.signal_type)::numeric / 9::numeric * 0.4) DESC;
create view "atlas"."v_lighthouse_case_queue" ("case_id", "case_type", "case_title", "severity_score", "priority_score", "geography_key", "jurisdiction", "primary_entity_id", "case_status", "assigned_to", "atlas_created_at", "lighthouse_ingested_at", "last_activity_at") as
 SELECT case_id,
    case_type,
    case_title,
    severity_score,
    priority_score,
    geography_key,
    jurisdiction,
    primary_entity_id,
    case_status,
    assigned_to,
    atlas_created_at,
    lighthouse_ingested_at,
    last_activity_at
   FROM atlas.lighthouse_cases
  WHERE case_status::text = ANY (ARRAY['open'::character varying, 'investigating'::character varying, 'escalated'::character varying]::text[])
  ORDER BY priority_score DESC, severity_score DESC, atlas_created_at DESC;
create view "atlas"."v_lighthouse_civic_map" ("pin_id", "geography_key", "pin_type", "pin_subtype", "latitude", "longitude", "title", "description", "severity", "icon_type", "color_hex", "is_clusterable", "entity_id", "signal_id", "case_id") as
 SELECT pin_id,
    geography_key,
    pin_type,
    pin_subtype,
    latitude,
    longitude,
    title,
    description,
    severity,
    icon_type,
    color_hex,
    is_clusterable,
    entity_id,
    signal_id,
    case_id
   FROM atlas.lighthouse_map_pins
  WHERE expires_at > now() OR expires_at IS NULL
  ORDER BY severity DESC, pin_type;
create view "atlas"."v_lighthouse_entity_watchlist" ("entity_id", "primary_name", "entity_type", "risk_score", "risk_tier", "watchlist_status", "jurisdiction_count", "last_verified") as
 SELECT entity_id,
    primary_name,
    entity_type,
    risk_score,
    risk_tier,
    watchlist_status,
    jurisdiction_count,
    last_verified
   FROM atlas.lighthouse_entities
  WHERE (risk_tier::text = ANY (ARRAY['high'::character varying, 'critical'::character varying]::text[])) OR (watchlist_status::text = ANY (ARRAY['monitoring'::character varying, 'investigating'::character varying, 'flagged'::character varying]::text[]))
  ORDER BY risk_score DESC, jurisdiction_count DESC;
create view "atlas"."v_live_data_signal_candidate_current_v1" ("candidate_id", "candidate_hash", "rule_id", "rule_version", "rule_contract_hash", "engine_id", "engine_version", "signal_type", "title", "description", "primary_stream_id", "source_event_refs", "entity_ids", "entity_resolution_status", "jurisdiction_id", "severity", "confidence_score", "verification_state", "supporting_statistics", "evidence_refs", "source_freshness_at", "detected_at", "source_input_hash", "first_run_id", "last_run_id", "first_detected_at", "last_replayed_at", "lighthouse_status", "lighthouse_record_id", "lighthouse_last_error", "lighthouse_bridged_at", "semantic_key", "is_current", "supersedes_candidate_id", "retired_at") as
 SELECT candidate_id,
    candidate_hash,
    rule_id,
    rule_version,
    rule_contract_hash,
    engine_id,
    engine_version,
    signal_type,
    title,
    description,
    primary_stream_id,
    source_event_refs,
    entity_ids,
    entity_resolution_status,
    jurisdiction_id,
    severity,
    confidence_score,
    verification_state,
    supporting_statistics,
    evidence_refs,
    source_freshness_at,
    detected_at,
    source_input_hash,
    first_run_id,
    last_run_id,
    first_detected_at,
    last_replayed_at,
    lighthouse_status,
    lighthouse_record_id,
    lighthouse_last_error,
    lighthouse_bridged_at,
    semantic_key,
    is_current,
    supersedes_candidate_id,
    retired_at
   FROM atlas.live_data_signal_candidate
  WHERE is_current;
create view "atlas"."v_pdf_extraction_pending" ("queue_id", "schema_name", "source_record_id", "pdf_url", "extraction_status", "download_attempts", "max_attempts", "next_retry_at", "created_at", "hours_in_queue") as
 SELECT queue_id,
    schema_name,
    source_record_id,
    pdf_url,
    extraction_status,
    download_attempts,
    max_attempts,
    next_retry_at,
    created_at,
    EXTRACT(epoch FROM now() - created_at) / 3600::numeric AS hours_in_queue
   FROM atlas.pdf_extraction_queue
  WHERE extraction_status::text = ANY (ARRAY['pending'::character varying, 'retrying'::character varying, 'failed'::character varying]::text[])
  ORDER BY (
        CASE extraction_status
            WHEN 'pending'::text THEN 1
            WHEN 'retrying'::text THEN 2
            WHEN 'failed'::text THEN 3
            ELSE NULL::integer
        END), created_at;
create view "atlas"."v_prism_escalation_contacts" ("contact_id", "entity_id", "agency_name", "entity_type", "contact_type", "contact_value", "normalized_value", "contact_label", "is_primary", "is_verified", "geography_key", "jurisdiction_name", "cross_jurisdiction_presence", "first_seen_at", "last_seen_at", "source_schema_name", "source_population_table") as
 SELECT cr.contact_id,
    cr.entity_id,
    er.primary_name AS agency_name,
    er.entity_type,
    cr.contact_type,
    cr.contact_value,
    cr.normalized_value,
    cr.contact_label,
    cr.is_primary,
    cr.is_verified,
    cr.geography_key,
    gr.geography_name AS jurisdiction_name,
    er.jurisdiction_count AS cross_jurisdiction_presence,
    cr.first_seen_at,
    cr.last_seen_at,
    cr.source_schema_name,
    cr.source_population_table
   FROM atlas.contact_registry cr
     JOIN atlas.entity_registry er ON cr.entity_id::text = er.entity_id::text
     LEFT JOIN atlas.geography_registry gr ON cr.geography_key::text = gr.geography_key::text
  WHERE er.is_active = true AND er.entity_type::text = 'government_agency'::text
  ORDER BY er.jurisdiction_count DESC, er.primary_name, cr.is_primary DESC;
create view "atlas"."v_propublica_unresolved_metadata_candidate_v1" ("normalized_entity_name", "organization_name", "unique_record_count", "unresolved_unique_record_count", "unresolved_unique_rate", "source_freshness_at", "entity_id", "entity_type", "primary_name", "last_verified", "match_count", "severity", "source_event_refs", "supporting_statistics", "source_input_hash") with (security_invoker=true) as
 WITH canonical_events AS (
         SELECT event.stream_id,
            event."offset",
            event."timestamp" AS source_observed_at,
            event.payload,
            event.provenance,
            identity.event_identity_hash,
            identity.source_record_key,
            lower(TRIM(BOTH FROM COALESCE(event.payload ->> 'organization_name'::text, ''::text))) AS normalized_entity_name,
            (event.payload ->> 'tax_period'::text) IS NULL OR (event.payload ->> 'form_type'::text) IS NULL OR COALESCE(event.payload ->> 'external_id'::text, ''::text) ~~ '%-unknown'::text AS unresolved
           FROM atlas.signal_event_identity identity
             JOIN signal_events event ON event.stream_id = identity.stream_id AND event."offset" = identity.canonical_offset
          WHERE identity.stream_id = 'pro_publica'::text AND identity.signal_type = 'nonprofit_990_filing'::text AND COALESCE(event.payload ->> 'organization_name'::text, ''::text) <> ''::text
        ), unique_records AS (
         SELECT canonical_events.normalized_entity_name,
            canonical_events.source_record_key,
            min(canonical_events."offset") AS representative_offset,
            max(canonical_events.source_observed_at) AS source_freshness_at,
            bool_or(canonical_events.unresolved) AS unresolved,
            max(canonical_events.payload ->> 'organization_name'::text) AS organization_name,
            max(canonical_events.payload ->> 'pdf_url'::text) AS source_url
           FROM canonical_events
          GROUP BY canonical_events.normalized_entity_name, canonical_events.source_record_key
        ), aggregates AS (
         SELECT unique_records.normalized_entity_name,
            max(unique_records.organization_name) AS organization_name,
            count(*)::integer AS unique_record_count,
            count(*) FILTER (WHERE unique_records.unresolved)::integer AS unresolved_unique_record_count,
            round(count(*) FILTER (WHERE unique_records.unresolved)::numeric / NULLIF(count(*), 0)::numeric, 6) AS unresolved_unique_rate,
            max(unique_records.source_freshness_at) AS source_freshness_at
           FROM unique_records
          GROUP BY unique_records.normalized_entity_name
        ), exact_entities AS (
         SELECT aggregate.normalized_entity_name,
            aggregate.organization_name,
            aggregate.unique_record_count,
            aggregate.unresolved_unique_record_count,
            aggregate.unresolved_unique_rate,
            aggregate.source_freshness_at,
            entity.entity_id,
            entity.entity_type,
            entity.primary_name,
            entity.last_verified,
            entity.match_count
           FROM aggregates aggregate
             CROSS JOIN LATERAL ( SELECT min(registry.entity_id::text) AS entity_id,
                    min(registry.entity_type::text) AS entity_type,
                    min(registry.primary_name::text) AS primary_name,
                    max(registry.last_verified) AS last_verified,
                    count(*)::integer AS match_count
                   FROM atlas.entity_registry registry
                  WHERE registry.is_active AND lower(TRIM(BOTH FROM registry.primary_name)) = aggregate.normalized_entity_name) entity
          WHERE entity.match_count = 1
        ), with_refs AS (
         SELECT exact.normalized_entity_name,
            exact.organization_name,
            exact.unique_record_count,
            exact.unresolved_unique_record_count,
            exact.unresolved_unique_rate,
            exact.source_freshness_at,
            exact.entity_id,
            exact.entity_type,
            exact.primary_name,
            exact.last_verified,
            exact.match_count,
                CASE
                    WHEN exact.unresolved_unique_rate >= 0.95 AND exact.unique_record_count >= 100 THEN 'critical'::text
                    WHEN exact.unresolved_unique_rate >= 0.80 AND exact.unique_record_count >= 10 THEN 'high'::text
                    ELSE 'medium'::text
                END AS severity,
            ( SELECT jsonb_agg(jsonb_build_object('stream_id', 'pro_publica', 'offset', reference.representative_offset, 'source_record_key', reference.source_record_key, 'source_url', reference.source_url) ORDER BY reference.source_record_key) AS jsonb_agg
                   FROM ( SELECT record.source_record_key,
                            record.representative_offset,
                            record.source_url
                           FROM unique_records record
                          WHERE record.normalized_entity_name = exact.normalized_entity_name
                          ORDER BY record.source_record_key
                         LIMIT 25) reference) AS source_event_refs
           FROM exact_entities exact
        )
 SELECT normalized_entity_name,
    organization_name,
    unique_record_count,
    unresolved_unique_record_count,
    unresolved_unique_rate,
    source_freshness_at,
    entity_id,
    entity_type,
    primary_name,
    last_verified,
    match_count,
    severity,
    source_event_refs,
    jsonb_build_object('candidate_identity_version', '1.1.0', 'unique_source_record_count', unique_record_count, 'unresolved_unique_record_count', unresolved_unique_record_count, 'unresolved_unique_rate', unresolved_unique_rate, 'identity_unit', 'unique external_id plus pdf_url', 'source_freshness_basis', 'maximum stable source event timestamp', 'entity_resolution_method', 'entity_registry_primary_name_exact', 'entity_resolution_match_count', match_count, 'entity_registry_last_verified', last_verified, 'historical_raw_event_count', ( SELECT count(*) AS count
           FROM signal_events event
          WHERE event.stream_id = 'pro_publica'::text AND event.signal_type = 'nonprofit_990_filing'::text AND lower(TRIM(BOTH FROM COALESCE(event.payload ->> 'organization_name'::text, ''::text))) = with_refs.normalized_entity_name), 'canonical_event_count', ( SELECT count(*) AS count
           FROM canonical_events event
          WHERE event.normalized_entity_name = with_refs.normalized_entity_name)) AS supporting_statistics,
    encode(extensions.digest(convert_to(jsonb_build_object('candidate_identity_version', '1.1.0', 'stream_id', 'pro_publica', 'entity_id', entity_id, 'unique_record_count', unique_record_count, 'unresolved_unique_record_count', unresolved_unique_record_count, 'unresolved_unique_rate', unresolved_unique_rate, 'source_event_refs', source_event_refs, 'entity_resolution_method', 'entity_registry_primary_name_exact')::text, 'UTF8'::name), 'sha256'::text), 'hex'::text) AS source_input_hash
   FROM with_refs;
create view "atlas"."v_rosetta_contacts" ("contact_id", "entity_id", "entity_name", "entity_type", "contact_type", "contact_value", "normalized_value", "contact_label", "is_primary", "is_verified", "geography_key", "jurisdiction_name", "first_seen_at", "last_seen_at", "source_schema_name", "source_population_table") as
 SELECT cr.contact_id,
    cr.entity_id,
    er.primary_name AS entity_name,
    er.entity_type,
    cr.contact_type,
    cr.contact_value,
    cr.normalized_value,
    cr.contact_label,
    cr.is_primary,
    cr.is_verified,
    cr.geography_key,
    gr.geography_name AS jurisdiction_name,
    cr.first_seen_at,
    cr.last_seen_at,
    cr.source_schema_name,
    cr.source_population_table
   FROM atlas.contact_registry cr
     JOIN atlas.entity_registry er ON cr.entity_id::text = er.entity_id::text
     LEFT JOIN atlas.geography_registry gr ON cr.geography_key::text = gr.geography_key::text
  WHERE er.is_active = true AND (er.entity_type::text = ANY (ARRAY['nonprofit'::character varying, 'organization'::character varying, 'government_agency'::character varying]::text[]))
  ORDER BY er.primary_name, cr.contact_type, cr.is_primary DESC;
create view "atlas"."v_signal_intelligence_cards" ("signal_id", "source_signal_table", "raw_signal_type", "canonical_signal_code", "canonical_signal_name", "signal_family", "signal_category", "display_title", "display_summary", "geography_key", "jurisdiction_raw_value", "jurisdiction_id", "entity_ids", "source_table", "source_record_id", "source_connector_id", "raw_record_id", "statute_id", "source_url", "confidence_score", "severity", "severity_score", "signal_status", "verification_status", "record_origin", "exclude_from_production", "quarantine_reason", "evidence_payload", "metadata_json", "provenance_metadata", "detected_at", "created_at") as
 WITH civic AS (
         SELECT s.signal_id::text AS signal_id,
            'atlas.civic_map_signals'::text AS source_signal_table,
            s.signal_type::text AS raw_signal_type,
                CASE
                    WHEN s.signal_type::text = 'benefit_access_gap'::text THEN 'JURIS_FAIL'::text
                    WHEN s.signal_type::text = ANY (ARRAY['regulatory_comment_concentration'::character varying, 'industry_sector_concentration'::character varying]::text[]) THEN 'REGC_COMMENT_CONC'::text
                    WHEN s.signal_type::text = ANY (ARRAY['classification_activity'::character varying, 'jurisdiction_legislative_activity'::character varying, 'new_statute_or_bill'::character varying]::text[]) THEN 'TEMP_ANOM'::text
                    WHEN s.signal_type::text = ANY (ARRAY['court_activity'::character varying, 'jurisdiction_judicial_activity'::character varying, 'new_court_opinion'::character varying]::text[]) THEN 'PROC_VIOL'::text
                    WHEN s.signal_type::text = 'nonprofit_capacity_collapse'::text THEN 'JURIS_FAIL'::text
                    WHEN s.signal_type::text = 'eeoc_complaint_cluster'::text THEN 'PROC_VIOL'::text
                    WHEN s.signal_type::text = 'chain_verification_test'::text THEN 'TEST_SIGNAL'::text
                    ELSE 'UNKNOWN_UNCLASSIFIED'::text
                END AS canonical_signal_code,
                CASE
                    WHEN s.signal_type::text = 'benefit_access_gap'::text THEN 'access_gap'::text
                    WHEN s.signal_type::text = ANY (ARRAY['regulatory_comment_concentration'::character varying, 'industry_sector_concentration'::character varying]::text[]) THEN 'regulatory_concentration'::text
                    WHEN s.signal_type::text = ANY (ARRAY['classification_activity'::character varying, 'jurisdiction_legislative_activity'::character varying, 'new_statute_or_bill'::character varying]::text[]) THEN 'legislative_activity'::text
                    WHEN s.signal_type::text = ANY (ARRAY['court_activity'::character varying, 'jurisdiction_judicial_activity'::character varying, 'new_court_opinion'::character varying]::text[]) THEN 'judicial_activity'::text
                    WHEN s.signal_type::text = 'nonprofit_capacity_collapse'::text THEN 'civic_capacity'::text
                    WHEN s.signal_type::text = 'eeoc_complaint_cluster'::text THEN 'enforcement_complaint_cluster'::text
                    WHEN s.signal_type::text = 'chain_verification_test'::text THEN 'test_signal'::text
                    ELSE 'unknown_unclassified'::text
                END AS signal_family,
            s.geography_key::text AS geography_key,
            s.jurisdiction_raw_value,
            s.jurisdiction_id::text AS jurisdiction_id,
            s.entity_ids,
            s.source_table::text AS source_table,
            s.source_record_id::text AS source_record_id,
            s.source_connector_id::text AS source_connector_id,
            s.raw_record_id::text AS raw_record_id,
            s.statute_id::text AS statute_id,
            s.source_url,
            s.confidence_score,
            s.severity,
            s.severity_score::numeric AS severity_score,
            s.signal_status,
            s.verification_status,
            s.record_origin,
                CASE
                    WHEN s.signal_type::text = 'chain_verification_test'::text THEN true
                    ELSE COALESCE(s.exclude_from_production, false)
                END AS exclude_from_production,
                CASE
                    WHEN s.signal_type::text = 'chain_verification_test'::text THEN COALESCE(s.quarantine_reason, 'test_signal'::text)
                    ELSE s.quarantine_reason
                END AS quarantine_reason,
            COALESCE(s.evidence_payload, '{}'::jsonb) AS evidence_payload,
            COALESCE(s.metadata_json, '{}'::jsonb) AS metadata_json,
            COALESCE(s.provenance_metadata, '{}'::jsonb) AS provenance_metadata,
            s.detected_at,
            s.created_at
           FROM atlas.civic_map_signals s
        ), typed AS (
         SELECT sig.id::text AS signal_id,
            'atlas.signals'::text AS source_signal_table,
            COALESCE(st_1.type_code, 'UNKNOWN_UNCLASSIFIED'::text) AS raw_signal_type,
            COALESCE(st_1.type_code, 'UNKNOWN_UNCLASSIFIED'::text) AS canonical_signal_code,
            COALESCE(st_1.category, 'unknown'::text) AS signal_family,
            sig.source_jurisdiction AS geography_key,
            sig.source_jurisdiction AS jurisdiction_raw_value,
            NULL::text AS jurisdiction_id,
            NULL::text[] AS entity_ids,
            sig.source_table,
            sig.source_record_id::text AS source_record_id,
            NULL::text AS source_connector_id,
            sig.source_record_id::text AS raw_record_id,
            NULL::text AS statute_id,
            NULL::text AS source_url,
            sig.confidence::numeric AS confidence_score,
                CASE
                    WHEN sig.severity >= 90 THEN 'critical'::text
                    WHEN sig.severity >= 70 THEN 'high'::text
                    WHEN sig.severity >= 40 THEN 'medium'::text
                    ELSE 'low'::text
                END AS severity,
            sig.normalized_score::numeric AS severity_score,
                CASE
                    WHEN sig.is_suppressed THEN 'suppressed'::text
                    ELSE 'detected'::text
                END AS signal_status,
            'unknown'::text AS verification_status,
            'atlas_signal'::text AS record_origin,
            COALESCE(sig.is_suppressed, false) AS exclude_from_production,
            sig.suppression_reason AS quarantine_reason,
            COALESCE(sig.raw_value, '{}'::jsonb) AS evidence_payload,
            COALESCE(sig.metadata, '{}'::jsonb) AS metadata_json,
            jsonb_build_object('fingerprint_hash', sig.fingerprint_hash, 'source_domain', sig.source_domain, 'source_table', sig.source_table, 'source_record_id', sig.source_record_id) AS provenance_metadata,
            sig.detected_at,
            sig.created_at
           FROM atlas.signals sig
             LEFT JOIN atlas.signal_types st_1 ON st_1.id = sig.signal_type_id
        ), combined AS (
         SELECT civic.signal_id,
            civic.source_signal_table,
            civic.raw_signal_type,
            civic.canonical_signal_code,
            civic.signal_family,
            civic.geography_key,
            civic.jurisdiction_raw_value,
            civic.jurisdiction_id,
            civic.entity_ids,
            civic.source_table,
            civic.source_record_id,
            civic.source_connector_id,
            civic.raw_record_id,
            civic.statute_id,
            civic.source_url,
            civic.confidence_score,
            civic.severity,
            civic.severity_score,
            civic.signal_status,
            civic.verification_status,
            civic.record_origin,
            civic.exclude_from_production,
            civic.quarantine_reason,
            civic.evidence_payload,
            civic.metadata_json,
            civic.provenance_metadata,
            civic.detected_at,
            civic.created_at
           FROM civic
        UNION ALL
         SELECT typed.signal_id,
            typed.source_signal_table,
            typed.raw_signal_type,
            typed.canonical_signal_code,
            typed.signal_family,
            typed.geography_key,
            typed.jurisdiction_raw_value,
            typed.jurisdiction_id,
            typed.entity_ids,
            typed.source_table,
            typed.source_record_id,
            typed.source_connector_id,
            typed.raw_record_id,
            typed.statute_id,
            typed.source_url,
            typed.confidence_score,
            typed.severity,
            typed.severity_score,
            typed.signal_status,
            typed.verification_status,
            typed.record_origin,
            typed.exclude_from_production,
            typed.quarantine_reason,
            typed.evidence_payload,
            typed.metadata_json,
            typed.provenance_metadata,
            typed.detected_at,
            typed.created_at
           FROM typed
        )
 SELECT c.signal_id,
    c.source_signal_table,
    c.raw_signal_type,
    c.canonical_signal_code,
    COALESCE(st.type_name, initcap(replace(lower(c.canonical_signal_code), '_'::text, ' '::text))) AS canonical_signal_name,
    c.signal_family,
    COALESCE(st.category, c.signal_family, 'unknown'::text) AS signal_category,
    COALESCE(c.metadata_json ->> 'display_title'::text, c.metadata_json ->> 'title'::text, c.metadata_json ->> 'narrative_summary'::text, c.evidence_payload ->> 'title'::text, initcap(replace(c.raw_signal_type, '_'::text, ' '::text)) || COALESCE(' — '::text || NULLIF(c.geography_key, ''::text), ''::text)) AS display_title,
    COALESCE(c.metadata_json ->> 'display_summary'::text, c.metadata_json ->> 'narrative_summary'::text, c.metadata_json ->> 'summary'::text, c.evidence_payload ->> 'summary'::text, c.evidence_payload ->> 'description'::text, (('Pattern candidate from '::text || c.source_signal_table) || ' / '::text) || c.raw_signal_type) AS display_summary,
    c.geography_key,
    c.jurisdiction_raw_value,
    c.jurisdiction_id,
    c.entity_ids,
    c.source_table,
    c.source_record_id,
    c.source_connector_id,
    c.raw_record_id,
    c.statute_id,
    c.source_url,
    c.confidence_score,
    c.severity,
    c.severity_score,
    c.signal_status,
    c.verification_status,
    c.record_origin,
    c.exclude_from_production,
    c.quarantine_reason,
    c.evidence_payload,
    c.metadata_json,
    c.provenance_metadata,
    c.detected_at,
    c.created_at
   FROM combined c
     LEFT JOIN atlas.signal_types st ON st.type_code = c.canonical_signal_code;
create view "public"."benefits_wa" ("id", "name", "program_name", "address", "city", "state", "latitude", "longitude", "phone", "hours", "created_at") with (security_invoker=true) as
 SELECT office_id AS id,
    office_name AS name,
    program_type AS program_name,
    address_raw AS address,
    city,
    state,
    latitude,
    longitude,
    phone,
    hours,
    created_at
   FROM atlas.benefits_offices;
create view "public"."canonical_agency_authority" ("agency_id", "canonical_name", "aliases", "jurisdiction_id", "domains", "authority_source") with (security_invoker=true) as
 SELECT COALESCE(arc.agency_id, lower(replace(am.agency_name, ' '::text, '_'::text))) AS agency_id,
    COALESCE(arc.canonical_name, am.agency_name) AS canonical_name,
    COALESCE(arc.aliases, '[]'::jsonb) AS aliases,
    arc.jurisdiction_id,
    COALESCE(arc.domains, '[]'::jsonb) AS domains,
        CASE
            WHEN arc.agency_id IS NOT NULL THEN 'agency_registry_canonical'::text
            ELSE 'agency_metrics'::text
        END AS authority_source
   FROM agency_metrics am
     FULL JOIN agency_registry_canonical arc ON lower(am.agency_name) = lower(arc.canonical_name);
create view "public"."canonical_jurisdiction_authority" ("jurisdiction_id", "canonical_name", "abbreviation", "jurisdiction_type", "aliases", "active_status", "authority_source") with (security_invoker=true) as
 SELECT COALESCE(jr.jurisdiction_id, lower(j.geo_id)) AS jurisdiction_id,
    COALESCE(jr.canonical_name, j.geo_name) AS canonical_name,
    COALESCE(jr.abbreviation, j.geo_id) AS abbreviation,
    COALESCE(jr.jurisdiction_type, j.geo_type) AS jurisdiction_type,
    COALESCE(jr.aliases, '[]'::jsonb) AS aliases,
    COALESCE(jr.active_status, true) AS active_status,
        CASE
            WHEN jr.jurisdiction_id IS NOT NULL THEN 'jurisdictions_registry'::text
            ELSE 'jurisdictions'::text
        END AS authority_source
   FROM jurisdictions j
     FULL JOIN jurisdictions_registry jr ON lower(j.geo_id) = lower(jr.abbreviation);
create view "public"."civic_map_signals" ("id", "signal_type", "location", "geography_key", "score", "severity", "latitude", "longitude", "case_id", "description", "metadata_json", "source_table", "source_record_id", "detected_at", "created_at") with (security_invoker=true) as
 SELECT signal_id::text AS id,
    signal_type,
    metadata_json ->> 'city'::text AS location,
    geography_key,
    severity_score AS score,
        CASE
            WHEN severity_score >= 0.8 THEN 'High'::text
            WHEN severity_score >= 0.5 THEN 'Medium'::text
            ELSE 'Low'::text
        END AS severity,
    NULL::numeric AS latitude,
    NULL::numeric AS longitude,
    NULL::text AS case_id,
    metadata_json ->> 'description'::text AS description,
    metadata_json,
    source_table,
    source_record_id,
    detected_at,
    created_at
   FROM atlas.civic_map_signals;
create view "public"."entity_registry" ("id", "name", "entity_type", "address", "phone", "city", "latitude", "longitude", "is_active", "created_at") with (security_invoker=true) as
 SELECT entity_id AS id,
    primary_name AS name,
    entity_type,
    canonical_address AS address,
    canonical_phone AS phone,
    first_seen_jurisdiction AS city,
    NULL::numeric AS latitude,
    NULL::numeric AS longitude,
    is_active,
    created_at
   FROM atlas.entity_registry;
create view "public"."food_banks" ("id", "name", "address", "city", "state", "latitude", "longitude", "phone", "hours", "created_at") with (security_invoker=true) as
 SELECT pantry_id AS id,
    pantry_name AS name,
    address_raw AS address,
    city,
    state,
    latitude,
    longitude,
    phone,
    hours,
    created_at
   FROM atlas.food_banks;
create view "public"."nonprofits_wa" ("id", "name", "organization_name", "address", "city", "state", "latitude", "longitude", "phone", "created_at") with (security_invoker=true) as
 SELECT ein AS id,
    organization_name AS name,
    organization_name,
    address_raw AS address,
    city,
    state,
    NULL::numeric AS latitude,
    NULL::numeric AS longitude,
    phone,
    created_at
   FROM atlas.nonprofit_registry;
create view "public"."v_atlas_canonical_signal_type_summary_v1" ("signal_type_code", "signal_type_name", "category", "detection_method", "source_domain", "source_table", "signal_count", "fingerprinted_signal_count", "suppressed_signal_count", "receipted_signal_count", "extraction_receipt_count", "mean_normalized_score", "mean_confidence", "first_detected_at", "latest_detected_at") with (security_invoker=true) as
 WITH extraction_receipts AS (
         SELECT extraction.signal_id,
            count(*) AS extraction_receipt_count
           FROM atlas.signal_extractions extraction
          GROUP BY extraction.signal_id
        )
 SELECT type.type_code AS signal_type_code,
    type.type_name AS signal_type_name,
    type.category,
    type.detection_method,
    signal.source_domain,
    signal.source_table,
    count(*) AS signal_count,
    count(*) FILTER (WHERE signal.fingerprint_hash IS NOT NULL) AS fingerprinted_signal_count,
    count(*) FILTER (WHERE signal.is_suppressed) AS suppressed_signal_count,
    count(*) FILTER (WHERE COALESCE(receipt.extraction_receipt_count, 0::bigint) > 0) AS receipted_signal_count,
    COALESCE(sum(receipt.extraction_receipt_count), 0::numeric)::bigint AS extraction_receipt_count,
    round(avg(signal.normalized_score), 6) AS mean_normalized_score,
    round(avg(signal.confidence), 6) AS mean_confidence,
    min(signal.detected_at) AS first_detected_at,
    max(signal.detected_at) AS latest_detected_at
   FROM atlas.signals signal
     JOIN atlas.signal_types type ON type.id = signal.signal_type_id
     LEFT JOIN extraction_receipts receipt ON receipt.signal_id = signal.id
  WHERE signal.is_suppressed IS FALSE
  GROUP BY type.type_code, type.type_name, type.category, type.detection_method, signal.source_domain, signal.source_table;
create view "public"."v_atlas_convergence_run_summary_v1" ("run_key", "engine_version", "as_of", "time_window_ms", "temporal_bucket_ms", "geography_registry_version", "analysis_registry_hash", "analysis_level", "rule_manifest_hash", "configuration_hash", "source_population_hash", "transformed_population_hash", "deduplicated_population_hash", "total_source_rows", "transformed_signal_count", "deduplicated_signal_count", "total_geographies", "receipt_count", "detected_convergence_count", "resolved_receipt_count", "unresolved_receipt_count", "output_hash", "persisted_at") with (security_invoker=true) as
 SELECT manifest.run_key,
    manifest.engine_version,
    manifest.as_of,
    manifest.time_window_ms,
    manifest.temporal_bucket_ms,
    manifest.geography_registry_version,
    manifest.analysis_registry_hash,
    manifest.analysis_level,
    manifest.rule_manifest_hash,
    manifest.configuration_hash,
    manifest.source_population_hash,
    manifest.transformed_population_hash,
    manifest.deduplicated_population_hash,
    manifest.total_source_rows,
    manifest.total_signals_raw AS transformed_signal_count,
    manifest.total_signals_deduplicated AS deduplicated_signal_count,
    manifest.total_geographies,
    manifest.receipt_count,
    COALESCE(receipt.detected_convergence_count, 0::bigint) AS detected_convergence_count,
    COALESCE(receipt.resolved_receipt_count, 0::bigint) AS resolved_receipt_count,
    COALESCE(receipt.unresolved_receipt_count, 0::bigint) AS unresolved_receipt_count,
    manifest.output_hash,
    manifest.persisted_at
   FROM atlas.convergence_run_manifest manifest
     LEFT JOIN LATERAL ( SELECT count(*) FILTER (WHERE item.convergence_detected) AS detected_convergence_count,
            count(*) FILTER (WHERE item.status = 'resolved'::text) AS resolved_receipt_count,
            count(*) FILTER (WHERE item.status <> 'resolved'::text) AS unresolved_receipt_count
           FROM atlas.convergence_receipt item
          WHERE item.run_key = manifest.run_key) receipt ON true;
create view "public"."v_atlas_entity_resolution_aliases_v1" ("alias_id", "entity_id", "alias_text", "alias_type", "source_jurisdiction", "source_system", "confidence_score", "created_at") as
 SELECT alias_id,
    entity_id,
    alias_text,
    alias_type,
    source_jurisdiction,
    source_system,
    confidence_score,
    created_at
   FROM atlas.entity_aliases
  WHERE alias_type::text IS DISTINCT FROM 'fuzzy_match'::text AND confidence_score = 1.00;
create view "public"."v_atlas_entity_resolution_registry_v1" ("entity_id", "entity_type", "primary_name", "name_variants", "source_systems", "source_population_id", "source_population_table", "source_external_id", "metadata", "is_active", "last_verified") as
 SELECT entity_id,
    entity_type,
    primary_name,
    name_variants,
    source_systems,
    source_population_id,
    source_population_table,
    source_external_id,
    metadata,
    is_active,
    last_verified
   FROM atlas.entity_registry
  WHERE is_active IS DISTINCT FROM false;
create view "public"."v_atlas_error_summary" ("connector", "status", "records_failed", "fatal_error", "started_at", "completed_at") with (security_invoker=true) as
 SELECT c.name AS connector,
    j.status,
    j.records_failed,
    j.error_log ->> 'fatal'::text AS fatal_error,
    j.started_at,
    j.completed_at
   FROM ingest_jobs j
     JOIN connector_registry c ON j.connector_id = c.id
  WHERE j.started_at > (now() - '24:00:00'::interval) AND (j.status::text = 'failed'::text OR j.status::text = 'partial'::text OR j.records_failed > 0)
  ORDER BY j.started_at DESC;
create view "public"."v_atlas_event_entity_resolution_coverage_v1" ("stream_id", "resolution_status", "resolution_count", "event_count", "latest_resolved_at", "latest_resolver_version") as
 SELECT stream_id,
    resolution_status,
    count(*) AS resolution_count,
    count(DISTINCT ROW(stream_id, event_offset)) AS event_count,
    max(resolved_at) AS latest_resolved_at,
    max(resolver_version) AS latest_resolver_version
   FROM atlas.signal_event_entity_resolution
  WHERE is_current = true
  GROUP BY stream_id, resolution_status;
create view "public"."v_atlas_event_entity_resolution_review_v1" ("review_key", "resolution_status", "rule_id", "rule_version", "entity_role", "expected_entity_type", "normalized_entity_value", "source_identifier_type", "normalized_identifier_value", "sample_source_entity_value", "sample_source_identifier_value", "event_count", "stream_count", "stream_ids", "source_fields", "candidate_sets", "first_event_at", "latest_event_at", "rule_manifest_hash", "entity_index_hash", "resolver_id", "resolver_version") as
 SELECT encode(extensions.digest(concat_ws(chr(31), resolution_status, rule_id, rule_version, rule_manifest_hash, entity_role, COALESCE(normalized_entity_value, ''::text), COALESCE(source_identifier_type, ''::text), COALESCE(normalized_identifier_value, ''::text), COALESCE(expected_entity_type, ''::text), resolver_id, resolver_version, entity_index_hash), 'sha256'::text), 'hex'::text) AS review_key,
    resolution_status,
    rule_id,
    rule_version,
    entity_role,
    expected_entity_type,
    normalized_entity_value,
    source_identifier_type,
    normalized_identifier_value,
    min(source_entity_value) FILTER (WHERE source_entity_value IS NOT NULL) AS sample_source_entity_value,
    min(source_identifier_value) FILTER (WHERE source_identifier_value IS NOT NULL) AS sample_source_identifier_value,
    count(DISTINCT ROW(stream_id, event_offset)) AS event_count,
    count(DISTINCT stream_id) AS stream_count,
    array_agg(DISTINCT stream_id ORDER BY stream_id) AS stream_ids,
    array_agg(DISTINCT source_field ORDER BY source_field) AS source_fields,
    jsonb_agg(DISTINCT to_jsonb(candidate_entity_ids) ORDER BY (to_jsonb(candidate_entity_ids))) AS candidate_sets,
    min(event_timestamp) AS first_event_at,
    max(event_timestamp) AS latest_event_at,
    rule_manifest_hash,
    entity_index_hash,
    resolver_id,
    resolver_version
   FROM atlas.signal_event_entity_resolution r
  WHERE is_current = true AND (resolution_status = ANY (ARRAY['ambiguous'::text, 'unresolved'::text]))
  GROUP BY resolution_status, rule_id, rule_version, entity_role, expected_entity_type, normalized_entity_value, source_identifier_type, normalized_identifier_value, rule_manifest_hash, entity_index_hash, resolver_id, resolver_version;
create view "public"."v_atlas_health_dashboard" ("connector_name", "schema_name", "target_table", "auth_type", "required_secret", "active", "last_run_at", "next_run_at", "last_job_status", "last_fetched", "last_inserted", "last_failed", "last_completed", "health_status", "hours_since_last_run") with (security_invoker=true) as
 SELECT c.name AS connector_name,
    s.name AS schema_name,
    s.target_table,
    c.auth_type,
        CASE
            WHEN (c.auth_config ->> 'env_var'::text) IS NOT NULL THEN c.auth_config ->> 'env_var'::text
            ELSE NULL::text
        END AS required_secret,
    c.active,
    c.last_run_at,
    c.next_run_at,
    j.status AS last_job_status,
    j.records_fetched AS last_fetched,
    j.records_inserted AS last_inserted,
    j.records_failed AS last_failed,
    j.completed_at AS last_completed,
        CASE
            WHEN NOT c.active THEN 'disabled'::text
            WHEN c.last_run_at IS NULL THEN 'never_run'::text
            WHEN j.status::text = 'failed'::text THEN 'failed'::text
            WHEN j.status::text = 'partial'::text THEN 'partial_failure'::text
            WHEN j.completed_at < (now() - '7 days'::interval) THEN 'stale'::text
            WHEN j.records_failed > 0 THEN 'degraded'::text
            ELSE 'healthy'::text
        END AS health_status,
    EXTRACT(epoch FROM now() - c.last_run_at) / 3600::numeric AS hours_since_last_run
   FROM connector_registry c
     LEFT JOIN schema_registry s ON c.schema_id = s.id
     LEFT JOIN LATERAL ( SELECT ingest_jobs.id,
            ingest_jobs.connector_id,
            ingest_jobs.schema_id,
            ingest_jobs.status,
            ingest_jobs.started_at,
            ingest_jobs.completed_at,
            ingest_jobs.records_fetched,
            ingest_jobs.records_inserted,
            ingest_jobs.records_updated,
            ingest_jobs.records_failed,
            ingest_jobs.records_deduplicated,
            ingest_jobs.next_cursor,
            ingest_jobs.error_log,
            ingest_jobs.metadata
           FROM ingest_jobs
          WHERE ingest_jobs.connector_id = c.id
          ORDER BY ingest_jobs.started_at DESC
         LIMIT 1) j ON true
  ORDER BY c.name;
create view "public"."v_atlas_jurisdiction_coverage" ("jurisdiction", "type", "state_fips", "statutes_count", "case_law_count", "resources_count", "coverage_status") with (security_invoker=true) as
 SELECT j.geo_name AS jurisdiction,
    j.geo_type AS type,
    j.state_fips,
    count(DISTINCT s.id) AS statutes_count,
    count(DISTINCT cl.id) AS case_law_count,
    count(DISTINCT r.id) AS resources_count,
        CASE
            WHEN count(DISTINCT s.id) > 0 AND count(DISTINCT cl.id) > 0 THEN 'full'::text
            WHEN count(DISTINCT s.id) > 0 OR count(DISTINCT cl.id) > 0 THEN 'partial'::text
            ELSE 'none'::text
        END AS coverage_status
   FROM jurisdictions j
     LEFT JOIN statutes s ON s.jurisdiction_id = j.id
     LEFT JOIN case_law cl ON cl.jurisdiction_id = j.id
     LEFT JOIN civic_map_resources r ON r.state = j.state_fips
  GROUP BY j.id, j.geo_name, j.geo_type, j.state_fips
  ORDER BY j.geo_type, j.geo_name;
create view "public"."v_atlas_observation_type_summary_v1" ("stream_id", "observation_classification", "module_hint", "jurisdiction_id", "observation_count", "identity_bound_observation_count", "first_observed_at", "latest_observed_at", "latest_ingested_at") with (security_invoker=true) as
 SELECT stream_id,
    signal_type AS observation_classification,
    module_hint,
    jurisdiction_id,
    count(*) AS observation_count,
    count(event_identity_hash) AS identity_bound_observation_count,
    min("timestamp") AS first_observed_at,
    max("timestamp") AS latest_observed_at,
    max(ingested_at) AS latest_ingested_at
   FROM signal_events event
  GROUP BY stream_id, signal_type, module_hint, jurisdiction_id;
create view "public"."v_atlas_processing_queue" ("connector", "process_status", "record_count", "oldest_record", "newest_record") with (security_invoker=true) as
 SELECT c.name AS connector,
    rr.process_status,
    count(*) AS record_count,
    min(rr.fetch_timestamp) AS oldest_record,
    max(rr.fetch_timestamp) AS newest_record
   FROM raw_records rr
     JOIN connector_registry c ON rr.connector_id = c.id
  GROUP BY c.name, rr.process_status
  ORDER BY c.name, rr.process_status;
create view "public"."v_atlas_resolved_signal_event_entities_v1" ("stream_id", "event_offset", "event_timestamp", "signal_type", "source_id", "jurisdiction_id", "module_hint", "entity_role", "entity_id", "canonical_entity_name", "canonical_entity_type", "rule_id", "rule_version", "match_method", "resolution_hash", "resolver_id", "resolver_version", "entity_index_hash", "spacetime", "provenance", "payload") as
 SELECT r.stream_id,
    r.event_offset,
    r.event_timestamp,
    r.signal_type,
    r.source_id,
    r.jurisdiction_id,
    r.module_hint,
    r.entity_role,
    r.entity_id,
    er.primary_name AS canonical_entity_name,
    er.entity_type AS canonical_entity_type,
    r.rule_id,
    r.rule_version,
    r.match_method,
    r.resolution_hash,
    r.resolver_id,
    r.resolver_version,
    r.entity_index_hash,
    se.spacetime,
    se.provenance,
    se.payload
   FROM atlas.signal_event_entity_resolution r
     JOIN atlas.entity_registry er ON er.entity_id::text = r.entity_id::text
     JOIN signal_events se ON se.stream_id = r.stream_id AND se."offset" = r.event_offset
  WHERE r.is_current = true AND r.resolution_status = 'resolved'::text;
create view "public"."v_atlas_secrets_checklist" ("secret_name", "source_name", "auth_type", "status", "base_url") with (security_invoker=true) as
 SELECT DISTINCT auth_config ->> 'env_var'::text AS secret_name,
    name AS source_name,
    auth_type,
        CASE
            WHEN active AND last_run_at IS NOT NULL THEN 'live'::text
            WHEN active AND last_run_at IS NULL THEN 'configured'::text
            WHEN NOT active THEN 'not_started'::text
            ELSE NULL::text
        END AS status,
    api_base_url AS base_url
   FROM connector_registry c
  WHERE (auth_config ->> 'env_var'::text) IS NOT NULL
  ORDER BY (auth_config ->> 'env_var'::text);
create view "public"."v_atlas_signal_candidate_detail_v1" ("candidate_id", "candidate_hash", "rule_id", "rule_version", "rule_contract_hash", "engine_id", "engine_version", "signal_type", "title", "description", "primary_stream_id", "source_event_refs", "entity_ids", "entity_resolution_status", "jurisdiction_id", "severity", "confidence_score", "verification_state", "supporting_statistics", "evidence_refs", "source_freshness_at", "detected_at", "source_input_hash", "lighthouse_status", "lighthouse_record_id", "lighthouse_bridged_at", "semantic_key", "is_current", "supersedes_candidate_id", "retired_at", "first_detected_at", "last_replayed_at", "first_run_id", "last_run_id", "lighthouse_last_error") with (security_invoker=true) as
 SELECT candidate_id,
    candidate_hash,
    rule_id,
    rule_version,
    rule_contract_hash,
    engine_id,
    engine_version,
    signal_type,
    title,
    description,
    primary_stream_id,
    source_event_refs,
    entity_ids,
    entity_resolution_status,
    jurisdiction_id,
    severity,
    confidence_score,
    verification_state,
    supporting_statistics,
    evidence_refs,
    source_freshness_at,
    detected_at,
    source_input_hash,
    lighthouse_status,
    lighthouse_record_id,
    lighthouse_bridged_at,
    semantic_key,
    is_current,
    supersedes_candidate_id,
    retired_at,
    first_detected_at,
    last_replayed_at,
    first_run_id,
    last_run_id,
    lighthouse_last_error
   FROM atlas.live_data_signal_candidate candidate;
create view "public"."v_atlas_signal_candidate_rule_summary_v1" ("rule_id", "rule_version", "signal_type", "engine_id", "engine_version", "rule_contract_hash", "rule_contract", "is_active", "candidate_count", "verified_candidate_count", "bridged_candidate_count", "pending_candidate_count", "failed_candidate_count", "first_detected_at", "latest_detected_at") with (security_invoker=true) as
 SELECT rule.rule_id,
    rule.rule_version,
    rule.signal_type,
    rule.engine_id,
    rule.engine_version,
    rule.rule_contract_hash,
    rule.rule_contract,
    rule.is_active,
    count(candidate.candidate_id) AS candidate_count,
    count(candidate.candidate_id) FILTER (WHERE candidate.verification_state = 'verified'::text) AS verified_candidate_count,
    count(candidate.candidate_id) FILTER (WHERE candidate.lighthouse_status = 'bridged'::text) AS bridged_candidate_count,
    count(candidate.candidate_id) FILTER (WHERE candidate.lighthouse_status = 'pending'::text) AS pending_candidate_count,
    count(candidate.candidate_id) FILTER (WHERE candidate.lighthouse_status = 'failed'::text) AS failed_candidate_count,
    min(candidate.first_detected_at) AS first_detected_at,
    max(candidate.detected_at) AS latest_detected_at
   FROM atlas.live_data_signal_rule rule
     LEFT JOIN atlas.live_data_signal_candidate candidate ON candidate.rule_id = rule.rule_id AND candidate.rule_version = rule.rule_version AND candidate.is_current IS TRUE
  GROUP BY rule.rule_id, rule.rule_version, rule.signal_type, rule.engine_id, rule.engine_version, rule.rule_contract_hash, rule.rule_contract, rule.is_active;
create view "public"."v_atlas_signal_event_entity_resolution_v1" ("resolution_id", "stream_id", "event_offset", "event_timestamp", "signal_type", "source_id", "jurisdiction_id", "module_hint", "rule_id", "rule_version", "candidate_key", "entity_role", "source_field", "source_field_value", "source_entity_value", "normalized_entity_value", "source_identifier_field", "source_identifier_type", "source_identifier_value", "normalized_identifier_value", "expected_entity_type", "entity_id", "canonical_entity_name", "canonical_entity_type", "resolution_status", "match_method", "candidate_entity_ids", "match_evidence", "event_input_hash", "entity_index_hash", "rule_manifest_hash", "resolution_hash", "resolver_id", "resolver_version", "first_run_id", "last_run_id", "resolved_at", "last_replayed_at") as
 SELECT r.resolution_id,
    r.stream_id,
    r.event_offset,
    r.event_timestamp,
    r.signal_type,
    r.source_id,
    r.jurisdiction_id,
    r.module_hint,
    r.rule_id,
    r.rule_version,
    r.candidate_key,
    r.entity_role,
    r.source_field,
    r.source_field_value,
    r.source_entity_value,
    r.normalized_entity_value,
    r.source_identifier_field,
    r.source_identifier_type,
    r.source_identifier_value,
    r.normalized_identifier_value,
    r.expected_entity_type,
    r.entity_id,
    er.primary_name AS canonical_entity_name,
    er.entity_type AS canonical_entity_type,
    r.resolution_status,
    r.match_method,
    r.candidate_entity_ids,
    r.match_evidence,
    r.event_input_hash,
    r.entity_index_hash,
    r.rule_manifest_hash,
    r.resolution_hash,
    r.resolver_id,
    r.resolver_version,
    r.first_run_id,
    r.last_run_id,
    r.resolved_at,
    r.last_replayed_at
   FROM atlas.signal_event_entity_resolution r
     LEFT JOIN atlas.entity_registry er ON er.entity_id::text = r.entity_id::text
  WHERE r.is_current = true;
create view "public"."v_atlas_signal_substrate_summary_v1" ("registered_streams", "active_streams", "signal_events", "identity_bound_events", "signal_types", "producing_streams", "latest_signal_at", "latest_ingested_at", "prime_patterns", "latest_pattern_at", "investigative_jobs", "failed_investigative_jobs", "action_receipts", "observed_at") with (security_invoker=true) as
 SELECT ( SELECT count(*) AS count
           FROM streams) AS registered_streams,
    ( SELECT count(*) AS count
           FROM streams
          WHERE streams.status = 'active'::text) AS active_streams,
    ( SELECT count(*) AS count
           FROM signal_events) AS signal_events,
    ( SELECT count(signal_events.event_identity_hash) AS count
           FROM signal_events) AS identity_bound_events,
    ( SELECT count(DISTINCT signal_events.signal_type) AS count
           FROM signal_events) AS signal_types,
    ( SELECT count(DISTINCT signal_events.stream_id) AS count
           FROM signal_events) AS producing_streams,
    ( SELECT max(signal_events."timestamp") AS max
           FROM signal_events) AS latest_signal_at,
    ( SELECT max(signal_events.ingested_at) AS max
           FROM signal_events) AS latest_ingested_at,
    ( SELECT count(*) AS count
           FROM prime_patterns) AS prime_patterns,
    ( SELECT max(prime_patterns.detected_at) AS max
           FROM prime_patterns) AS latest_pattern_at,
    ( SELECT count(*) AS count
           FROM investigative_jobs) AS investigative_jobs,
    ( SELECT count(*) AS count
           FROM investigative_jobs
          WHERE investigative_jobs.status = 'failed'::text) AS failed_investigative_jobs,
    ( SELECT count(*) AS count
           FROM atlas_action_receipt) AS action_receipts,
    now() AS observed_at;
create view "public"."v_atlas_signal_type_summary_v1" ("stream_id", "signal_type", "module_hint", "jurisdiction_id", "event_count", "identity_count", "first_event_at", "latest_event_at", "latest_ingested_at") with (security_invoker=true) as
 SELECT stream_id,
    signal_type,
    module_hint,
    jurisdiction_id,
    count(*) AS event_count,
    count(event_identity_hash) AS identity_count,
    min("timestamp") AS first_event_at,
    max("timestamp") AS latest_event_at,
    max(ingested_at) AS latest_ingested_at
   FROM signal_events event
  GROUP BY stream_id, signal_type, module_hint, jurisdiction_id;
create view "public"."v_atlas_source_inventory" ("connector_id", "source_name", "schema_name", "target_table", "adapter_class", "auth_type", "required_secret_name", "base_url", "rate_limit_rpm", "pagination_type", "refresh_cadence", "jurisdiction_filter", "connector_status", "is_active", "required_fields", "external_id_field") with (security_invoker=true) as
 SELECT c.id AS connector_id,
    c.name AS source_name,
    s.name AS schema_name,
    s.target_table,
    c.adapter_class,
    c.auth_type,
    c.auth_config ->> 'env_var'::text AS required_secret_name,
    c.api_base_url AS base_url,
    c.rate_limit_rpm,
    c.pagination_type,
    c.schedule_cron AS refresh_cadence,
    c.jurisdiction_filter,
        CASE
            WHEN c.active AND c.last_run_at IS NOT NULL THEN 'live'::text
            WHEN c.active AND c.last_run_at IS NULL THEN 'configured'::text
            WHEN NOT c.active THEN 'not_started'::text
            ELSE NULL::text
        END AS connector_status,
    c.active AS is_active,
    s.validation_rules ->> 'required'::text AS required_fields,
    s.field_mappings ->> 'external_id'::text AS external_id_field
   FROM connector_registry c
     LEFT JOIN schema_registry s ON c.schema_id = s.id
  ORDER BY (
        CASE c.auth_type
            WHEN 'api_key'::text THEN 1
            WHEN 'bearer'::text THEN 2
            WHEN 'oauth'::text THEN 3
            WHEN 'none'::text THEN 4
            ELSE NULL::integer
        END), c.name;
create view "public"."v_atlas_source_operational_readiness_v1" ("connector_id", "source_name", "adapter_class", "connector_active", "last_run_at", "next_run_at", "schema_id", "schema_name", "schema_version", "schema_active", "health_event_id", "health_observed_at", "health_status", "freshness_status", "schema_status", "latency_ms", "error_rate", "duplicate_rate", "missing_required_field_rate", "records_observed", "source_state_hash", "ingest_job_id", "ingest_status", "ingest_started_at", "ingest_completed_at", "records_fetched", "records_inserted", "records_updated", "records_failed", "records_deduplicated", "active_fallback_count", "operational_readiness_state") with (security_invoker=true) as
 WITH latest_health AS (
         SELECT DISTINCT ON (h_1.connector_id) h_1.connector_id,
            h_1.health_event_id,
            h_1.observed_at AS health_observed_at,
            h_1.health_status,
            h_1.freshness_status,
            h_1.schema_status,
            h_1.latency_ms,
            h_1.error_rate,
            h_1.duplicate_rate,
            h_1.missing_required_field_rate,
            h_1.records_observed,
            h_1.source_state_hash
           FROM atlas_source_health_event h_1
          ORDER BY h_1.connector_id, h_1.observed_at DESC, h_1.health_event_id DESC
        ), latest_job AS (
         SELECT DISTINCT ON (j_1.connector_id) j_1.connector_id,
            j_1.id AS ingest_job_id,
            j_1.status AS ingest_status,
            j_1.started_at AS ingest_started_at,
            j_1.completed_at AS ingest_completed_at,
            j_1.records_fetched,
            j_1.records_inserted,
            j_1.records_updated,
            j_1.records_failed,
            j_1.records_deduplicated
           FROM ingest_jobs j_1
          ORDER BY j_1.connector_id, j_1.started_at DESC NULLS LAST, j_1.id DESC
        ), fallback_counts AS (
         SELECT f_1.connector_id,
            count(*) FILTER (WHERE f_1.active) AS active_fallback_count
           FROM atlas_source_fallback_binding f_1
          GROUP BY f_1.connector_id
        )
 SELECT c.id AS connector_id,
    c.name AS source_name,
    c.adapter_class,
    c.active AS connector_active,
    c.last_run_at,
    c.next_run_at,
    s.id AS schema_id,
    s.name AS schema_name,
    s.version AS schema_version,
    s.active AS schema_active,
    h.health_event_id,
    h.health_observed_at,
    h.health_status,
    h.freshness_status,
    h.schema_status,
    h.latency_ms,
    h.error_rate,
    h.duplicate_rate,
    h.missing_required_field_rate,
    h.records_observed,
    h.source_state_hash,
    j.ingest_job_id,
    j.ingest_status,
    j.ingest_started_at,
    j.ingest_completed_at,
    j.records_fetched,
    j.records_inserted,
    j.records_updated,
    j.records_failed,
    j.records_deduplicated,
    COALESCE(f.active_fallback_count, 0::bigint) AS active_fallback_count,
        CASE
            WHEN NOT c.active OR NOT COALESCE(s.active, false) THEN 'not_active'::text
            WHEN h.health_event_id IS NULL THEN 'unknown'::text
            WHEN h.health_status = ANY (ARRAY['failing'::text, 'paused'::text, 'retired'::text]) THEN 'blocked'::text
            WHEN h.schema_status = 'breaking_change'::text THEN 'blocked'::text
            WHEN h.health_status = 'healthy'::text AND h.freshness_status = 'fresh'::text AND h.schema_status = 'stable'::text THEN 'ready'::text
            ELSE 'degraded'::text
        END AS operational_readiness_state
   FROM connector_registry c
     LEFT JOIN schema_registry s ON s.id = c.schema_id
     LEFT JOIN latest_health h ON h.connector_id = c.id
     LEFT JOIN latest_job j ON j.connector_id = c.id
     LEFT JOIN fallback_counts f ON f.connector_id = c.id;
create view "public"."v_atlas_stream_runtime_summary_v1" ("stream_id", "source_id", "jurisdiction_id", "module_hint", "throughput_profile", "safety_profile", "governance_contract_id", "status", "created_at", "updated_at", "event_count", "identity_count", "signal_type_count", "first_event_at", "latest_event_at", "latest_ingested_at") with (security_invoker=true) as
 SELECT stream.stream_id,
    stream.source_id,
    stream.jurisdiction_id,
    stream.module_hint,
    stream.throughput_profile,
    stream.safety_profile,
    stream.governance_contract_id,
    stream.status,
    stream.created_at,
    stream.updated_at,
    event_summary.event_count,
    event_summary.identity_count,
    event_summary.signal_type_count,
    event_summary.first_event_at,
    event_summary.latest_event_at,
    event_summary.latest_ingested_at
   FROM streams stream
     CROSS JOIN LATERAL ( SELECT count(*) AS event_count,
            count(event.event_identity_hash) AS identity_count,
            count(DISTINCT event.signal_type) AS signal_type_count,
            min(event."timestamp") AS first_event_at,
            max(event."timestamp") AS latest_event_at,
            max(event.ingested_at) AS latest_ingested_at
           FROM signal_events event
          WHERE event.stream_id = stream.stream_id) event_summary;
create view "public"."v_blockers" ("id", "name", "record_type", "blocker_1", "blocker_2", "blocker_3", "blocker_4") with (security_invoker=true) as
 SELECT food_banks.pantry_id AS id,
    food_banks.pantry_name AS name,
    'food_bank'::text AS record_type,
        CASE
            WHEN food_banks.hours IS NULL OR food_banks.hours::text = ''::text THEN 'Missing hours'::text
            ELSE NULL::text
        END AS blocker_1,
        CASE
            WHEN food_banks.phone IS NULL OR food_banks.phone::text = ''::text THEN 'Missing phone'::text
            ELSE NULL::text
        END AS blocker_2,
        CASE
            WHEN food_banks.address_raw IS NULL OR food_banks.address_raw::text = ''::text THEN 'Missing address'::text
            ELSE NULL::text
        END AS blocker_3,
        CASE
            WHEN food_banks.latitude IS NULL OR food_banks.longitude IS NULL THEN 'Missing coordinates'::text
            ELSE NULL::text
        END AS blocker_4
   FROM atlas.food_banks
UNION ALL
 SELECT benefits_offices.office_id AS id,
    COALESCE(benefits_offices.office_name, benefits_offices.program_type) AS name,
    'benefits'::text AS record_type,
    NULL::text AS blocker_1,
        CASE
            WHEN benefits_offices.phone IS NULL OR benefits_offices.phone::text = ''::text THEN 'Missing phone'::text
            ELSE NULL::text
        END AS blocker_2,
        CASE
            WHEN benefits_offices.address_raw IS NULL OR benefits_offices.address_raw::text = ''::text THEN 'Missing address'::text
            ELSE NULL::text
        END AS blocker_3,
        CASE
            WHEN benefits_offices.latitude IS NULL OR benefits_offices.longitude IS NULL THEN 'Missing coordinates'::text
            ELSE NULL::text
        END AS blocker_4
   FROM atlas.benefits_offices
UNION ALL
 SELECT nonprofit_registry.ein AS id,
    nonprofit_registry.organization_name AS name,
    'nonprofit'::text AS record_type,
    NULL::text AS blocker_1,
        CASE
            WHEN nonprofit_registry.phone IS NULL OR nonprofit_registry.phone::text = ''::text THEN 'Missing phone'::text
            ELSE NULL::text
        END AS blocker_2,
        CASE
            WHEN nonprofit_registry.address_raw IS NULL OR nonprofit_registry.address_raw::text = ''::text THEN 'Missing address'::text
            ELSE NULL::text
        END AS blocker_3,
    'Missing coordinates'::text AS blocker_4
   FROM atlas.nonprofit_registry;
create view "public"."v_canonical_record_quality" ("id", "external_record_id", "record_name", "record_kind", "entity_type", "jurisdiction", "category", "registry_layer", "signal_families", "usefulness_status", "verification_status", "source_file", "source_anchor", "source_url", "phone_count", "email_count", "url_count", "address_count", "statute_count", "deadline_count", "verbatim_length", "created_at", "updated_at") with (security_invoker=true) as
 SELECT id,
    external_record_id,
    record_name,
    record_kind,
    entity_type,
    jurisdiction,
    category,
    registry_layer,
    signal_families,
    usefulness_status,
    verification_status,
    source_file,
    source_anchor,
    source_url,
    jsonb_array_count(contacts -> 'phones'::text) AS phone_count,
    jsonb_array_count(contacts -> 'emails'::text) AS email_count,
    jsonb_array_count(contacts -> 'urls'::text) AS url_count,
    jsonb_array_count(contacts -> 'addresses'::text) AS address_count,
    jsonb_array_count(legal_basis -> 'statutes'::text) AS statute_count,
    jsonb_array_count(legal_basis -> 'deadlines'::text) AS deadline_count,
    length(verbatim_text) AS verbatim_length,
    created_at,
    updated_at
   FROM canonical_extracted_records;
create view "public"."v_case_detail" ("case_id", "signal_count", "avg_score", "max_severity", "first_detected", "last_detected", "locations") with (security_invoker=true) as
 SELECT source_table AS case_id,
    count(*) AS signal_count,
    avg(severity_score) AS avg_score,
    max(
        CASE
            WHEN severity_score >= 0.8 THEN 'High'::text
            WHEN severity_score >= 0.5 THEN 'Medium'::text
            ELSE 'Low'::text
        END) AS max_severity,
    min(created_at) AS first_detected,
    max(created_at) AS last_detected,
    array_agg(DISTINCT COALESCE(metadata_json ->> 'city'::text, 'Unknown'::text)) AS locations
   FROM atlas.civic_map_signals
  GROUP BY source_table;
create view "public"."v_chronicle_verification_status" ("claim_id", "claim_type", "subject", "predicate", "object_value", "jurisdiction", "verification_status", "verification_score", "conflict_status", "created_at", "updated_at", "source_file", "source_type", "candidate_kind", "signal_families", "supporting_evidence_count", "contradicting_evidence_count", "promoted_to_chronicle") with (security_invoker=true) as
 SELECT vc.id AS claim_id,
    vc.claim_type,
    vc.subject,
    vc.predicate,
    vc.object_value,
    vc.jurisdiction,
    vc.verification_status,
    vc.verification_score,
    vc.conflict_status,
    vc.created_at,
    vc.updated_at,
    ec.source_file,
    ec.source_type,
    ec.candidate_kind,
    ec.signal_families,
    count(ve.id) FILTER (WHERE ve.supports_claim = true) AS supporting_evidence_count,
    count(ve.id) FILTER (WHERE ve.supports_claim = false) AS contradicting_evidence_count,
    (EXISTS ( SELECT 1
           FROM verified_chronicle ch
          WHERE ch.claim_id = vc.id)) AS promoted_to_chronicle
   FROM verification_claims vc
     LEFT JOIN extraction_candidates ec ON ec.id = vc.candidate_id
     LEFT JOIN verification_evidence ve ON ve.claim_id = vc.id
  GROUP BY vc.id, ec.id;
create view "public"."v_civic_map_signals_production" ("signal_id", "signal_type", "geography_key", "severity_score", "metadata_json", "source_table", "source_record_id", "detected_at", "created_at", "source_connector_id", "raw_record_id", "statute_id", "entity_ids", "jurisdiction_raw_value", "jurisdiction_id", "source_url", "confidence_score", "severity", "signal_status", "evidence_payload", "generation_method", "rule_id", "rule_version", "provenance_metadata", "signal_dedup_key", "record_origin", "verification_status", "exclude_from_production", "quarantine_reason") with (security_invoker=true) as
 SELECT signal_id,
    signal_type,
    geography_key,
    severity_score,
    metadata_json,
    source_table,
    source_record_id,
    detected_at,
    created_at,
    source_connector_id,
    raw_record_id,
    statute_id,
    entity_ids,
    jurisdiction_raw_value,
    jurisdiction_id,
    source_url,
    confidence_score,
    severity,
    signal_status,
    evidence_payload,
    generation_method,
    rule_id,
    rule_version,
    provenance_metadata,
    signal_dedup_key,
    record_origin,
    verification_status,
    exclude_from_production,
    quarantine_reason
   FROM atlas.civic_map_signals
  WHERE generation_method = 'deterministic_rule'::text AND verification_status = 'verified'::text AND exclude_from_production = false AND source_connector_id IS NOT NULL AND raw_record_id IS NOT NULL AND statute_id IS NOT NULL AND source_url IS NOT NULL;
create view "public"."v_civicmap_pins" ("id", "name", "address", "city", "state", "latitude", "longitude", "phone", "hours", "pin_type", "severity", "signal_type", "created_at") with (security_invoker=true) as
 SELECT food_banks.pantry_id AS id,
    food_banks.pantry_name AS name,
    food_banks.address_raw AS address,
    food_banks.city,
    food_banks.state,
    food_banks.latitude,
    food_banks.longitude,
    food_banks.phone,
    food_banks.hours,
    'food_bank'::text AS pin_type,
    NULL::text AS severity,
    NULL::text AS signal_type,
    food_banks.created_at
   FROM atlas.food_banks
  WHERE food_banks.latitude IS NOT NULL AND food_banks.longitude IS NOT NULL
UNION ALL
 SELECT benefits_offices.office_id AS id,
    COALESCE(benefits_offices.office_name, benefits_offices.program_type, 'Benefit Program'::character varying) AS name,
    benefits_offices.address_raw AS address,
    benefits_offices.city,
    benefits_offices.state,
    benefits_offices.latitude,
    benefits_offices.longitude,
    benefits_offices.phone,
    benefits_offices.hours,
    'benefits'::text AS pin_type,
    NULL::text AS severity,
    NULL::text AS signal_type,
    benefits_offices.created_at
   FROM atlas.benefits_offices
  WHERE benefits_offices.latitude IS NOT NULL AND benefits_offices.longitude IS NOT NULL
UNION ALL
 SELECT nonprofit_registry.ein AS id,
    COALESCE(nonprofit_registry.organization_name, 'Nonprofit'::character varying) AS name,
    nonprofit_registry.address_raw AS address,
    nonprofit_registry.city,
    nonprofit_registry.state,
    NULL::numeric AS latitude,
    NULL::numeric AS longitude,
    nonprofit_registry.phone,
    NULL::text AS hours,
    'nonprofit'::text AS pin_type,
    NULL::text AS severity,
    NULL::text AS signal_type,
    nonprofit_registry.created_at
   FROM atlas.nonprofit_registry
UNION ALL
 SELECT civic_map_signals.signal_id::text AS id,
    COALESCE(civic_map_signals.metadata_json ->> 'city'::text, 'Gap Cluster'::text) AS name,
    NULL::text AS address,
    civic_map_signals.metadata_json ->> 'city'::text AS city,
    NULL::text AS state,
    NULL::numeric AS latitude,
    NULL::numeric AS longitude,
    NULL::text AS phone,
    NULL::text AS hours,
    'signal'::text AS pin_type,
        CASE
            WHEN civic_map_signals.severity_score >= 0.8 THEN 'High'::text
            WHEN civic_map_signals.severity_score >= 0.5 THEN 'Medium'::text
            ELSE 'Low'::text
        END AS severity,
    civic_map_signals.signal_type,
    civic_map_signals.created_at
   FROM atlas.civic_map_signals;
create view "public"."v_judicial_map_signals_production" ("signal_id", "signal_type", "geography_key", "severity_score", "metadata_json", "source_table", "source_record_id", "detected_at", "created_at", "source_connector_id", "raw_record_id", "case_law_id", "entity_ids", "jurisdiction_raw_value", "jurisdiction_id", "source_url", "confidence_score", "severity", "signal_status", "evidence_payload", "generation_method", "rule_id", "rule_version", "provenance_metadata", "signal_dedup_key", "record_origin", "verification_status", "exclude_from_production", "quarantine_reason") with (security_invoker=true) as
 SELECT signal_id,
    signal_type,
    geography_key,
    severity_score,
    metadata_json,
    source_table,
    source_record_id,
    detected_at,
    created_at,
    source_connector_id,
    raw_record_id,
    source_record_id::uuid AS case_law_id,
    entity_ids,
    jurisdiction_raw_value,
    jurisdiction_id,
    source_url,
    confidence_score,
    severity,
    signal_status,
    evidence_payload,
    generation_method,
    rule_id,
    rule_version,
    provenance_metadata,
    signal_dedup_key,
    record_origin,
    verification_status,
    exclude_from_production,
    quarantine_reason
   FROM atlas.civic_map_signals
  WHERE generation_method = 'deterministic_rule'::text AND verification_status = 'verified'::text AND exclude_from_production = false AND source_connector_id = '41bd1e84-021c-448c-9683-13c35955eefc'::uuid AND raw_record_id IS NOT NULL AND source_table::text = 'case_law'::text AND source_record_id IS NOT NULL AND source_url IS NOT NULL AND signal_status = 'active'::text AND record_origin = 'live_api'::text;
create view "public"."v_unified_civic_infrastructure" ("unified_id", "canonical_resource_id", "resource_name", "organization_type", "jurisdiction", "domains", "website", "phone", "office_address", "filing_process", "filing_deadline", "statutory_authority", "verification_status", "created_at") with (security_invoker=true) as
 SELECT id::text AS unified_id,
    canonical_resource_id,
    organization_name AS resource_name,
    organization_type,
    jurisdiction,
    domains,
    website,
    phone,
    office_address,
    filing_process,
    filing_deadline,
    statutory_authority,
    verification_status,
    created_at
   FROM civic_infrastructure_nodes;
create view "public"."workflow_overlay_view" ("workflow_id", "workflow_category", "jurisdiction_id", "jurisdiction_name", "trigger_conditions", "escalation_paths") with (security_invoker=true) as
 SELECT w.workflow_id,
    w.workflow_category,
    j.jurisdiction_id,
    j.canonical_name AS jurisdiction_name,
    w.trigger_conditions,
    w.escalation_paths
   FROM workflow_registry w
     CROSS JOIN jurisdictions_registry j
  WHERE j.active_status = true;
create view "public"."v_actionable_canonical_records" ("id", "external_record_id", "record_name", "record_kind", "entity_type", "jurisdiction", "category", "registry_layer", "signal_families", "usefulness_status", "verification_status", "source_file", "source_anchor", "source_url", "phone_count", "email_count", "url_count", "address_count", "statute_count", "deadline_count", "verbatim_length", "created_at", "updated_at") with (security_invoker=true) as
 SELECT id,
    external_record_id,
    record_name,
    record_kind,
    entity_type,
    jurisdiction,
    category,
    registry_layer,
    signal_families,
    usefulness_status,
    verification_status,
    source_file,
    source_anchor,
    source_url,
    phone_count,
    email_count,
    url_count,
    address_count,
    statute_count,
    deadline_count,
    verbatim_length,
    created_at,
    updated_at
   FROM v_canonical_record_quality
  WHERE usefulness_status = 'useful'::text;
create view "public"."v_atlas_data_freshness" ("table_name", "total_records", "last_update", "oldest_record", "records_last_24h", "records_last_7d") with (security_invoker=true) as
 SELECT 'statutes'::text AS table_name,
    count(*) AS total_records,
    max(statutes.updated_at) AS last_update,
    min(statutes.updated_at) AS oldest_record,
    count(*) FILTER (WHERE statutes.updated_at > (now() - '24:00:00'::interval)) AS records_last_24h,
    count(*) FILTER (WHERE statutes.updated_at > (now() - '7 days'::interval)) AS records_last_7d
   FROM statutes
UNION ALL
 SELECT 'case_law'::text AS table_name,
    count(*) AS total_records,
    max(case_law.updated_at) AS last_update,
    min(case_law.updated_at) AS oldest_record,
    count(*) FILTER (WHERE case_law.updated_at > (now() - '24:00:00'::interval)) AS records_last_24h,
    count(*) FILTER (WHERE case_law.updated_at > (now() - '7 days'::interval)) AS records_last_7d
   FROM case_law
UNION ALL
 SELECT 'entity_registry'::text AS table_name,
    count(*) AS total_records,
    max(entity_registry.created_at) AS last_update,
    min(entity_registry.created_at) AS oldest_record,
    count(*) FILTER (WHERE entity_registry.created_at > (now() - '24:00:00'::interval)) AS records_last_24h,
    count(*) FILTER (WHERE entity_registry.created_at > (now() - '7 days'::interval)) AS records_last_7d
   FROM entity_registry
UNION ALL
 SELECT 'civic_map_signals'::text AS table_name,
    count(*) AS total_records,
    max(civic_map_signals.detected_at) AS last_update,
    min(civic_map_signals.detected_at) AS oldest_record,
    count(*) FILTER (WHERE civic_map_signals.detected_at > (now() - '24:00:00'::interval)) AS records_last_24h,
    count(*) FILTER (WHERE civic_map_signals.detected_at > (now() - '7 days'::interval)) AS records_last_7d
   FROM civic_map_signals;
create view "public"."v_atlas_entity_cross_stream_summary_v1" ("entity_id", "canonical_entity_name", "canonical_entity_type", "resolved_event_count", "stream_count", "stream_ids", "signal_type_count", "signal_types", "first_event_at", "latest_event_at") as
 SELECT entity_id,
    canonical_entity_name,
    canonical_entity_type,
    count(DISTINCT ROW(stream_id, event_offset)) AS resolved_event_count,
    count(DISTINCT stream_id) AS stream_count,
    array_agg(DISTINCT stream_id ORDER BY stream_id) AS stream_ids,
    count(DISTINCT signal_type) AS signal_type_count,
    array_agg(DISTINCT signal_type ORDER BY signal_type) AS signal_types,
    min(event_timestamp) AS first_event_at,
    max(event_timestamp) AS latest_event_at
   FROM v_atlas_resolved_signal_event_entities_v1
  GROUP BY entity_id, canonical_entity_name, canonical_entity_type;
create view "public"."v_atlas_signal_derivation_summary_v1" ("normalized_observations", "identity_bound_observations", "observation_classifications", "streams_with_observations", "latest_observation_at", "latest_observation_ingested_at", "canonical_signals", "canonical_signal_types", "receipted_canonical_signals", "unreceipted_canonical_signals", "signal_extraction_receipts", "latest_canonical_signal_at", "signal_candidates", "verified_signal_candidates", "bridged_signal_candidates", "pending_signal_candidates", "signal_rule_versions", "active_signal_rules", "latest_signal_candidate_at", "convergence_runs", "convergence_receipts", "convergence_events", "latest_convergence_run_key", "latest_convergence_source_rows", "latest_convergence_transformed_signals", "latest_convergence_deduplicated_signals", "latest_detected_convergences", "latest_convergence_at", "legacy_investigation_outputs", "stream_health_alerts", "non_health_legacy_patterns", "legacy_investigation_jobs", "observed_at", "legacy_suppressed_canonical_signals", "historical_signal_candidate_versions", "signal_candidate_semantic_patterns", "failed_signal_candidates") with (security_invoker=true) as
 WITH latest_convergence AS (
         SELECT v_atlas_convergence_run_summary_v1.run_key,
            v_atlas_convergence_run_summary_v1.engine_version,
            v_atlas_convergence_run_summary_v1.as_of,
            v_atlas_convergence_run_summary_v1.time_window_ms,
            v_atlas_convergence_run_summary_v1.temporal_bucket_ms,
            v_atlas_convergence_run_summary_v1.geography_registry_version,
            v_atlas_convergence_run_summary_v1.analysis_registry_hash,
            v_atlas_convergence_run_summary_v1.analysis_level,
            v_atlas_convergence_run_summary_v1.rule_manifest_hash,
            v_atlas_convergence_run_summary_v1.configuration_hash,
            v_atlas_convergence_run_summary_v1.source_population_hash,
            v_atlas_convergence_run_summary_v1.transformed_population_hash,
            v_atlas_convergence_run_summary_v1.deduplicated_population_hash,
            v_atlas_convergence_run_summary_v1.total_source_rows,
            v_atlas_convergence_run_summary_v1.transformed_signal_count,
            v_atlas_convergence_run_summary_v1.deduplicated_signal_count,
            v_atlas_convergence_run_summary_v1.total_geographies,
            v_atlas_convergence_run_summary_v1.receipt_count,
            v_atlas_convergence_run_summary_v1.detected_convergence_count,
            v_atlas_convergence_run_summary_v1.resolved_receipt_count,
            v_atlas_convergence_run_summary_v1.unresolved_receipt_count,
            v_atlas_convergence_run_summary_v1.output_hash,
            v_atlas_convergence_run_summary_v1.persisted_at
           FROM v_atlas_convergence_run_summary_v1
          ORDER BY v_atlas_convergence_run_summary_v1.persisted_at DESC, v_atlas_convergence_run_summary_v1.run_key
         LIMIT 1
        )
 SELECT ( SELECT count(*) AS count
           FROM signal_events) AS normalized_observations,
    ( SELECT count(signal_events.event_identity_hash) AS count
           FROM signal_events) AS identity_bound_observations,
    ( SELECT count(DISTINCT signal_events.signal_type) AS count
           FROM signal_events) AS observation_classifications,
    ( SELECT count(DISTINCT signal_events.stream_id) AS count
           FROM signal_events) AS streams_with_observations,
    ( SELECT max(signal_events."timestamp") AS max
           FROM signal_events) AS latest_observation_at,
    ( SELECT max(signal_events.ingested_at) AS max
           FROM signal_events) AS latest_observation_ingested_at,
    ( SELECT count(*) AS count
           FROM atlas.signals
          WHERE signals.is_suppressed IS FALSE) AS canonical_signals,
    ( SELECT count(DISTINCT signals.signal_type_id) AS count
           FROM atlas.signals
          WHERE signals.is_suppressed IS FALSE) AS canonical_signal_types,
    ( SELECT count(*) AS count
           FROM atlas.signals signal
          WHERE signal.is_suppressed IS FALSE AND (EXISTS ( SELECT 1
                   FROM atlas.signal_extractions extraction
                  WHERE extraction.signal_id = signal.id))) AS receipted_canonical_signals,
    ( SELECT count(*) AS count
           FROM atlas.signals signal
          WHERE signal.is_suppressed IS FALSE AND NOT (EXISTS ( SELECT 1
                   FROM atlas.signal_extractions extraction
                  WHERE extraction.signal_id = signal.id))) AS unreceipted_canonical_signals,
    ( SELECT count(*) AS count
           FROM atlas.signal_extractions) AS signal_extraction_receipts,
    ( SELECT max(signals.detected_at) AS max
           FROM atlas.signals
          WHERE signals.is_suppressed IS FALSE) AS latest_canonical_signal_at,
    ( SELECT count(*) AS count
           FROM atlas.live_data_signal_candidate
          WHERE live_data_signal_candidate.is_current IS TRUE) AS signal_candidates,
    ( SELECT count(*) AS count
           FROM atlas.live_data_signal_candidate
          WHERE live_data_signal_candidate.is_current IS TRUE AND live_data_signal_candidate.verification_state = 'verified'::text) AS verified_signal_candidates,
    ( SELECT count(*) AS count
           FROM atlas.live_data_signal_candidate
          WHERE live_data_signal_candidate.is_current IS TRUE AND live_data_signal_candidate.lighthouse_status = 'bridged'::text) AS bridged_signal_candidates,
    ( SELECT count(*) AS count
           FROM atlas.live_data_signal_candidate
          WHERE live_data_signal_candidate.is_current IS TRUE AND live_data_signal_candidate.lighthouse_status = 'pending'::text) AS pending_signal_candidates,
    ( SELECT count(*) AS count
           FROM atlas.live_data_signal_rule) AS signal_rule_versions,
    ( SELECT count(*) AS count
           FROM atlas.live_data_signal_rule
          WHERE live_data_signal_rule.is_active) AS active_signal_rules,
    ( SELECT max(live_data_signal_candidate.detected_at) AS max
           FROM atlas.live_data_signal_candidate
          WHERE live_data_signal_candidate.is_current IS TRUE) AS latest_signal_candidate_at,
    ( SELECT count(*) AS count
           FROM atlas.convergence_run_manifest) AS convergence_runs,
    ( SELECT count(*) AS count
           FROM atlas.convergence_receipt) AS convergence_receipts,
    ( SELECT count(*) AS count
           FROM atlas.convergence_events) AS convergence_events,
    ( SELECT latest_convergence.run_key
           FROM latest_convergence) AS latest_convergence_run_key,
    ( SELECT latest_convergence.total_source_rows
           FROM latest_convergence) AS latest_convergence_source_rows,
    ( SELECT latest_convergence.transformed_signal_count
           FROM latest_convergence) AS latest_convergence_transformed_signals,
    ( SELECT latest_convergence.deduplicated_signal_count
           FROM latest_convergence) AS latest_convergence_deduplicated_signals,
    ( SELECT latest_convergence.detected_convergence_count
           FROM latest_convergence) AS latest_detected_convergences,
    ( SELECT latest_convergence.persisted_at
           FROM latest_convergence) AS latest_convergence_at,
    ( SELECT count(*) AS count
           FROM prime_patterns) AS legacy_investigation_outputs,
    ( SELECT count(*) AS count
           FROM prime_patterns
          WHERE prime_patterns.pattern_type = 'stream_health_alert'::text) AS stream_health_alerts,
    ( SELECT count(*) AS count
           FROM prime_patterns
          WHERE prime_patterns.pattern_type <> 'stream_health_alert'::text) AS non_health_legacy_patterns,
    ( SELECT count(*) AS count
           FROM investigative_jobs) AS legacy_investigation_jobs,
    now() AS observed_at,
    ( SELECT count(*) AS count
           FROM atlas.signals
          WHERE signals.is_suppressed IS TRUE) AS legacy_suppressed_canonical_signals,
    ( SELECT count(*) AS count
           FROM atlas.live_data_signal_candidate
          WHERE live_data_signal_candidate.is_current IS FALSE) AS historical_signal_candidate_versions,
    ( SELECT count(DISTINCT live_data_signal_candidate.semantic_key) AS count
           FROM atlas.live_data_signal_candidate) AS signal_candidate_semantic_patterns,
    ( SELECT count(*) AS count
           FROM atlas.live_data_signal_candidate
          WHERE live_data_signal_candidate.is_current IS TRUE AND live_data_signal_candidate.lighthouse_status = 'failed'::text) AS failed_signal_candidates;
create view "public"."v_atlas_ui_overview_v2" ("observed_at", "streams", "sources", "substrate") with (security_invoker=true) as
 SELECT now() AS observed_at,
    COALESCE(( SELECT jsonb_agg(to_jsonb(stream_row.*) ORDER BY stream_row.stream_id) AS jsonb_agg
           FROM v_atlas_stream_runtime_summary_v1 stream_row), '[]'::jsonb) AS streams,
    COALESCE(( SELECT jsonb_agg(to_jsonb(source_row.*) ORDER BY source_row.source_name) AS jsonb_agg
           FROM v_atlas_source_operational_readiness_v1 source_row), '[]'::jsonb) AS sources,
    ( SELECT to_jsonb(substrate_row.*) AS to_jsonb
           FROM v_atlas_signal_substrate_summary_v1 substrate_row) AS substrate;
create view "public"."v_atlas_ui_signal_substrate_v2" ("observed_at", "summary", "signal_types") with (security_invoker=true) as
 SELECT now() AS observed_at,
    ( SELECT to_jsonb(substrate_row.*) AS to_jsonb
           FROM v_atlas_signal_substrate_summary_v1 substrate_row) AS summary,
    COALESCE(( SELECT jsonb_agg(to_jsonb(type_row.*) ORDER BY type_row.event_count DESC, type_row.stream_id, type_row.signal_type) AS jsonb_agg
           FROM ( SELECT v_atlas_signal_type_summary_v1.stream_id,
                    v_atlas_signal_type_summary_v1.signal_type,
                    v_atlas_signal_type_summary_v1.module_hint,
                    v_atlas_signal_type_summary_v1.jurisdiction_id,
                    v_atlas_signal_type_summary_v1.event_count,
                    v_atlas_signal_type_summary_v1.identity_count,
                    v_atlas_signal_type_summary_v1.first_event_at,
                    v_atlas_signal_type_summary_v1.latest_event_at,
                    v_atlas_signal_type_summary_v1.latest_ingested_at
                   FROM v_atlas_signal_type_summary_v1
                  ORDER BY v_atlas_signal_type_summary_v1.event_count DESC, v_atlas_signal_type_summary_v1.stream_id, v_atlas_signal_type_summary_v1.signal_type
                 LIMIT 250) type_row), '[]'::jsonb) AS signal_types;
create view "public"."v_bridge_operational_status" ("total_queue_rows", "pending_count", "processing_count", "retrying_count", "completed_count", "failed_count", "oldest_pending_or_retrying_at", "last_completed_at", "last_processed_at") with (security_invoker=true) as
 SELECT total_queue_rows,
    pending_count,
    processing_count,
    retrying_count,
    completed_count,
    failed_count,
    oldest_pending_or_retrying_at,
    last_completed_at,
    last_processed_at
   FROM atlas.v_bridge_operational_status;
create view "public"."v_atlas_ui_overview_v3" ("observed_at", "streams", "sources", "derivation") with (security_invoker=true) as
 SELECT now() AS observed_at,
    COALESCE(( SELECT jsonb_agg(to_jsonb(stream_row.*) ORDER BY stream_row.stream_id) AS jsonb_agg
           FROM v_atlas_stream_runtime_summary_v1 stream_row), '[]'::jsonb) AS streams,
    COALESCE(( SELECT jsonb_agg(to_jsonb(source_row.*) ORDER BY source_row.source_name) AS jsonb_agg
           FROM v_atlas_source_operational_readiness_v1 source_row), '[]'::jsonb) AS sources,
    ( SELECT to_jsonb(summary_row.*) AS to_jsonb
           FROM v_atlas_signal_derivation_summary_v1 summary_row) AS derivation;
create view "public"."v_atlas_ui_signal_derivation_v3" ("observed_at", "summary", "observation_classifications", "canonical_signal_types", "candidate_rules", "convergence_runs") with (security_invoker=true) as
 SELECT now() AS observed_at,
    ( SELECT to_jsonb(summary_row.*) AS to_jsonb
           FROM v_atlas_signal_derivation_summary_v1 summary_row) AS summary,
    COALESCE(( SELECT jsonb_agg(to_jsonb(type_row.*) ORDER BY type_row.observation_count DESC, type_row.stream_id, type_row.observation_classification) AS jsonb_agg
           FROM ( SELECT v_atlas_observation_type_summary_v1.stream_id,
                    v_atlas_observation_type_summary_v1.observation_classification,
                    v_atlas_observation_type_summary_v1.module_hint,
                    v_atlas_observation_type_summary_v1.jurisdiction_id,
                    v_atlas_observation_type_summary_v1.observation_count,
                    v_atlas_observation_type_summary_v1.identity_bound_observation_count,
                    v_atlas_observation_type_summary_v1.first_observed_at,
                    v_atlas_observation_type_summary_v1.latest_observed_at,
                    v_atlas_observation_type_summary_v1.latest_ingested_at
                   FROM v_atlas_observation_type_summary_v1
                  ORDER BY v_atlas_observation_type_summary_v1.observation_count DESC, v_atlas_observation_type_summary_v1.stream_id, v_atlas_observation_type_summary_v1.observation_classification
                 LIMIT 250) type_row), '[]'::jsonb) AS observation_classifications,
    COALESCE(( SELECT jsonb_agg(to_jsonb(signal_row.*) ORDER BY signal_row.signal_count DESC, signal_row.signal_type_code, signal_row.source_table) AS jsonb_agg
           FROM v_atlas_canonical_signal_type_summary_v1 signal_row), '[]'::jsonb) AS canonical_signal_types,
    COALESCE(( SELECT jsonb_agg(to_jsonb(rule_row.*) ORDER BY rule_row.rule_id, rule_row.rule_version) AS jsonb_agg
           FROM v_atlas_signal_candidate_rule_summary_v1 rule_row), '[]'::jsonb) AS candidate_rules,
    COALESCE(( SELECT jsonb_agg(to_jsonb(run_row.*) ORDER BY run_row.persisted_at DESC, run_row.run_key) AS jsonb_agg
           FROM ( SELECT v_atlas_convergence_run_summary_v1.run_key,
                    v_atlas_convergence_run_summary_v1.engine_version,
                    v_atlas_convergence_run_summary_v1.as_of,
                    v_atlas_convergence_run_summary_v1.time_window_ms,
                    v_atlas_convergence_run_summary_v1.temporal_bucket_ms,
                    v_atlas_convergence_run_summary_v1.geography_registry_version,
                    v_atlas_convergence_run_summary_v1.analysis_registry_hash,
                    v_atlas_convergence_run_summary_v1.analysis_level,
                    v_atlas_convergence_run_summary_v1.rule_manifest_hash,
                    v_atlas_convergence_run_summary_v1.configuration_hash,
                    v_atlas_convergence_run_summary_v1.source_population_hash,
                    v_atlas_convergence_run_summary_v1.transformed_population_hash,
                    v_atlas_convergence_run_summary_v1.deduplicated_population_hash,
                    v_atlas_convergence_run_summary_v1.total_source_rows,
                    v_atlas_convergence_run_summary_v1.transformed_signal_count,
                    v_atlas_convergence_run_summary_v1.deduplicated_signal_count,
                    v_atlas_convergence_run_summary_v1.total_geographies,
                    v_atlas_convergence_run_summary_v1.receipt_count,
                    v_atlas_convergence_run_summary_v1.detected_convergence_count,
                    v_atlas_convergence_run_summary_v1.resolved_receipt_count,
                    v_atlas_convergence_run_summary_v1.unresolved_receipt_count,
                    v_atlas_convergence_run_summary_v1.output_hash,
                    v_atlas_convergence_run_summary_v1.persisted_at
                   FROM v_atlas_convergence_run_summary_v1
                  ORDER BY v_atlas_convergence_run_summary_v1.persisted_at DESC, v_atlas_convergence_run_summary_v1.run_key
                 LIMIT 25) run_row), '[]'::jsonb) AS convergence_runs;

-- ---- row-level security and policies ----
alter table "atlas"."atlas_case_links" enable row level security;
create policy "atlas_read_all_auth_acl" on "atlas"."atlas_case_links" as permissive for select to "authenticated" using (true);
alter table "atlas"."atlas_escalation_links" enable row level security;
create policy "atlas_read_all_auth_ael" on "atlas"."atlas_escalation_links" as permissive for select to "authenticated" using (true);
alter table "atlas"."bridge_config" enable row level security;
create policy "bridge_config_service_all" on "atlas"."bridge_config" as permissive for all to PUBLIC using ((( SELECT ((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'role'::text)) = 'service_role'::text));
alter table "atlas"."bridge_sync_log" enable row level security;
create policy "bridge_sync_log_auth_read" on "atlas"."bridge_sync_log" as permissive for select to PUBLIC using ((( SELECT ((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'role'::text)) = 'authenticated'::text));
create policy "bridge_sync_log_service_all" on "atlas"."bridge_sync_log" as permissive for all to PUBLIC using ((( SELECT ((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'role'::text)) = 'service_role'::text));
alter table "atlas"."civic_genome_external_snapshot" enable row level security;
alter table "atlas"."civic_genome_external_snapshot" force row level security;
alter table "atlas"."civic_genome_legislative_projection_run" enable row level security;
alter table "atlas"."civic_genome_legislative_projection_run" force row level security;
alter table "atlas"."civic_genome_legislative_trait_binding_accounting" enable row level security;
alter table "atlas"."civic_genome_legislative_trait_binding_accounting" force row level security;
alter table "atlas"."convergence_events" enable row level security;
create policy "atlas_read_all_auth_ce" on "atlas"."convergence_events" as permissive for select to "authenticated" using (true);
alter table "atlas"."convergence_patterns" enable row level security;
create policy "atlas_read_all_auth_cp" on "atlas"."convergence_patterns" as permissive for select to "authenticated" using (true);
alter table "atlas"."convergence_receipt" enable row level security;
alter table "atlas"."convergence_receipt" force row level security;
alter table "atlas"."convergence_result_payload" enable row level security;
alter table "atlas"."convergence_result_payload" force row level security;
alter table "atlas"."convergence_run_manifest" enable row level security;
alter table "atlas"."convergence_run_manifest" force row level security;
alter table "atlas"."convergence_signal_snapshot" enable row level security;
alter table "atlas"."convergence_signal_snapshot" force row level security;
alter table "atlas"."corruption_indicators" enable row level security;
create policy "atlas_read_all_auth_ci" on "atlas"."corruption_indicators" as permissive for select to "authenticated" using (true);
alter table "atlas"."domain_configs" enable row level security;
create policy "atlas_read_all_auth_dc" on "atlas"."domain_configs" as permissive for select to "authenticated" using (true);
alter table "atlas"."domains" enable row level security;
create policy "atlas_read_all_auth_dom" on "atlas"."domains" as permissive for select to "authenticated" using (true);
alter table "atlas"."equations" enable row level security;
create policy "atlas_read_all_auth_eq" on "atlas"."equations" as permissive for select to "authenticated" using (true);
alter table "atlas"."fingerprint_matches" enable row level security;
create policy "atlas_read_all_auth_fm" on "atlas"."fingerprint_matches" as permissive for select to "authenticated" using (true);
alter table "atlas"."fingerprints" enable row level security;
create policy "atlas_read_all_auth_fp" on "atlas"."fingerprints" as permissive for select to "authenticated" using (true);
alter table "atlas"."geography_registry_snapshot" enable row level security;
alter table "atlas"."geography_registry_snapshot" force row level security;
alter table "atlas"."live_data_signal_bridge_attempt" enable row level security;
alter table "atlas"."live_data_signal_candidate" enable row level security;
alter table "atlas"."live_data_signal_rule" enable row level security;
alter table "atlas"."live_data_signal_run" enable row level security;
alter table "atlas"."math_constants" enable row level security;
create policy "atlas_read_all_auth" on "atlas"."math_constants" as permissive for select to "authenticated" using (true);
alter table "atlas"."provenance" enable row level security;
create policy "atlas_read_all_auth_prov" on "atlas"."provenance" as permissive for select to "authenticated" using (true);
alter table "atlas"."reparative_calculations" enable row level security;
create policy "atlas_read_all_auth_rc" on "atlas"."reparative_calculations" as permissive for select to "authenticated" using (true);
alter table "atlas"."signal_event_entity_resolution" enable row level security;
alter table "atlas"."signal_event_entity_resolution_rule" enable row level security;
alter table "atlas"."signal_event_entity_resolution_run" enable row level security;
alter table "atlas"."signal_event_identity" enable row level security;
alter table "atlas"."signal_event_ingest_run" enable row level security;
alter table "atlas"."signal_extractions" enable row level security;
create policy "atlas_read_all_auth_se" on "atlas"."signal_extractions" as permissive for select to "authenticated" using (true);
alter table "atlas"."signal_types" enable row level security;
create policy "atlas_read_all_auth_st" on "atlas"."signal_types" as permissive for select to "authenticated" using (true);
alter table "atlas"."signals" enable row level security;
create policy "atlas_read_all_auth_sig" on "atlas"."signals" as permissive for select to "authenticated" using (true);
alter table "atlas"."variables" enable row level security;
create policy "atlas_read_all_auth_var" on "atlas"."variables" as permissive for select to "authenticated" using (true);
alter table "public"."agency_metrics" enable row level security;
create policy "anon_read_agency_metrics" on "public"."agency_metrics" as permissive for select to "anon" using (true);
create policy "service_role_write_agency_metrics" on "public"."agency_metrics" as permissive for all to "service_role" using (true) with check (true);
alter table "public"."agency_registry_canonical" enable row level security;
create policy "readonly_agency_registry" on "public"."agency_registry_canonical" as permissive for select to PUBLIC using (true);
alter table "public"."atlas_action_receipt" enable row level security;
alter table "public"."atlas_action_receipt" force row level security;
create policy "atlas_action_receipt_service_role_all" on "public"."atlas_action_receipt" as permissive for all to "service_role" using (true) with check (true);
alter table "public"."atlas_source_fallback_binding" enable row level security;
alter table "public"."atlas_source_fallback_binding" force row level security;
alter table "public"."atlas_source_health_event" enable row level security;
alter table "public"."atlas_source_health_event" force row level security;
alter table "public"."atlas_source_schema_snapshot" enable row level security;
alter table "public"."atlas_source_schema_snapshot" force row level security;
alter table "public"."canonical_extracted_records" enable row level security;
alter table "public"."case_law" enable row level security;
create policy "Public read case_law" on "public"."case_law" as permissive for select to PUBLIC using (true);
alter table "public"."civic_infrastructure_nodes" enable row level security;
create policy "service_role_all_civic_infrastructure_nodes" on "public"."civic_infrastructure_nodes" as permissive for all to "service_role" using (true) with check (true);
alter table "public"."civic_map_resources" enable row level security;
create policy "anon_read_civic_map_resources" on "public"."civic_map_resources" as permissive for select to "anon" using (true);
create policy "service_role_write_civic_map_resources" on "public"."civic_map_resources" as permissive for all to "service_role" using (true) with check (true);
alter table "public"."connector_registry" enable row level security;
create policy "Public read connectors" on "public"."connector_registry" as permissive for select to PUBLIC using (true);
alter table "public"."cursors" enable row level security;
create policy "service_role_all_cursors" on "public"."cursors" as permissive for all to "service_role" using (true) with check (true);
alter table "public"."extraction_candidates" enable row level security;
alter table "public"."ingest_jobs" enable row level security;
create policy "Auth read jobs" on "public"."ingest_jobs" as permissive for select to PUBLIC using ((auth.role() = 'authenticated'::text));
alter table "public"."investigative_jobs" enable row level security;
create policy "service_role_all_investigative_jobs" on "public"."investigative_jobs" as permissive for all to "service_role" using (true) with check (true);
alter table "public"."jurisdictions" enable row level security;
create policy "anon_read_jurisdictions" on "public"."jurisdictions" as permissive for select to "anon" using (true);
create policy "service_role_write_jurisdictions" on "public"."jurisdictions" as permissive for all to "service_role" using (true) with check (true);
alter table "public"."jurisdictions_registry" enable row level security;
create policy "readonly_jurisdictions_registry" on "public"."jurisdictions_registry" as permissive for select to PUBLIC using (true);
alter table "public"."prime_patterns" enable row level security;
create policy "authenticated_read_prime_patterns" on "public"."prime_patterns" as permissive for select to "authenticated" using (true);
alter table "public"."raw_records" enable row level security;
create policy "Auth read raw" on "public"."raw_records" as permissive for select to PUBLIC using ((auth.role() = 'authenticated'::text));
alter table "public"."registry_conflict_log" enable row level security;
create policy "service_role_all_registry_conflict_log" on "public"."registry_conflict_log" as permissive for all to "service_role" using (true) with check (true);
alter table "public"."schema_registry" enable row level security;
create policy "Public read schemas" on "public"."schema_registry" as permissive for select to PUBLIC using (true);
alter table "public"."signal_definitions" enable row level security;
create policy "anon_read_signal_definitions" on "public"."signal_definitions" as permissive for select to "anon" using (true);
create policy "service_role_write_signal_definitions" on "public"."signal_definitions" as permissive for all to "service_role" using (true) with check (true);
alter table "public"."signal_events" enable row level security;
create policy "authenticated_read_signal_events" on "public"."signal_events" as permissive for select to "authenticated" using (true);
alter table "public"."statutes" enable row level security;
create policy "Public read statutes" on "public"."statutes" as permissive for select to PUBLIC using (true);
alter table "public"."streams" enable row level security;
create policy "authenticated_read_streams" on "public"."streams" as permissive for select to "authenticated" using (true);
alter table "public"."verification_claims" enable row level security;
alter table "public"."verification_evidence" enable row level security;
alter table "public"."verification_sources" enable row level security;
alter table "public"."verified_chronicle" enable row level security;
alter table "public"."workflow_registry" enable row level security;
create policy "readonly_workflow_registry" on "public"."workflow_registry" as permissive for select to PUBLIC using (true);

-- ---- triggers ----
CREATE TRIGGER civic_genome_external_snapshot_immutable BEFORE DELETE OR UPDATE ON atlas.civic_genome_external_snapshot FOR EACH ROW EXECUTE FUNCTION atlas.prevent_civic_genome_snapshot_mutation();
CREATE TRIGGER civic_genome_legislative_projection_immutable BEFORE DELETE OR UPDATE ON atlas.civic_genome_legislative_projection_run FOR EACH ROW EXECUTE FUNCTION atlas.prevent_civic_genome_legislative_projection_mutation();
CREATE TRIGGER civic_genome_trait_accounting_immutable BEFORE DELETE OR UPDATE ON atlas.civic_genome_legislative_trait_binding_accounting FOR EACH ROW EXECUTE FUNCTION atlas.prevent_civic_genome_trait_accounting_mutation();
CREATE TRIGGER convergence_receipt_immutable BEFORE DELETE OR UPDATE ON atlas.convergence_receipt FOR EACH ROW EXECUTE FUNCTION atlas.prevent_convergence_mutation();
CREATE TRIGGER convergence_result_payload_immutable BEFORE DELETE OR UPDATE ON atlas.convergence_result_payload FOR EACH ROW EXECUTE FUNCTION atlas.prevent_convergence_mutation();
CREATE TRIGGER convergence_run_manifest_immutable BEFORE DELETE OR UPDATE ON atlas.convergence_run_manifest FOR EACH ROW EXECUTE FUNCTION atlas.prevent_convergence_mutation();
CREATE TRIGGER convergence_signal_snapshot_immutable BEFORE DELETE OR UPDATE ON atlas.convergence_signal_snapshot FOR EACH ROW EXECUTE FUNCTION atlas.prevent_convergence_mutation();
CREATE TRIGGER geography_registry_snapshot_immutable BEFORE DELETE OR UPDATE ON atlas.geography_registry_snapshot FOR EACH ROW EXECUTE FUNCTION atlas.prevent_convergence_mutation();
CREATE TRIGGER trg_live_data_signal_candidate_currentness_v1 BEFORE INSERT OR UPDATE ON atlas.live_data_signal_candidate FOR EACH ROW EXECUTE FUNCTION atlas.enforce_live_data_signal_candidate_currentness_v1();
CREATE TRIGGER signal_event_entity_resolution_immutable_v1 BEFORE DELETE OR UPDATE ON atlas.signal_event_entity_resolution FOR EACH ROW EXECUTE FUNCTION atlas.guard_signal_event_entity_resolution_immutable_v1();
CREATE TRIGGER signal_event_entity_resolution_rule_immutable_v1 BEFORE DELETE OR UPDATE ON atlas.signal_event_entity_resolution_rule FOR EACH ROW EXECUTE FUNCTION atlas.guard_signal_event_entity_resolution_rule_immutable_v1();
CREATE TRIGGER atlas_source_fallback_updated_at BEFORE UPDATE ON atlas_source_fallback_binding FOR EACH ROW EXECUTE FUNCTION atlas_set_source_fallback_updated_at();
CREATE TRIGGER set_cursors_updated_at BEFORE UPDATE ON cursors FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_streams_updated_at BEFORE UPDATE ON streams FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_promote_verified_chronicle AFTER UPDATE OF verification_status, verification_score, conflict_status ON verification_claims FOR EACH ROW EXECUTE FUNCTION promote_verified_chronicle();
CREATE TRIGGER trg_verification_claims_updated_at BEFORE UPDATE ON verification_claims FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---- comments ----
comment on table "atlas"."action_queue" is 'General-purpose action queue for async Atlas operations (probe, extract, link, escalate).';
comment on table "atlas"."atlas_case_links" is 'Bidirectional bridge: Atlas convergence events linked to Prism forensic cases.';
comment on table "atlas"."atlas_escalation_links" is 'Atlas-driven escalation triggers with configurable auto-escalation thresholds.';
comment on table "atlas"."benefits_offices" is 'Washington State DSHS benefit office locations. Populated by wa_dshs_socrata connector via benefits_wa schema.';
comment on table "atlas"."census_city_data" is 'Census ACS 5-year demographic data at city/place level. Referenced by detection rules for poverty, income, housing burden, and demographic cross-analysis.';
comment on table "atlas"."census_tract_data" is 'Census ACS 5-year data at tract level. Used for utility rate discrimination detection and fine-grained demographic mapping.';
comment on table "atlas"."civic_map_signals" is 'Civic map signal layer. Feeds v_entity_risk_score and cross-domain visualization.';
comment on table "atlas"."clause_patterns" is 'Regex pattern registry for clause detection. Analysts can add/modify patterns via SQL insert without deploying code. Workers read active patterns at runtime.';
comment on table "atlas"."connector_registry" is 'Registry of all data connectors. Each connector maps to one or more schemas in schema_registry.';
comment on table "atlas"."contact_registry" is 'Universal contact extraction. Auto-synced from population schemas during ingestion.';
comment on table "atlas"."contract_clauses" is 'Deterministic clause detection findings from PDF text extraction. Every row is a regex pattern match with context, severity, and human review status. No AI interpretation.';
comment on table "atlas"."convergence_events" is 'Detected multi-signal convergence events with geographic and temporal bounding.';
comment on table "atlas"."convergence_patterns" is 'Multi-signal convergence templates: what combinations constitute a detectable pattern.';
comment on table "atlas"."corruption_indicators" is 'Structured corruption findings with 9 indicator types mapped to signal intelligence.';
comment on table "atlas"."court_cases" is 'Court case records from CourtListener/PACER. Feeds JUDI domain detection.';
comment on table "atlas"."detection_rules" is 'Deterministic SQL-based detection rules for each Atlas domain. Templates are parameterized with threshold_parameters.';
comment on table "atlas"."discovery_platforms" is 'Templates for probing known open-data platforms.';
comment on table "atlas"."domain_configs" is 'Runtime domain-specific overrides and tuning parameters.';
comment on table "atlas"."domain_registry" is 'Registry of all Atlas detection domains. Referenced by detection_rules and schema_registry.';
comment on table "atlas"."domains" is 'Application domains with bound signal types, equations, and jurisdiction mappings.';
comment on table "atlas"."endpoint_probe_queue" is 'Queue of discovered API endpoints awaiting probe, schema inference, human review, and activation.';
comment on table "atlas"."entity_aliases" is 'Known name variants for every entity in entity_registry.';
comment on table "atlas"."entity_registry" is 'Universal entity resolution backbone. Auto-populated by the schema engine during field mapping.';
comment on table "atlas"."equations" is 'Core Atlas equations: signal extraction, convergence detection, fingerprinting, and reparative mathematics.';
comment on table "atlas"."fingerprint_matches" is 'Cross-entity and cross-jurisdiction fingerprint correlation results.';
comment on table "atlas"."fingerprints" is 'Cryptographic and behavioral fingerprints for entities, jurisdictions, and patterns.';
comment on table "atlas"."geography_registry" is 'Universal geography lookup. Used by contact_registry, location_registry, and civic_map_signals for spatial joins.';
comment on table "atlas"."healthcare_facilities" is 'Healthcare facility records from CMS. Feeds HCFC domain detection.';
comment on table "atlas"."immigration_courts" is 'EOIR immigration court backlog data. Feeds IMDP domain detection.';
comment on table "atlas"."inferred_schema_draft" is 'Auto-generated schema_registry JSON drafts awaiting human approval.';
comment on table "atlas"."ingest_job" is 'Tracks every data ingestion job. One row per run of a connector against a schema.';
comment on table "atlas"."ingest_schedule" is 'Cron schedule for each registered schema ingestion job.';
comment on table "atlas"."jurisdiction_domains" is 'Maps jurisdiction slugs to platform-specific API domains.';
comment on table "atlas"."lighthouse_cases" is 'Bridge table: Atlas action_queue items and high-severity detection results become Lighthouse cases. One row per convergent failure or escalated signal.';
comment on table "atlas"."lighthouse_entities" is 'Bridge table: Atlas entity backbone mirrored for Lighthouse consumption. Risk scores computed from cross-domain signal history.';
comment on table "atlas"."lighthouse_map_pins" is 'Bridge table: Lighthouse civic map reads from here. Atlas populates this with signals, entities, cases, and resource locations as geospatial pins.';
comment on table "atlas"."lighthouse_signals" is 'Bridge table: Atlas pushes detection signals here. Lighthouse polls/reads this table to populate its civic map and case management UI.';
comment on table "atlas"."live_data_signal_bridge_attempt" is 'Auditable pg_net request and Lighthouse receipt ledger for Atlas Domain 3 candidates.';
comment on table "atlas"."live_data_signal_candidate" is 'Atlas-owned Domain 3 output candidate. Contains explicit statistics, entity resolution, severity, confidence, rule, engine, source-event references, and Lighthouse bridge receipt.';
comment on column "atlas"."live_data_signal_candidate"."semantic_key" is 'Stable semantic pattern identity. candidate_hash remains the immutable population/version identity.';
comment on column "atlas"."live_data_signal_candidate"."is_current" is 'True only for the current candidate version within semantic_key; historical versions are retained.';
comment on column "atlas"."live_data_signal_candidate"."supersedes_candidate_id" is 'Prior semantic version replaced by this candidate version when one exists.';
comment on table "atlas"."location_registry" is 'Universal location extraction. Auto-populated from address fields during schema ingestion.';
comment on table "atlas"."math_constants" is 'Universal and domain-specific mathematical constants for signal convergence equations.';
comment on table "atlas"."municipal_bonds" is 'Municipal bond records from EMMA (MSRB). Feeds MUBD domain detection.';
comment on table "atlas"."nonprofit_financials" is 'IRS 990 financial data from ProPublica. Feeds NFHM domain detection.';
comment on table "atlas"."pdf_extraction_queue" is 'Worker queue for PDF text extraction. External workers poll for pending jobs, download PDFs, extract text, and update status. Auto-populated by trigger on raw_ table inserts.';
comment on table "atlas"."provenance" is 'Immutable audit trail for all Atlas computations, links, and state changes.';
comment on table "atlas"."regulatory_comments" is 'Regulatory comment submissions from regulations.gov. Feeds REGC domain detection.';
comment on table "atlas"."regulatory_final_rules" is 'Final rules published in the Federal Register. Paired with regulatory_comments for REGC detection.';
comment on table "atlas"."reparative_calculations" is 'Reparative math outputs: harm quantification, restitution estimates, dignity scoring.';
comment on table "atlas"."schema_registry" is 'Registry of all data schemas ingested into Atlas. Each row describes a dataset structure and its field mappings.';
comment on table "atlas"."school_districts" is 'School district funding and outcome data from NCES. Feeds SCHF domain detection.';
comment on table "atlas"."signal_event_entity_resolution" is 'Immutable versioned mapping from Atlas signal-event identity to canonical entity identity. Exact matching only; unresolved and ambiguous outcomes remain explicit.';
comment on table "atlas"."signal_event_entity_resolution_rule" is 'Locked source-specific deterministic extraction rules for signal-event entity resolution. Rule changes require a new rule and resolver version.';
comment on table "atlas"."signal_event_entity_resolution_run" is 'Auditable execution ledger for bounded deterministic event-entity resolution and replay.';
comment on table "atlas"."signal_event_identity" is 'Canonical replay-safe Atlas observation identity. Historical duplicate signal_events remain preserved but do not circulate as current unique observations.';
comment on table "atlas"."signal_extractions" is 'Audit trail of how each signal was extracted, including input/output snapshots.';
comment on table "atlas"."signal_types" is 'The 9+ signal type taxonomy for cross-domain pattern detection.';
comment on table "atlas"."signals" is 'Individual signal extractions with normalized scoring and confidence intervals.';
comment on table "atlas"."utility_rate_cases" is 'Utility rate case filings from state PUCs. Feeds UTRD domain detection.';
comment on table "atlas"."variables" is 'Variable registry for equation parameter binding and dynamic computation.';
comment on table "atlas"."water_systems" is 'Public water system records from EPA SDWIS. Feeds WATR domain detection.';
comment on table "private"."lighthouse_stream_export_allowlist" is 'Explicit Atlas stream allowlist for the read-only Lighthouse event bridge.';
comment on table "public"."canonical_extracted_records" is 'Preserved legacy extraction fixture. Not an Atlas convergence output or canonical civic resource record. Service-role only.';
comment on table "public"."connector_registry" is 'Live API connectors mapped to schemas and adapters';
comment on table "public"."extraction_candidates" is 'Preserved legacy extraction fixture. Not canonical Atlas signal state and not a Prism verification input. Service-role only.';
comment on table "public"."schema_registry" is 'Canonical schema definitions that drive the auto-population engine';
comment on table "public"."verification_claims" is 'Preserved legacy verification fixture. Not the canonical Prism claims ledger. Service-role only.';
comment on table "public"."verification_evidence" is 'Preserved legacy verification fixture. Not the canonical Prism evidence ledger. Service-role only.';
comment on table "public"."verification_sources" is 'Preserved legacy verification fixture. Not the canonical Prism source registry. Service-role only.';
comment on table "public"."verified_chronicle" is 'Preserved legacy chronicle fixture. Not an Atlas governed finding or Prism receipt. Service-role only.';
comment on function "atlas"."claim_pdf_extraction_job"(p_worker_id character varying) is 'Atomically claims the next pending PDF extraction job. Workers call this to get exclusive access to a job. Returns empty if no jobs available.';
comment on function "atlas"."complete_pdf_extraction"(p_queue_id bigint, p_extracted_text text, p_extraction_method character varying, p_extraction_confidence numeric, p_page_count integer, p_clauses_found jsonb) is 'Worker calls this after PDF extraction + clause detection. Stores extracted text and all findings atomically.';
comment on function "atlas"."enforce_live_data_signal_candidate_currentness_v1"() is 'Maintains one current row per semantic signal identity while excluding the same candidate_hash from prior-current retirement so INSERT ON CONFLICT may safely replay an already-current candidate.';
comment on function "atlas"."engine_activate_discovered_schema"(p_draft_id bigint, p_reviewed_by character varying, p_review_notes text) is 'Moves an approved inferred_schema_draft into schema_registry + connector_registry.';
comment on function "atlas"."engine_extract_entity"(p_schema_name character varying, p_target_table character varying, p_source_record_id character varying, p_jurisdiction character varying, p_entity_type character varying, p_name character varying, p_address character varying, p_email character varying, p_phone character varying, p_raw_payload jsonb) is 'Deterministic entity/contact/location extractor. Called by the field mapper during ingestion. Upsert-only. Never deletes.';
comment on function "atlas"."engine_probe_platform"(p_platform_id character varying, p_jurisdiction character varying, p_listing_response jsonb) is 'Processes a platform listing response JSONB and populates endpoint_probe_queue.';
comment on function "atlas"."fail_pdf_extraction"(p_queue_id bigint, p_error_message text) is 'Worker calls this on extraction failure. Implements exponential backoff retry or permanent failure.';
comment on function "atlas"."live_data_signal_candidate_semantic_key_v2"(p_rule_id text, p_signal_type text, p_primary_stream_id text, p_jurisdiction_id text, p_title text, p_entity_ids text[]) is 'Entity-aware semantic currentness identity. ProPublica entity-specific data-quality signals include resolved entity IDs so independent entities cannot retire one another; all other v1 signal semantics remain unchanged.';
comment on function "public"."atlas_convergence_get_replay_bundle_v1"(p_run_key text) is 'Returns an immutable Atlas convergence replay bundle using engine-contract snapshot key records; records_json remains an internal storage-column name.';
comment on function "public"."atlas_convergence_persist_run_v1"(p_bundle jsonb) is 'Atomically persists Atlas v2.1 convergence manifests, immutable population snapshots, per-geography receipts, and complete output payloads. Function-local statement timeout: 120 seconds.';
comment on function "public"."atlas_convergence_source_population_page_v1"(p_from_timestamp timestamp with time zone, p_to_timestamp timestamp with time zone, p_after_stream_id text, p_after_offset bigint, p_limit integer) is 'Returns the immutable canonical event population for Atlas convergence. Mutable replay_count, historical aggregates, latest offsets, and last_seen_at remain operational telemetry and are excluded from governed hashes.';
comment on function "public"."bridge_live_data_signal_candidates_v1"(p_run_id uuid, p_limit integer) is 'Projects Atlas Domain 3 candidates into Lighthouse with immutable Atlas candidate ID, hash, semantic key, evidence references, and governed transport receipts. It does not promote candidates or create findings.';
comment on function "public"."bridge_live_data_signal_retirements_v1"(p_run_id uuid, p_limit integer) is 'Projects governed Atlas negative-currentness retirement receipts to Lighthouse without deleting historical signal evidence.';
comment on function "public"."detect_propublica_unresolved_metadata_v1"(p_min_unique_records integer, p_min_unresolved_rate numeric, p_limit integer) is 'Runs the governed ProPublica unresolved-metadata seed detector using entity-aware semantic currentness and sequential idempotent candidate upserts so one detector run cannot trip PostgreSQL multi-row ON CONFLICT cardinality errors.';
comment on function "public"."enqueue_live_data_signal_candidates_v1"(p_run_id uuid, p_limit integer) is 'Queues evidence-bound Domain 3 registration requests using encrypted Atlas bridge configuration.';
comment on function "public"."get_lighthouse_signal_events"(p_stream_id text, p_offset bigint, p_limit integer) is 'Returns a bounded ordered page of explicitly allowlisted Atlas signal events to Lighthouse.';
comment on function "public"."get_lighthouse_stream_definition"(p_stream_id text) is 'Returns one explicitly allowlisted Atlas stream definition to Lighthouse.';
comment on function "public"."persist_signal_event_batch_v2"(p_events jsonb) is 'Replay-safe event persistence. Per-event subtransactions preserve committed progress and a durable partial/failed run receipt.';
comment on function "public"."reconcile_domain3_population_currentness_v1"(p_rule_id text, p_rule_version text, p_run_id uuid, p_current_candidate_hashes jsonb, p_replay_complete boolean) is 'Retires candidates absent from the latest complete non-truncated governed replay for one rule. Incomplete/truncated or superseded runs cannot retire current candidates.';
comment on function "public"."settle_live_data_signal_candidates_v1"(p_run_id uuid) is 'Settles queued Domain 3 requests from pg_net response receipts and records bridged, idempotent, pending, or failed state.';
comment on view "atlas"."v_clauses_pending_review" is 'Human review queue for clause detection findings. Analysts confirm or flag as false positive before findings enter detection engine.';
comment on view "atlas"."v_cross_domain_entities" is 'Shows every entity and how many Atlas domains it appears in.';
comment on view "atlas"."v_entity_risk_score" is 'Composite risk score for every entity based on signal history across all Atlas domains.';
comment on view "atlas"."v_lighthouse_case_queue" is 'Stable interface for Lighthouse case management. Returns all active cases sorted by priority then severity.';
comment on view "atlas"."v_lighthouse_civic_map" is 'Stable interface for Lighthouse civic map. Returns all active pins: signals (red), entities (blue), cases (purple), resources (green). Expired pins auto-filtered.';
comment on view "atlas"."v_lighthouse_entity_watchlist" is 'Stable interface for Lighthouse entity monitoring. Returns high-risk and watched entities.';
comment on view "atlas"."v_pdf_extraction_pending" is 'Operational view for monitoring PDF extraction queue. Shows pending, retrying, and failed jobs with queue age.';
comment on view "atlas"."v_prism_escalation_contacts" is 'Live projection of auto-extracted government-agency contacts for the Prism escalation routing system.';
comment on view "atlas"."v_propublica_unresolved_metadata_candidate_v1" is 'Stable unique-record candidate input. Adapter replay timestamps are excluded from candidate identity.';
comment on view "atlas"."v_rosetta_contacts" is 'Live projection of auto-extracted contacts for the Rosetta help-program system.';
comment on view "atlas"."v_signal_intelligence_cards" is 'Read-only signal intelligence projection. Groups Atlas raw civic-map and typed signals into canonical pattern-intelligence card fields without mutating source signal tables.';
comment on view "public"."v_atlas_event_entity_resolution_review_v1" is 'Read-only deterministic grouping of current ambiguous and unresolved event-entity outcomes. It never creates, merges, aliases, or resolves an entity.';
comment on view "public"."v_atlas_observation_type_summary_v1" is 'Normalized observation classifications from the legacy-named signal_events compatibility store; rows are not derived civic signals.';
comment on view "public"."v_atlas_signal_candidate_rule_summary_v1" is 'Current semantic Domain 3 candidate versions only; historical versions remain in candidate detail.';
comment on view "public"."v_atlas_signal_derivation_summary_v1" is 'Current ontology summary with additive legacy/currentness diagnostics; established column order is preserved.';
comment on view "public"."v_atlas_ui_signal_derivation_v3" is 'Compact Atlas UI read model preserving the source -> observation -> signal -> convergence ontology.';

-- ---- object privileges ----
revoke all privileges on sequence "atlas"."action_queue_action_id_seq" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on sequence "atlas"."bridge_operational_audit_audit_id_seq" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on sequence "atlas"."bridge_sync_log_log_id_seq" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on sequence "atlas"."census_city_data_city_id_seq" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on sequence "atlas"."census_tract_data_tract_id_seq" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on sequence "atlas"."civic_map_signals_signal_id_seq" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on sequence "atlas"."contact_registry_contact_id_seq" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on sequence "atlas"."contract_clauses_clause_id_seq" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on sequence "atlas"."court_cases_case_id_seq" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on sequence "atlas"."endpoint_probe_queue_queue_id_seq" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on sequence "atlas"."entity_aliases_alias_id_seq" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on sequence "atlas"."healthcare_facilities_facility_id_seq" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on sequence "atlas"."immigration_courts_court_id_seq" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on sequence "atlas"."inferred_schema_draft_draft_id_seq" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on sequence "atlas"."ingest_job_job_id_seq" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on sequence "atlas"."lighthouse_bridge_queue_queue_id_seq" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on sequence "atlas"."lighthouse_cases_case_id_seq" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on sequence "atlas"."lighthouse_map_pins_pin_id_seq" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on sequence "atlas"."lighthouse_signals_signal_id_seq" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on sequence "atlas"."location_registry_location_id_seq" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on sequence "atlas"."municipal_bonds_bond_id_seq" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on sequence "atlas"."nonprofit_financials_filing_id_seq" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on sequence "atlas"."pdf_extraction_queue_queue_id_seq" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on sequence "atlas"."raw_benefits_wa_raw_id_seq" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on sequence "atlas"."raw_food_banks_king_county_raw_id_seq" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on sequence "atlas"."raw_nonprofits_wa_raw_id_seq" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on sequence "atlas"."raw_regulations_gov_raw_id_seq" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on sequence "atlas"."regulatory_comments_comment_id_seq" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on sequence "atlas"."regulatory_final_rules_rule_id_seq" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on sequence "atlas"."school_districts_district_id_seq" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on sequence "atlas"."utility_rate_cases_rate_id_seq" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on sequence "atlas"."water_systems_system_id_seq" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on sequence "public"."civic_infrastructure_nodes_id_seq" from PUBLIC, "anon", "authenticated", "service_role";
grant select, update, usage on sequence "public"."civic_infrastructure_nodes_id_seq" to "anon";
grant select, update, usage on sequence "public"."civic_infrastructure_nodes_id_seq" to "authenticated";
grant select, update, usage on sequence "public"."civic_infrastructure_nodes_id_seq" to "service_role";
revoke all privileges on sequence "public"."registry_conflict_log_id_seq" from PUBLIC, "anon", "authenticated", "service_role";
grant select, update, usage on sequence "public"."registry_conflict_log_id_seq" to "anon";
grant select, update, usage on sequence "public"."registry_conflict_log_id_seq" to "authenticated";
grant select, update, usage on sequence "public"."registry_conflict_log_id_seq" to "service_role";
revoke all privileges on table "atlas"."action_queue" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."action_queue" to "anon";
grant select on table "atlas"."action_queue" to "authenticated";
revoke all privileges on table "atlas"."atlas_case_links" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."atlas_case_links" to "anon";
grant select on table "atlas"."atlas_case_links" to "authenticated";
revoke all privileges on table "atlas"."atlas_escalation_links" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."atlas_escalation_links" to "anon";
grant select on table "atlas"."atlas_escalation_links" to "authenticated";
revoke all privileges on table "atlas"."benefits_offices" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."benefits_offices" to "anon";
grant select on table "atlas"."benefits_offices" to "authenticated";
revoke all privileges on table "atlas"."bridge_config" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."bridge_config" to "anon";
grant select on table "atlas"."bridge_config" to "authenticated";
revoke all privileges on table "atlas"."bridge_operational_audit" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "atlas"."bridge_operational_audit" to "service_role";
revoke all privileges on table "atlas"."bridge_sync_log" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."bridge_sync_log" to "anon";
grant select on table "atlas"."bridge_sync_log" to "authenticated";
revoke all privileges on table "atlas"."census_city_data" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."census_city_data" to "anon";
grant select on table "atlas"."census_city_data" to "authenticated";
revoke all privileges on table "atlas"."census_tract_data" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."census_tract_data" to "anon";
grant select on table "atlas"."census_tract_data" to "authenticated";
revoke all privileges on table "atlas"."civic_genome_external_snapshot" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on table "atlas"."civic_genome_legislative_projection_run" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on table "atlas"."civic_genome_legislative_trait_binding_accounting" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on table "atlas"."civic_map_signals" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."civic_map_signals" to "anon";
grant select on table "atlas"."civic_map_signals" to "authenticated";
revoke all privileges on table "atlas"."clause_patterns" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."clause_patterns" to "anon";
grant select on table "atlas"."clause_patterns" to "authenticated";
revoke all privileges on table "atlas"."connector_registry" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."connector_registry" to "anon";
grant select on table "atlas"."connector_registry" to "authenticated";
revoke all privileges on table "atlas"."contact_registry" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."contact_registry" to "anon";
grant select on table "atlas"."contact_registry" to "authenticated";
revoke all privileges on table "atlas"."contract_clauses" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."contract_clauses" to "anon";
grant select on table "atlas"."contract_clauses" to "authenticated";
revoke all privileges on table "atlas"."convergence_events" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."convergence_events" to "service_role";
revoke all privileges on table "atlas"."convergence_patterns" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."convergence_patterns" to "anon";
grant select on table "atlas"."convergence_patterns" to "authenticated";
revoke all privileges on table "atlas"."convergence_receipt" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."convergence_receipt" to "service_role";
revoke all privileges on table "atlas"."convergence_result_payload" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on table "atlas"."convergence_run_manifest" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."convergence_run_manifest" to "service_role";
revoke all privileges on table "atlas"."convergence_signal_snapshot" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on table "atlas"."corruption_indicators" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."corruption_indicators" to "anon";
grant select on table "atlas"."corruption_indicators" to "authenticated";
revoke all privileges on table "atlas"."court_cases" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."court_cases" to "anon";
grant select on table "atlas"."court_cases" to "authenticated";
revoke all privileges on table "atlas"."detection_rules" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."detection_rules" to "anon";
grant select on table "atlas"."detection_rules" to "authenticated";
revoke all privileges on table "atlas"."discovery_platforms" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."discovery_platforms" to "anon";
grant select on table "atlas"."discovery_platforms" to "authenticated";
revoke all privileges on table "atlas"."domain_configs" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."domain_configs" to "anon";
grant select on table "atlas"."domain_configs" to "authenticated";
revoke all privileges on table "atlas"."domain_registry" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."domain_registry" to "anon";
grant select on table "atlas"."domain_registry" to "authenticated";
revoke all privileges on table "atlas"."domains" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."domains" to "anon";
grant select on table "atlas"."domains" to "authenticated";
revoke all privileges on table "atlas"."endpoint_probe_queue" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."endpoint_probe_queue" to "anon";
grant select on table "atlas"."endpoint_probe_queue" to "authenticated";
revoke all privileges on table "atlas"."entity_aliases" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."entity_aliases" to "anon";
grant select on table "atlas"."entity_aliases" to "authenticated";
revoke all privileges on table "atlas"."entity_registry" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."entity_registry" to "anon";
grant select on table "atlas"."entity_registry" to "authenticated";
revoke all privileges on table "atlas"."equations" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."equations" to "anon";
grant select on table "atlas"."equations" to "authenticated";
revoke all privileges on table "atlas"."fingerprint_matches" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."fingerprint_matches" to "anon";
grant select on table "atlas"."fingerprint_matches" to "authenticated";
revoke all privileges on table "atlas"."fingerprints" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."fingerprints" to "anon";
grant select on table "atlas"."fingerprints" to "authenticated";
revoke all privileges on table "atlas"."food_banks" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."food_banks" to "anon";
grant select on table "atlas"."food_banks" to "authenticated";
revoke all privileges on table "atlas"."geography_registry" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."geography_registry" to "anon";
grant select on table "atlas"."geography_registry" to "authenticated";
revoke all privileges on table "atlas"."geography_registry_snapshot" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on table "atlas"."healthcare_facilities" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."healthcare_facilities" to "anon";
grant select on table "atlas"."healthcare_facilities" to "authenticated";
revoke all privileges on table "atlas"."immigration_courts" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."immigration_courts" to "anon";
grant select on table "atlas"."immigration_courts" to "authenticated";
revoke all privileges on table "atlas"."inferred_schema_draft" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."inferred_schema_draft" to "anon";
grant select on table "atlas"."inferred_schema_draft" to "authenticated";
revoke all privileges on table "atlas"."ingest_job" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."ingest_job" to "anon";
grant select on table "atlas"."ingest_job" to "authenticated";
revoke all privileges on table "atlas"."ingest_schedule" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."ingest_schedule" to "anon";
grant select on table "atlas"."ingest_schedule" to "authenticated";
revoke all privileges on table "atlas"."jurisdiction_domains" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."jurisdiction_domains" to "anon";
grant select on table "atlas"."jurisdiction_domains" to "authenticated";
revoke all privileges on table "atlas"."legal_aid_providers" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."legal_aid_providers" to "anon";
grant select on table "atlas"."legal_aid_providers" to "authenticated";
revoke all privileges on table "atlas"."lighthouse_bridge_queue" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on table "atlas"."lighthouse_cases" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."lighthouse_cases" to "anon";
grant select on table "atlas"."lighthouse_cases" to "authenticated";
revoke all privileges on table "atlas"."lighthouse_entities" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."lighthouse_entities" to "anon";
grant select on table "atlas"."lighthouse_entities" to "authenticated";
revoke all privileges on table "atlas"."lighthouse_map_pins" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."lighthouse_map_pins" to "anon";
grant select on table "atlas"."lighthouse_map_pins" to "authenticated";
revoke all privileges on table "atlas"."lighthouse_signals" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."lighthouse_signals" to "anon";
grant select on table "atlas"."lighthouse_signals" to "authenticated";
revoke all privileges on table "atlas"."live_data_signal_bridge_attempt" from PUBLIC, "anon", "authenticated", "service_role";
grant insert, select, update on table "atlas"."live_data_signal_bridge_attempt" to "service_role";
revoke all privileges on table "atlas"."live_data_signal_candidate" from PUBLIC, "anon", "authenticated", "service_role";
grant insert, select, update on table "atlas"."live_data_signal_candidate" to "service_role";
revoke all privileges on table "atlas"."live_data_signal_candidate_retirement_v1" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on table "atlas"."live_data_signal_rule" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."live_data_signal_rule" to "service_role";
revoke all privileges on table "atlas"."live_data_signal_run" from PUBLIC, "anon", "authenticated", "service_role";
grant insert, select, update on table "atlas"."live_data_signal_run" to "service_role";
revoke all privileges on table "atlas"."location_registry" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."location_registry" to "anon";
grant select on table "atlas"."location_registry" to "authenticated";
revoke all privileges on table "atlas"."math_constants" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."math_constants" to "anon";
grant select on table "atlas"."math_constants" to "authenticated";
revoke all privileges on table "atlas"."municipal_bonds" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."municipal_bonds" to "anon";
grant select on table "atlas"."municipal_bonds" to "authenticated";
revoke all privileges on table "atlas"."nonprofit_financials" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."nonprofit_financials" to "anon";
grant select on table "atlas"."nonprofit_financials" to "authenticated";
revoke all privileges on table "atlas"."nonprofit_registry" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."nonprofit_registry" to "anon";
grant select on table "atlas"."nonprofit_registry" to "authenticated";
revoke all privileges on table "atlas"."pdf_extraction_queue" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."pdf_extraction_queue" to "anon";
grant select on table "atlas"."pdf_extraction_queue" to "authenticated";
revoke all privileges on table "atlas"."provenance" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."provenance" to "anon";
grant select on table "atlas"."provenance" to "authenticated";
revoke all privileges on table "atlas"."raw_benefits_wa" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."raw_benefits_wa" to "anon";
grant select on table "atlas"."raw_benefits_wa" to "authenticated";
revoke all privileges on table "atlas"."raw_food_banks_king_county" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."raw_food_banks_king_county" to "anon";
grant select on table "atlas"."raw_food_banks_king_county" to "authenticated";
revoke all privileges on table "atlas"."raw_nonprofits_wa" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."raw_nonprofits_wa" to "anon";
grant select on table "atlas"."raw_nonprofits_wa" to "authenticated";
revoke all privileges on table "atlas"."raw_regulations_gov" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."raw_regulations_gov" to "anon";
grant select on table "atlas"."raw_regulations_gov" to "authenticated";
revoke all privileges on table "atlas"."regulatory_comments" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."regulatory_comments" to "anon";
grant select on table "atlas"."regulatory_comments" to "authenticated";
revoke all privileges on table "atlas"."regulatory_final_rules" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."regulatory_final_rules" to "anon";
grant select on table "atlas"."regulatory_final_rules" to "authenticated";
revoke all privileges on table "atlas"."reparative_calculations" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."reparative_calculations" to "anon";
grant select on table "atlas"."reparative_calculations" to "authenticated";
revoke all privileges on table "atlas"."schema_registry" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."schema_registry" to "anon";
grant select on table "atlas"."schema_registry" to "authenticated";
revoke all privileges on table "atlas"."school_districts" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."school_districts" to "anon";
grant select on table "atlas"."school_districts" to "authenticated";
revoke all privileges on table "atlas"."signal_event_entity_resolution" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."signal_event_entity_resolution" to "service_role";
revoke all privileges on table "atlas"."signal_event_entity_resolution_rule" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."signal_event_entity_resolution_rule" to "service_role";
revoke all privileges on table "atlas"."signal_event_entity_resolution_run" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."signal_event_entity_resolution_run" to "service_role";
revoke all privileges on table "atlas"."signal_event_identity" from PUBLIC, "anon", "authenticated", "service_role";
grant insert, select, update on table "atlas"."signal_event_identity" to "service_role";
revoke all privileges on table "atlas"."signal_event_ingest_run" from PUBLIC, "anon", "authenticated", "service_role";
grant insert, select, update on table "atlas"."signal_event_ingest_run" to "service_role";
revoke all privileges on table "atlas"."signal_extractions" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."signal_extractions" to "service_role";
revoke all privileges on table "atlas"."signal_types" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."signal_types" to "service_role";
revoke all privileges on table "atlas"."signals" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."signals" to "service_role";
revoke all privileges on table "atlas"."utility_rate_cases" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."utility_rate_cases" to "anon";
grant select on table "atlas"."utility_rate_cases" to "authenticated";
revoke all privileges on table "atlas"."variables" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."variables" to "anon";
grant select on table "atlas"."variables" to "authenticated";
revoke all privileges on table "atlas"."water_systems" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."water_systems" to "anon";
grant select on table "atlas"."water_systems" to "authenticated";
revoke all privileges on table "private"."lighthouse_stream_export_allowlist" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on table "public"."agency_metrics" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."agency_metrics" to "anon";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."agency_metrics" to "authenticated";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."agency_metrics" to "service_role";
revoke all privileges on table "public"."agency_registry_canonical" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."agency_registry_canonical" to "anon";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."agency_registry_canonical" to "authenticated";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."agency_registry_canonical" to "service_role";
revoke all privileges on table "public"."atlas_action_receipt" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."atlas_action_receipt" to "service_role";
revoke all privileges on table "public"."atlas_source_fallback_binding" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."atlas_source_fallback_binding" to "service_role";
revoke all privileges on table "public"."atlas_source_health_event" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."atlas_source_health_event" to "service_role";
revoke all privileges on table "public"."atlas_source_schema_snapshot" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."atlas_source_schema_snapshot" to "service_role";
revoke all privileges on table "public"."canonical_extracted_records" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."canonical_extracted_records" to "service_role";
revoke all privileges on table "public"."case_law" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."case_law" to "anon";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."case_law" to "authenticated";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."case_law" to "service_role";
revoke all privileges on table "public"."civic_infrastructure_nodes" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."civic_infrastructure_nodes" to "anon";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."civic_infrastructure_nodes" to "authenticated";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."civic_infrastructure_nodes" to "service_role";
revoke all privileges on table "public"."civic_map_resources" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."civic_map_resources" to "anon";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."civic_map_resources" to "authenticated";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."civic_map_resources" to "service_role";
revoke all privileges on table "public"."connector_registry" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."connector_registry" to "anon";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."connector_registry" to "authenticated";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."connector_registry" to "service_role";
revoke all privileges on table "public"."cursors" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."cursors" to "anon";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."cursors" to "authenticated";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."cursors" to "service_role";
revoke all privileges on table "public"."extraction_candidates" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."extraction_candidates" to "service_role";
revoke all privileges on table "public"."ingest_jobs" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."ingest_jobs" to "anon";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."ingest_jobs" to "authenticated";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."ingest_jobs" to "service_role";
revoke all privileges on table "public"."investigative_jobs" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."investigative_jobs" to "anon";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."investigative_jobs" to "authenticated";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."investigative_jobs" to "service_role";
revoke all privileges on table "public"."jurisdictions" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."jurisdictions" to "anon";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."jurisdictions" to "authenticated";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."jurisdictions" to "service_role";
revoke all privileges on table "public"."jurisdictions_registry" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."jurisdictions_registry" to "anon";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."jurisdictions_registry" to "authenticated";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."jurisdictions_registry" to "service_role";
revoke all privileges on table "public"."prime_patterns" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."prime_patterns" to "anon";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."prime_patterns" to "authenticated";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."prime_patterns" to "service_role";
revoke all privileges on table "public"."raw_records" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."raw_records" to "anon";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."raw_records" to "authenticated";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."raw_records" to "service_role";
revoke all privileges on table "public"."registry_conflict_log" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."registry_conflict_log" to "anon";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."registry_conflict_log" to "authenticated";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."registry_conflict_log" to "service_role";
revoke all privileges on table "public"."schema_registry" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."schema_registry" to "anon";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."schema_registry" to "authenticated";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."schema_registry" to "service_role";
revoke all privileges on table "public"."signal_definitions" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."signal_definitions" to "anon";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."signal_definitions" to "authenticated";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."signal_definitions" to "service_role";
revoke all privileges on table "public"."signal_events" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."signal_events" to "anon";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."signal_events" to "authenticated";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."signal_events" to "service_role";
revoke all privileges on table "public"."statutes" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."statutes" to "anon";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."statutes" to "authenticated";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."statutes" to "service_role";
revoke all privileges on table "public"."streams" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."streams" to "anon";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."streams" to "authenticated";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."streams" to "service_role";
revoke all privileges on table "public"."verification_claims" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."verification_claims" to "service_role";
revoke all privileges on table "public"."verification_evidence" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."verification_evidence" to "service_role";
revoke all privileges on table "public"."verification_sources" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."verification_sources" to "service_role";
revoke all privileges on table "public"."verified_chronicle" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."verified_chronicle" to "service_role";
revoke all privileges on table "public"."workflow_registry" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."workflow_registry" to "anon";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."workflow_registry" to "authenticated";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."workflow_registry" to "service_role";
revoke all privileges on table "atlas"."v_bridge_operational_status" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on table "atlas"."v_bridge_status" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."v_bridge_status" to "anon";
grant select on table "atlas"."v_bridge_status" to "authenticated";
revoke all privileges on table "atlas"."v_bridge_sync_history" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."v_bridge_sync_history" to "anon";
grant select on table "atlas"."v_bridge_sync_history" to "authenticated";
revoke all privileges on table "atlas"."v_clauses_pending_review" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."v_clauses_pending_review" to "anon";
grant select on table "atlas"."v_clauses_pending_review" to "authenticated";
revoke all privileges on table "atlas"."v_cross_domain_entities" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."v_cross_domain_entities" to "anon";
grant select on table "atlas"."v_cross_domain_entities" to "authenticated";
revoke all privileges on table "atlas"."v_entity_risk_score" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."v_entity_risk_score" to "anon";
grant select on table "atlas"."v_entity_risk_score" to "authenticated";
revoke all privileges on table "atlas"."v_lighthouse_case_queue" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."v_lighthouse_case_queue" to "anon";
grant select on table "atlas"."v_lighthouse_case_queue" to "authenticated";
revoke all privileges on table "atlas"."v_lighthouse_civic_map" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."v_lighthouse_civic_map" to "anon";
grant select on table "atlas"."v_lighthouse_civic_map" to "authenticated";
revoke all privileges on table "atlas"."v_lighthouse_entity_watchlist" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."v_lighthouse_entity_watchlist" to "anon";
grant select on table "atlas"."v_lighthouse_entity_watchlist" to "authenticated";
revoke all privileges on table "atlas"."v_live_data_signal_candidate_current_v1" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on table "atlas"."v_pdf_extraction_pending" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."v_pdf_extraction_pending" to "anon";
grant select on table "atlas"."v_pdf_extraction_pending" to "authenticated";
revoke all privileges on table "atlas"."v_prism_escalation_contacts" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."v_prism_escalation_contacts" to "anon";
grant select on table "atlas"."v_prism_escalation_contacts" to "authenticated";
revoke all privileges on table "atlas"."v_propublica_unresolved_metadata_candidate_v1" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on table "atlas"."v_rosetta_contacts" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "atlas"."v_rosetta_contacts" to "anon";
grant select on table "atlas"."v_rosetta_contacts" to "authenticated";
revoke all privileges on table "atlas"."v_signal_intelligence_cards" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on table "public"."benefits_wa" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."benefits_wa" to "anon";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."benefits_wa" to "authenticated";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."benefits_wa" to "service_role";
revoke all privileges on table "public"."canonical_agency_authority" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."canonical_agency_authority" to "anon";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."canonical_agency_authority" to "authenticated";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."canonical_agency_authority" to "service_role";
revoke all privileges on table "public"."canonical_jurisdiction_authority" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."canonical_jurisdiction_authority" to "anon";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."canonical_jurisdiction_authority" to "authenticated";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."canonical_jurisdiction_authority" to "service_role";
revoke all privileges on table "public"."civic_map_signals" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."civic_map_signals" to "anon";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."civic_map_signals" to "authenticated";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."civic_map_signals" to "service_role";
revoke all privileges on table "public"."entity_registry" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."entity_registry" to "anon";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."entity_registry" to "authenticated";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."entity_registry" to "service_role";
revoke all privileges on table "public"."food_banks" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."food_banks" to "anon";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."food_banks" to "authenticated";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."food_banks" to "service_role";
revoke all privileges on table "public"."nonprofits_wa" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."nonprofits_wa" to "anon";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."nonprofits_wa" to "authenticated";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."nonprofits_wa" to "service_role";
revoke all privileges on table "public"."v_actionable_canonical_records" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_actionable_canonical_records" to "service_role";
revoke all privileges on table "public"."v_atlas_canonical_signal_type_summary_v1" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_atlas_canonical_signal_type_summary_v1" to "service_role";
revoke all privileges on table "public"."v_atlas_convergence_run_summary_v1" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_atlas_convergence_run_summary_v1" to "service_role";
revoke all privileges on table "public"."v_atlas_data_freshness" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_atlas_data_freshness" to "anon";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_atlas_data_freshness" to "authenticated";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_atlas_data_freshness" to "service_role";
revoke all privileges on table "public"."v_atlas_entity_cross_stream_summary_v1" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "public"."v_atlas_entity_cross_stream_summary_v1" to "service_role";
revoke all privileges on table "public"."v_atlas_entity_resolution_aliases_v1" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "public"."v_atlas_entity_resolution_aliases_v1" to "service_role";
revoke all privileges on table "public"."v_atlas_entity_resolution_registry_v1" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "public"."v_atlas_entity_resolution_registry_v1" to "service_role";
revoke all privileges on table "public"."v_atlas_error_summary" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_atlas_error_summary" to "anon";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_atlas_error_summary" to "authenticated";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_atlas_error_summary" to "service_role";
revoke all privileges on table "public"."v_atlas_event_entity_resolution_coverage_v1" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "public"."v_atlas_event_entity_resolution_coverage_v1" to "service_role";
revoke all privileges on table "public"."v_atlas_event_entity_resolution_review_v1" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "public"."v_atlas_event_entity_resolution_review_v1" to "service_role";
revoke all privileges on table "public"."v_atlas_health_dashboard" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_atlas_health_dashboard" to "anon";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_atlas_health_dashboard" to "authenticated";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_atlas_health_dashboard" to "service_role";
revoke all privileges on table "public"."v_atlas_jurisdiction_coverage" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_atlas_jurisdiction_coverage" to "anon";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_atlas_jurisdiction_coverage" to "authenticated";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_atlas_jurisdiction_coverage" to "service_role";
revoke all privileges on table "public"."v_atlas_observation_type_summary_v1" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_atlas_observation_type_summary_v1" to "service_role";
revoke all privileges on table "public"."v_atlas_processing_queue" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_atlas_processing_queue" to "anon";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_atlas_processing_queue" to "authenticated";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_atlas_processing_queue" to "service_role";
revoke all privileges on table "public"."v_atlas_resolved_signal_event_entities_v1" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "public"."v_atlas_resolved_signal_event_entities_v1" to "service_role";
revoke all privileges on table "public"."v_atlas_secrets_checklist" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_atlas_secrets_checklist" to "anon";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_atlas_secrets_checklist" to "authenticated";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_atlas_secrets_checklist" to "service_role";
revoke all privileges on table "public"."v_atlas_signal_candidate_detail_v1" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_atlas_signal_candidate_detail_v1" to "service_role";
revoke all privileges on table "public"."v_atlas_signal_candidate_rule_summary_v1" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_atlas_signal_candidate_rule_summary_v1" to "service_role";
revoke all privileges on table "public"."v_atlas_signal_derivation_summary_v1" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_atlas_signal_derivation_summary_v1" to "service_role";
revoke all privileges on table "public"."v_atlas_signal_event_entity_resolution_v1" from PUBLIC, "anon", "authenticated", "service_role";
grant select on table "public"."v_atlas_signal_event_entity_resolution_v1" to "service_role";
revoke all privileges on table "public"."v_atlas_signal_substrate_summary_v1" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_atlas_signal_substrate_summary_v1" to "service_role";
revoke all privileges on table "public"."v_atlas_signal_type_summary_v1" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_atlas_signal_type_summary_v1" to "service_role";
revoke all privileges on table "public"."v_atlas_source_inventory" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_atlas_source_inventory" to "anon";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_atlas_source_inventory" to "authenticated";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_atlas_source_inventory" to "service_role";
revoke all privileges on table "public"."v_atlas_source_operational_readiness_v1" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_atlas_source_operational_readiness_v1" to "service_role";
revoke all privileges on table "public"."v_atlas_stream_runtime_summary_v1" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_atlas_stream_runtime_summary_v1" to "service_role";
revoke all privileges on table "public"."v_atlas_ui_overview_v2" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_atlas_ui_overview_v2" to "service_role";
revoke all privileges on table "public"."v_atlas_ui_overview_v3" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_atlas_ui_overview_v3" to "service_role";
revoke all privileges on table "public"."v_atlas_ui_signal_derivation_v3" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_atlas_ui_signal_derivation_v3" to "service_role";
revoke all privileges on table "public"."v_atlas_ui_signal_substrate_v2" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_atlas_ui_signal_substrate_v2" to "service_role";
revoke all privileges on table "public"."v_blockers" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_blockers" to "anon";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_blockers" to "authenticated";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_blockers" to "service_role";
revoke all privileges on table "public"."v_bridge_operational_status" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_bridge_operational_status" to "anon";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_bridge_operational_status" to "authenticated";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_bridge_operational_status" to "service_role";
revoke all privileges on table "public"."v_canonical_record_quality" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_canonical_record_quality" to "service_role";
revoke all privileges on table "public"."v_case_detail" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_case_detail" to "anon";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_case_detail" to "authenticated";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_case_detail" to "service_role";
revoke all privileges on table "public"."v_chronicle_verification_status" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_chronicle_verification_status" to "service_role";
revoke all privileges on table "public"."v_civic_map_signals_production" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_civic_map_signals_production" to "anon";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_civic_map_signals_production" to "authenticated";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_civic_map_signals_production" to "service_role";
revoke all privileges on table "public"."v_civicmap_pins" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_civicmap_pins" to "anon";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_civicmap_pins" to "authenticated";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_civicmap_pins" to "service_role";
revoke all privileges on table "public"."v_judicial_map_signals_production" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_judicial_map_signals_production" to "anon";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_judicial_map_signals_production" to "authenticated";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_judicial_map_signals_production" to "service_role";
revoke all privileges on table "public"."v_unified_civic_infrastructure" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_unified_civic_infrastructure" to "anon";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_unified_civic_infrastructure" to "authenticated";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."v_unified_civic_infrastructure" to "service_role";
revoke all privileges on table "public"."workflow_overlay_view" from PUBLIC, "anon", "authenticated", "service_role";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."workflow_overlay_view" to "anon";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."workflow_overlay_view" to "authenticated";
grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."workflow_overlay_view" to "service_role";
revoke all privileges on function "atlas"."bridge_process_queue_v3"(p_batch_size integer) from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on function "atlas"."bridge_sync_to_lighthouse"(p_signal_id bigint, p_batch_size integer) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "atlas"."bridge_sync_to_lighthouse"(p_signal_id bigint, p_batch_size integer) to PUBLIC;
grant execute on function "atlas"."bridge_sync_to_lighthouse"(p_signal_id bigint, p_batch_size integer) to "authenticated";
revoke all privileges on function "atlas"."claim_pdf_extraction_job"(p_worker_id character varying) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "atlas"."claim_pdf_extraction_job"(p_worker_id character varying) to PUBLIC;
revoke all privileges on function "atlas"."complete_pdf_extraction"(p_queue_id bigint, p_extracted_text text, p_extraction_method character varying, p_extraction_confidence numeric, p_page_count integer, p_clauses_found jsonb) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "atlas"."complete_pdf_extraction"(p_queue_id bigint, p_extracted_text text, p_extraction_method character varying, p_extraction_confidence numeric, p_page_count integer, p_clauses_found jsonb) to PUBLIC;
revoke all privileges on function "atlas"."enforce_live_data_signal_candidate_currentness_v1"() from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "atlas"."enforce_live_data_signal_candidate_currentness_v1"() to PUBLIC;
revoke all privileges on function "atlas"."engine_activate_discovered_schema"(p_draft_id bigint, p_reviewed_by character varying, p_review_notes text) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "atlas"."engine_activate_discovered_schema"(p_draft_id bigint, p_reviewed_by character varying, p_review_notes text) to PUBLIC;
revoke all privileges on function "atlas"."engine_extract_entity"(p_schema_name character varying, p_target_table character varying, p_source_record_id character varying, p_jurisdiction character varying, p_entity_type character varying, p_name character varying, p_address character varying, p_email character varying, p_phone character varying, p_raw_payload jsonb) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "atlas"."engine_extract_entity"(p_schema_name character varying, p_target_table character varying, p_source_record_id character varying, p_jurisdiction character varying, p_entity_type character varying, p_name character varying, p_address character varying, p_email character varying, p_phone character varying, p_raw_payload jsonb) to PUBLIC;
revoke all privileges on function "atlas"."engine_probe_platform"(p_platform_id character varying, p_jurisdiction character varying, p_listing_response jsonb) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "atlas"."engine_probe_platform"(p_platform_id character varying, p_jurisdiction character varying, p_listing_response jsonb) to PUBLIC;
revoke all privileges on function "atlas"."entity_type_compatible_v1"(p_expected_entity_type text, p_actual_entity_type text) from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on function "atlas"."event_entity_source_system_text_v1"(p_source_population_table text, p_source_systems jsonb, p_metadata jsonb) from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on function "atlas"."fail_pdf_extraction"(p_queue_id bigint, p_error_message text) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "atlas"."fail_pdf_extraction"(p_queue_id bigint, p_error_message text) to PUBLIC;
revoke all privileges on function "atlas"."guard_signal_event_entity_resolution_immutable_v1"() from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "atlas"."guard_signal_event_entity_resolution_immutable_v1"() to PUBLIC;
revoke all privileges on function "atlas"."guard_signal_event_entity_resolution_rule_immutable_v1"() from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "atlas"."guard_signal_event_entity_resolution_rule_immutable_v1"() to PUBLIC;
revoke all privileges on function "atlas"."infer_entity_identifier_type_v1"(p_source_population_table text, p_source_systems jsonb, p_metadata jsonb, p_value text) from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on function "atlas"."live_data_signal_candidate_semantic_key_v1"(p_rule_id text, p_signal_type text, p_primary_stream_id text, p_jurisdiction_id text, p_title text) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "atlas"."live_data_signal_candidate_semantic_key_v1"(p_rule_id text, p_signal_type text, p_primary_stream_id text, p_jurisdiction_id text, p_title text) to PUBLIC;
revoke all privileges on function "atlas"."live_data_signal_candidate_semantic_key_v2"(p_rule_id text, p_signal_type text, p_primary_stream_id text, p_jurisdiction_id text, p_title text, p_entity_ids text[]) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "atlas"."live_data_signal_candidate_semantic_key_v2"(p_rule_id text, p_signal_type text, p_primary_stream_id text, p_jurisdiction_id text, p_title text, p_entity_ids text[]) to PUBLIC;
revoke all privileges on function "atlas"."log_provenance"() from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "atlas"."log_provenance"() to PUBLIC;
revoke all privileges on function "atlas"."map_severity_to_enum"(p_severity numeric) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "atlas"."map_severity_to_enum"(p_severity numeric) to PUBLIC;
revoke all privileges on function "atlas"."prevent_civic_genome_legislative_projection_mutation"() from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "atlas"."prevent_civic_genome_legislative_projection_mutation"() to PUBLIC;
revoke all privileges on function "atlas"."prevent_civic_genome_snapshot_mutation"() from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "atlas"."prevent_civic_genome_snapshot_mutation"() to PUBLIC;
revoke all privileges on function "atlas"."prevent_civic_genome_trait_accounting_mutation"() from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "atlas"."prevent_civic_genome_trait_accounting_mutation"() to PUBLIC;
revoke all privileges on function "atlas"."prevent_convergence_mutation"() from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on function "atlas"."resolve_signal_event_entity_candidate_exact_v1"(p_normalized_entity_value text, p_source_identifier_type text, p_normalized_identifier_value text, p_expected_entity_type text) from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on function "atlas"."signal_event_identity_hash_v1"(p_stream_id text, p_timestamp timestamp with time zone, p_signal_type text, p_spacetime jsonb, p_provenance jsonb, p_payload jsonb, p_source_id text, p_jurisdiction_id text, p_module_hint text) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "atlas"."signal_event_identity_hash_v1"(p_stream_id text, p_timestamp timestamp with time zone, p_signal_type text, p_spacetime jsonb, p_provenance jsonb, p_payload jsonb, p_source_id text, p_jurisdiction_id text, p_module_hint text) to "service_role";
revoke all privileges on function "atlas"."signal_event_source_record_key_v1"(p_payload jsonb, p_provenance jsonb) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "atlas"."signal_event_source_record_key_v1"(p_payload jsonb, p_provenance jsonb) to PUBLIC;
revoke all privileges on function "atlas"."trigger_set_timestamp"() from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "atlas"."trigger_set_timestamp"() to PUBLIC;
revoke all privileges on function "public"."atlas_bridge_config_for"(p_bridge_id text) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."atlas_bridge_config_for"(p_bridge_id text) to "service_role";
revoke all privileges on function "public"."atlas_bridge_latest_log_for"(p_bridge_id text, p_sync_type text, p_source_record_id text) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."atlas_bridge_latest_log_for"(p_bridge_id text, p_sync_type text, p_source_record_id text) to "service_role";
revoke all privileges on function "public"."atlas_bridge_was_sent"(p_bridge_id text, p_sync_type text, p_source_table text, p_source_record_id text) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."atlas_bridge_was_sent"(p_bridge_id text, p_sync_type text, p_source_table text, p_source_record_id text) to "service_role";
revoke all privileges on function "public"."atlas_civic_genome_legislative_projection_persist_v1"(p_bundle jsonb) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."atlas_civic_genome_legislative_projection_persist_v1"(p_bundle jsonb) to "service_role";
revoke all privileges on function "public"."atlas_civic_genome_legislative_trait_accounting_persist_v1"(p_receipt jsonb) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."atlas_civic_genome_legislative_trait_accounting_persist_v1"(p_receipt jsonb) to "service_role";
revoke all privileges on function "public"."atlas_civic_genome_snapshot_get_v1"(p_snapshot_id text) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."atlas_civic_genome_snapshot_get_v1"(p_snapshot_id text) to "service_role";
revoke all privileges on function "public"."atlas_civic_genome_snapshot_persist_v1"(p_record jsonb) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."atlas_civic_genome_snapshot_persist_v1"(p_record jsonb) to "service_role";
revoke all privileges on function "public"."atlas_convergence_get_replay_bundle_v1"(p_run_key text) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."atlas_convergence_get_replay_bundle_v1"(p_run_key text) to "service_role";
revoke all privileges on function "public"."atlas_convergence_get_run_v1"(p_run_key text) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."atlas_convergence_get_run_v1"(p_run_key text) to "service_role";
revoke all privileges on function "public"."atlas_convergence_persist_run_v1"(p_bundle jsonb) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."atlas_convergence_persist_run_v1"(p_bundle jsonb) to "service_role";
revoke all privileges on function "public"."atlas_convergence_source_population_page_v1"(p_from_timestamp timestamp with time zone, p_to_timestamp timestamp with time zone, p_after_stream_id text, p_after_offset bigint, p_limit integer) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."atlas_convergence_source_population_page_v1"(p_from_timestamp timestamp with time zone, p_to_timestamp timestamp with time zone, p_after_stream_id text, p_after_offset bigint, p_limit integer) to "service_role";
revoke all privileges on function "public"."atlas_event_entity_candidate_key_v1"(p_rule_id text, p_rule_version text, p_entity_role text, p_source_field text, p_normalized_entity_value text, p_source_identifier_field text, p_source_identifier_type text, p_normalized_identifier_value text, p_expected_entity_type text) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."atlas_event_entity_candidate_key_v1"(p_rule_id text, p_rule_version text, p_entity_role text, p_source_field text, p_normalized_entity_value text, p_source_identifier_field text, p_source_identifier_type text, p_normalized_identifier_value text, p_expected_entity_type text) to PUBLIC;
grant execute on function "public"."atlas_event_entity_candidate_key_v1"(p_rule_id text, p_rule_version text, p_entity_role text, p_source_field text, p_normalized_entity_value text, p_source_identifier_field text, p_source_identifier_type text, p_normalized_identifier_value text, p_expected_entity_type text) to "anon";
grant execute on function "public"."atlas_event_entity_candidate_key_v1"(p_rule_id text, p_rule_version text, p_entity_role text, p_source_field text, p_normalized_entity_value text, p_source_identifier_field text, p_source_identifier_type text, p_normalized_identifier_value text, p_expected_entity_type text) to "authenticated";
grant execute on function "public"."atlas_event_entity_candidate_key_v1"(p_rule_id text, p_rule_version text, p_entity_role text, p_source_field text, p_normalized_entity_value text, p_source_identifier_field text, p_source_identifier_type text, p_normalized_identifier_value text, p_expected_entity_type text) to "service_role";
revoke all privileges on function "public"."atlas_event_entity_resolution_hash_v1"(p_event_input_hash text, p_entity_index_hash text, p_rule_manifest_hash text, p_rule_id text, p_rule_version text, p_candidate_key text, p_entity_role text, p_source_field text, p_normalized_entity_value text, p_source_identifier_field text, p_source_identifier_type text, p_normalized_identifier_value text, p_expected_entity_type text, p_resolution_status text, p_entity_id text, p_match_method text, p_candidate_entity_ids text[], p_resolver_id text, p_resolver_version text) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."atlas_event_entity_resolution_hash_v1"(p_event_input_hash text, p_entity_index_hash text, p_rule_manifest_hash text, p_rule_id text, p_rule_version text, p_candidate_key text, p_entity_role text, p_source_field text, p_normalized_entity_value text, p_source_identifier_field text, p_source_identifier_type text, p_normalized_identifier_value text, p_expected_entity_type text, p_resolution_status text, p_entity_id text, p_match_method text, p_candidate_entity_ids text[], p_resolver_id text, p_resolver_version text) to PUBLIC;
grant execute on function "public"."atlas_event_entity_resolution_hash_v1"(p_event_input_hash text, p_entity_index_hash text, p_rule_manifest_hash text, p_rule_id text, p_rule_version text, p_candidate_key text, p_entity_role text, p_source_field text, p_normalized_entity_value text, p_source_identifier_field text, p_source_identifier_type text, p_normalized_identifier_value text, p_expected_entity_type text, p_resolution_status text, p_entity_id text, p_match_method text, p_candidate_entity_ids text[], p_resolver_id text, p_resolver_version text) to "anon";
grant execute on function "public"."atlas_event_entity_resolution_hash_v1"(p_event_input_hash text, p_entity_index_hash text, p_rule_manifest_hash text, p_rule_id text, p_rule_version text, p_candidate_key text, p_entity_role text, p_source_field text, p_normalized_entity_value text, p_source_identifier_field text, p_source_identifier_type text, p_normalized_identifier_value text, p_expected_entity_type text, p_resolution_status text, p_entity_id text, p_match_method text, p_candidate_entity_ids text[], p_resolver_id text, p_resolver_version text) to "authenticated";
grant execute on function "public"."atlas_event_entity_resolution_hash_v1"(p_event_input_hash text, p_entity_index_hash text, p_rule_manifest_hash text, p_rule_id text, p_rule_version text, p_candidate_key text, p_entity_role text, p_source_field text, p_normalized_entity_value text, p_source_identifier_field text, p_source_identifier_type text, p_normalized_identifier_value text, p_expected_entity_type text, p_resolution_status text, p_entity_id text, p_match_method text, p_candidate_entity_ids text[], p_resolver_id text, p_resolver_version text) to "service_role";
revoke all privileges on function "public"."atlas_event_entity_source_value_v1"(p_rule_id text, p_source_field text, p_source_field_value text) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."atlas_event_entity_source_value_v1"(p_rule_id text, p_source_field text, p_source_field_value text) to PUBLIC;
grant execute on function "public"."atlas_event_entity_source_value_v1"(p_rule_id text, p_source_field text, p_source_field_value text) to "anon";
grant execute on function "public"."atlas_event_entity_source_value_v1"(p_rule_id text, p_source_field text, p_source_field_value text) to "authenticated";
grant execute on function "public"."atlas_event_entity_source_value_v1"(p_rule_id text, p_source_field text, p_source_field_value text) to "service_role";
revoke all privileges on function "public"."atlas_event_payload_field_text_v1"(p_payload jsonb, p_source_field text) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."atlas_event_payload_field_text_v1"(p_payload jsonb, p_source_field text) to PUBLIC;
grant execute on function "public"."atlas_event_payload_field_text_v1"(p_payload jsonb, p_source_field text) to "anon";
grant execute on function "public"."atlas_event_payload_field_text_v1"(p_payload jsonb, p_source_field text) to "authenticated";
grant execute on function "public"."atlas_event_payload_field_text_v1"(p_payload jsonb, p_source_field text) to "service_role";
revoke all privileges on function "public"."atlas_insert_bridge_sync_log"(p_bridge_id text, p_sync_type text, p_source_table text, p_source_record_id text, p_target_table text, p_target_record_id text, p_status text, p_request_payload jsonb, p_response_payload jsonb, p_error_message text, p_duration_ms integer) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."atlas_insert_bridge_sync_log"(p_bridge_id text, p_sync_type text, p_source_table text, p_source_record_id text, p_target_table text, p_target_record_id text, p_status text, p_request_payload jsonb, p_response_payload jsonb, p_error_message text, p_duration_ms integer) to "service_role";
revoke all privileges on function "public"."atlas_normalize_entity_identifier_v1"(p_identifier_type text, p_value text) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."atlas_normalize_entity_identifier_v1"(p_identifier_type text, p_value text) to PUBLIC;
grant execute on function "public"."atlas_normalize_entity_identifier_v1"(p_identifier_type text, p_value text) to "anon";
grant execute on function "public"."atlas_normalize_entity_identifier_v1"(p_identifier_type text, p_value text) to "authenticated";
grant execute on function "public"."atlas_normalize_entity_identifier_v1"(p_identifier_type text, p_value text) to "service_role";
revoke all privileges on function "public"."atlas_normalize_entity_name_v1"(p_value text) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."atlas_normalize_entity_name_v1"(p_value text) to PUBLIC;
grant execute on function "public"."atlas_normalize_entity_name_v1"(p_value text) to "anon";
grant execute on function "public"."atlas_normalize_entity_name_v1"(p_value text) to "authenticated";
grant execute on function "public"."atlas_normalize_entity_name_v1"(p_value text) to "service_role";
revoke all privileges on function "public"."atlas_set_source_fallback_updated_at"() from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."atlas_set_source_fallback_updated_at"() to PUBLIC;
grant execute on function "public"."atlas_set_source_fallback_updated_at"() to "anon";
grant execute on function "public"."atlas_set_source_fallback_updated_at"() to "authenticated";
grant execute on function "public"."atlas_set_source_fallback_updated_at"() to "service_role";
revoke all privileges on function "public"."atlas_signal_event_input_hash_v1"(p_stream_id text, p_offset bigint, p_timestamp timestamp with time zone, p_signal_type text, p_spacetime jsonb, p_provenance jsonb, p_payload jsonb, p_source_id text, p_jurisdiction_id text, p_module_hint text, p_ingested_at timestamp with time zone) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."atlas_signal_event_input_hash_v1"(p_stream_id text, p_offset bigint, p_timestamp timestamp with time zone, p_signal_type text, p_spacetime jsonb, p_provenance jsonb, p_payload jsonb, p_source_id text, p_jurisdiction_id text, p_module_hint text, p_ingested_at timestamp with time zone) to PUBLIC;
grant execute on function "public"."atlas_signal_event_input_hash_v1"(p_stream_id text, p_offset bigint, p_timestamp timestamp with time zone, p_signal_type text, p_spacetime jsonb, p_provenance jsonb, p_payload jsonb, p_source_id text, p_jurisdiction_id text, p_module_hint text, p_ingested_at timestamp with time zone) to "anon";
grant execute on function "public"."atlas_signal_event_input_hash_v1"(p_stream_id text, p_offset bigint, p_timestamp timestamp with time zone, p_signal_type text, p_spacetime jsonb, p_provenance jsonb, p_payload jsonb, p_source_id text, p_jurisdiction_id text, p_module_hint text, p_ingested_at timestamp with time zone) to "authenticated";
grant execute on function "public"."atlas_signal_event_input_hash_v1"(p_stream_id text, p_offset bigint, p_timestamp timestamp with time zone, p_signal_type text, p_spacetime jsonb, p_provenance jsonb, p_payload jsonb, p_source_id text, p_jurisdiction_id text, p_module_hint text, p_ingested_at timestamp with time zone) to "service_role";
revoke all privileges on function "public"."bridge_atlas_stream_runtime_snapshot_v1"(p_snapshot jsonb) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."bridge_atlas_stream_runtime_snapshot_v1"(p_snapshot jsonb) to "service_role";
revoke all privileges on function "public"."bridge_live_data_signal_candidates_v1"(p_run_id uuid, p_limit integer) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."bridge_live_data_signal_candidates_v1"(p_run_id uuid, p_limit integer) to "service_role";
revoke all privileges on function "public"."bridge_live_data_signal_retirements_v1"(p_run_id uuid, p_limit integer) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."bridge_live_data_signal_retirements_v1"(p_run_id uuid, p_limit integer) to "service_role";
revoke all privileges on function "public"."complete_atlas_event_entity_resolution_run_v1"(p_run_id uuid, p_status text, p_counts jsonb, p_last_stream_id text, p_last_offset bigint, p_error_message text) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."complete_atlas_event_entity_resolution_run_v1"(p_run_id uuid, p_status text, p_counts jsonb, p_last_stream_id text, p_last_offset bigint, p_error_message text) to "service_role";
revoke all privileges on function "public"."detect_propublica_unresolved_metadata_v1"(p_min_unique_records integer, p_min_unresolved_rate numeric, p_limit integer) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."detect_propublica_unresolved_metadata_v1"(p_min_unique_records integer, p_min_unresolved_rate numeric, p_limit integer) to "service_role";
revoke all privileges on function "public"."enqueue_live_data_signal_candidates_v1"(p_run_id uuid, p_limit integer) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."enqueue_live_data_signal_candidates_v1"(p_run_id uuid, p_limit integer) to "service_role";
revoke all privileges on function "public"."evaluate_canonical_payload_usefulness"(p_record_kind text, p_contacts jsonb, p_legal_basis jsonb, p_escalation_paths jsonb, p_source_url text, p_source_anchor text, p_verbatim_text text) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."evaluate_canonical_payload_usefulness"(p_record_kind text, p_contacts jsonb, p_legal_basis jsonb, p_escalation_paths jsonb, p_source_url text, p_source_anchor text, p_verbatim_text text) to "service_role";
revoke all privileges on function "public"."fetch_atlas_entity_cross_stream_correlations_v1"(p_min_streams integer, p_limit integer, p_entity_id text) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."fetch_atlas_entity_cross_stream_correlations_v1"(p_min_streams integer, p_limit integer, p_entity_id text) to "service_role";
revoke all privileges on function "public"."fetch_atlas_event_entity_resolution_review_v1"(p_resolution_status text, p_min_event_count integer, p_limit integer) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."fetch_atlas_event_entity_resolution_review_v1"(p_resolution_status text, p_min_event_count integer, p_limit integer) to "service_role";
revoke all privileges on function "public"."fetch_atlas_resolved_entity_events_v1"(p_entity_id text, p_limit integer, p_before_timestamp timestamp with time zone) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."fetch_atlas_resolved_entity_events_v1"(p_entity_id text, p_limit integer, p_before_timestamp timestamp with time zone) to "service_role";
revoke all privileges on function "public"."fetch_atlas_signal_events_for_entity_resolution_v1"(p_batch_size integer, p_stream_id text, p_after_stream_id text, p_after_offset bigint) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."fetch_atlas_signal_events_for_entity_resolution_v1"(p_batch_size integer, p_stream_id text, p_after_stream_id text, p_after_offset bigint) to "service_role";
revoke all privileges on function "public"."get_lighthouse_signal_events"(p_stream_id text, p_offset bigint, p_limit integer) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."get_lighthouse_signal_events"(p_stream_id text, p_offset bigint, p_limit integer) to "anon";
grant execute on function "public"."get_lighthouse_signal_events"(p_stream_id text, p_offset bigint, p_limit integer) to "authenticated";
grant execute on function "public"."get_lighthouse_signal_events"(p_stream_id text, p_offset bigint, p_limit integer) to "service_role";
revoke all privileges on function "public"."get_lighthouse_stream_definition"(p_stream_id text) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."get_lighthouse_stream_definition"(p_stream_id text) to "anon";
grant execute on function "public"."get_lighthouse_stream_definition"(p_stream_id text) to "authenticated";
grant execute on function "public"."get_lighthouse_stream_definition"(p_stream_id text) to "service_role";
revoke all privileges on function "public"."ingest_canonical_extracted_record_batch"(p_records jsonb) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."ingest_canonical_extracted_record_batch"(p_records jsonb) to "service_role";
revoke all privileges on function "public"."ingest_canonical_extracted_record"(p_record jsonb) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."ingest_canonical_extracted_record"(p_record jsonb) to "service_role";
revoke all privileges on function "public"."ingest_extraction_candidate_batch"(p_records jsonb) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."ingest_extraction_candidate_batch"(p_records jsonb) to "service_role";
revoke all privileges on function "public"."jsonb_array_count"(p_value jsonb) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."jsonb_array_count"(p_value jsonb) to "service_role";
revoke all privileges on function "public"."mark_live_data_signal_candidate_bridge_v1"(p_candidate_id uuid, p_status text, p_lighthouse_record_id uuid, p_error_message text) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."mark_live_data_signal_candidate_bridge_v1"(p_candidate_id uuid, p_status text, p_lighthouse_record_id uuid, p_error_message text) to "service_role";
revoke all privileges on function "public"."persist_atlas_event_entity_resolution_batch_v1"(p_run_id uuid, p_resolver_id text, p_resolver_version text, p_rule_manifest_hash text, p_entity_index_hash text, p_rows jsonb) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."persist_atlas_event_entity_resolution_batch_v1"(p_run_id uuid, p_resolver_id text, p_resolver_version text, p_rule_manifest_hash text, p_entity_index_hash text, p_rows jsonb) to "service_role";
revoke all privileges on function "public"."persist_domain3_population_run_v1"(p_rule jsonb, p_run_id uuid, p_observations_scanned bigint, p_candidates jsonb) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."persist_domain3_population_run_v1"(p_rule jsonb, p_run_id uuid, p_observations_scanned bigint, p_candidates jsonb) to "service_role";
revoke all privileges on function "public"."persist_signal_event_batch_v2"(p_events jsonb) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."persist_signal_event_batch_v2"(p_events jsonb) to "service_role";
revoke all privileges on function "public"."promote_verified_chronicle"() from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."promote_verified_chronicle"() to "service_role";
revoke all privileges on function "public"."reconcile_domain3_population_currentness_v1"(p_rule_id text, p_rule_version text, p_run_id uuid, p_current_candidate_hashes jsonb, p_replay_complete boolean) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."reconcile_domain3_population_currentness_v1"(p_rule_id text, p_rule_version text, p_run_id uuid, p_current_candidate_hashes jsonb, p_replay_complete boolean) to "service_role";
revoke all privileges on function "public"."register_domain3_population_rules_v1"(p_rules jsonb) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."register_domain3_population_rules_v1"(p_rules jsonb) to "service_role";
revoke all privileges on function "public"."search_atlas_pins"(search_query text) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."search_atlas_pins"(search_query text) to "service_role";
revoke all privileges on function "public"."set_updated_at"() from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."set_updated_at"() to "service_role";
revoke all privileges on function "public"."settle_live_data_signal_candidates_v1"(p_run_id uuid) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."settle_live_data_signal_candidates_v1"(p_run_id uuid) to "service_role";
revoke all privileges on function "public"."start_atlas_event_entity_resolution_run_v1"(p_run_id uuid, p_resolver_id text, p_resolver_version text, p_rule_manifest_hash text, p_entity_index_hash text, p_stream_id text, p_batch_size integer, p_input_manifest jsonb) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."start_atlas_event_entity_resolution_run_v1"(p_run_id uuid, p_resolver_id text, p_resolver_version text, p_rule_manifest_hash text, p_entity_index_hash text, p_stream_id text, p_batch_size integer, p_input_manifest jsonb) to "service_role";
revoke all privileges on function "public"."trigger_connector_run"(connector_name text) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."trigger_connector_run"(connector_name text) to PUBLIC;
grant execute on function "public"."trigger_connector_run"(connector_name text) to "anon";
grant execute on function "public"."trigger_connector_run"(connector_name text) to "authenticated";
grant execute on function "public"."trigger_connector_run"(connector_name text) to "service_role";
revoke all privileges on function "public"."upsert_atlas_entity_registry"(_entities jsonb) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."upsert_atlas_entity_registry"(_entities jsonb) to "service_role";
revoke all privileges on function "public"."upsert_openstates_civic_map_signals_v1"(_signals jsonb) from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."upsert_openstates_civic_map_signals_v1"(_signals jsonb) to "service_role";
revoke all privileges on function "public"."verify_atlas_tables"() from PUBLIC, "anon", "authenticated", "service_role";
grant execute on function "public"."verify_atlas_tables"() to PUBLIC;
grant execute on function "public"."verify_atlas_tables"() to "anon";
grant execute on function "public"."verify_atlas_tables"() to "authenticated";
grant execute on function "public"."verify_atlas_tables"() to "service_role";

-- ---- schema and default privileges ----
revoke all privileges on schema "atlas" from PUBLIC, "anon", "authenticated", "service_role";
grant usage on schema "atlas" to "anon";
grant usage on schema "atlas" to "service_role";
revoke all privileges on schema "private" from PUBLIC, "anon", "authenticated", "service_role";
revoke all privileges on schema "public" from PUBLIC, "anon", "authenticated", "service_role", "postgres";
grant usage on schema "public" to PUBLIC;
grant usage on schema "public" to "postgres";
grant usage on schema "public" to "anon";
grant usage on schema "public" to "authenticated";
grant usage on schema "public" to "service_role";
comment on schema "public" is 'standard public schema';
alter default privileges for role "postgres" in schema "public" revoke all on sequences from PUBLIC;
alter default privileges for role "postgres" in schema "public" revoke all on sequences from "anon";
alter default privileges for role "postgres" in schema "public" revoke all on sequences from "authenticated";
alter default privileges for role "postgres" in schema "public" revoke all on sequences from "service_role";
alter default privileges for role "postgres" in schema "public" grant select, update, usage on sequences to "anon";
alter default privileges for role "postgres" in schema "public" grant select, update, usage on sequences to "authenticated";
alter default privileges for role "postgres" in schema "public" grant select, update, usage on sequences to "service_role";
alter default privileges for role "postgres" in schema "public" revoke all on functions from PUBLIC;
alter default privileges for role "postgres" in schema "public" revoke all on functions from "anon";
alter default privileges for role "postgres" in schema "public" revoke all on functions from "authenticated";
alter default privileges for role "postgres" in schema "public" revoke all on functions from "service_role";
alter default privileges for role "postgres" in schema "public" grant execute on functions to "anon";
alter default privileges for role "postgres" in schema "public" grant execute on functions to "authenticated";
alter default privileges for role "postgres" in schema "public" grant execute on functions to "service_role";
alter default privileges for role "postgres" in schema "public" revoke all on tables from PUBLIC;
alter default privileges for role "postgres" in schema "public" revoke all on tables from "anon";
alter default privileges for role "postgres" in schema "public" revoke all on tables from "authenticated";
alter default privileges for role "postgres" in schema "public" revoke all on tables from "service_role";
alter default privileges for role "postgres" in schema "public" grant delete, insert, maintain, references, select, trigger, truncate, update on tables to "anon";
alter default privileges for role "postgres" in schema "public" grant delete, insert, maintain, references, select, trigger, truncate, update on tables to "authenticated";
alter default privileges for role "postgres" in schema "public" grant delete, insert, maintain, references, select, trigger, truncate, update on tables to "service_role";

-- ---- realtime publication membership ----
do $publication$ begin if not exists (select 1 from pg_publication where pubname='supabase_realtime') then raise exception 'required publication supabase_realtime is missing'; end if; if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='atlas' and tablename='atlas_case_links') then execute 'alter publication "supabase_realtime" add table "atlas"."atlas_case_links"'; end if; end $publication$;
do $publication$ begin if not exists (select 1 from pg_publication where pubname='supabase_realtime') then raise exception 'required publication supabase_realtime is missing'; end if; if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='atlas' and tablename='convergence_events') then execute 'alter publication "supabase_realtime" add table "atlas"."convergence_events"'; end if; end $publication$;
do $publication$ begin if not exists (select 1 from pg_publication where pubname='supabase_realtime') then raise exception 'required publication supabase_realtime is missing'; end if; if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='atlas' and tablename='corruption_indicators') then execute 'alter publication "supabase_realtime" add table "atlas"."corruption_indicators"'; end if; end $publication$;
do $publication$ begin if not exists (select 1 from pg_publication where pubname='supabase_realtime') then raise exception 'required publication supabase_realtime is missing'; end if; if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='atlas' and tablename='signals') then execute 'alter publication "supabase_realtime" add table "atlas"."signals"'; end if; end $publication$;

-- ---- intentional security hardening ----
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
reset check_function_bodies;
