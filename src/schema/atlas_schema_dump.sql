-- Atlas Supabase schema inventory dump
-- Project ref: bjdjjgnkhxblnpdrjqtw
-- Captured at: 2026-05-09T08:06:11.757413+00:00
-- This file is an introspection artifact. Use src/schema/001_streaming_tables.sql for executable streaming DDL.

-- TABLE public.agency_metrics
-- RLS enabled: true
--   id: uuid not null default gen_random_uuid()
--   entity_id: text not null
--   agency_name: text not null
--   agency_type: text
--   jurisdiction: text
--   metric_type: text not null
--   metric_value: numeric
--   period: text
--   source: text
--   created_at: timestamp with time zone not null default now()
--   updated_at: timestamp with time zone not null default now()
--   primary key: id

-- TABLE public.case_law
-- RLS enabled: true
--   id: uuid not null default uuid_generate_v4()
--   jurisdiction_id: uuid
--   external_id: character varying not null
--   case_name: text
--   court: character varying
--   court_id: character varying
--   decision_date: date
--   citation: character varying
--   docket_number: character varying
--   case_type: character varying
--   text: text
--   status: character varying default 'published'::character varying
--   source_url: text
--   metadata: jsonb default '{}'::jsonb
--   created_at: timestamp with time zone default now()
--   updated_at: timestamp with time zone default now()
--   primary key: id

-- TABLE public.civic_map_resources
-- RLS enabled: true
--   id: uuid not null default gen_random_uuid()
--   name: text not null
--   resource_type: text not null
--   address: text
--   city: text
--   state: text
--   phone: text
--   url: text
--   lat: numeric
--   lon: numeric
--   source_table: text not null
--   source_id: text
--   extra_json: jsonb
--   created_at: timestamp with time zone not null default now()
--   updated_at: timestamp with time zone not null default now()
--   primary key: id

-- TABLE public.connector_registry
-- RLS enabled: true
--   id: uuid not null default uuid_generate_v4()
--   name: character varying not null
--   api_base_url: text not null
--   adapter_class: character varying not null
--   auth_type: character varying default 'none'::character varying
--   auth_config: jsonb default '{}'::jsonb
--   rate_limit_rpm: integer default 60
--   pagination_type: character varying default 'cursor'::character varying
--   pagination_config: jsonb default '{}'::jsonb
--   schedule_cron: character varying
--   jurisdiction_filter: jsonb default '{}'::jsonb
--   schema_id: uuid
--   active: boolean default true
--   last_run_at: timestamp with time zone
--   next_run_at: timestamp with time zone
--   created_at: timestamp with time zone default now()
--   updated_at: timestamp with time zone default now()
--   primary key: id

-- TABLE public.cursors
-- RLS enabled: true
--   cursor_id: text not null
--   stream_id: text not null
--   name: text not null
--   current_offset: bigint not null default 0
--   created_by: text not null
--   created_at: timestamp with time zone not null default now()
--   updated_at: timestamp with time zone not null default now()
--   primary key: cursor_id

-- TABLE public.ingest_jobs
-- RLS enabled: true
--   id: uuid not null default uuid_generate_v4()
--   connector_id: uuid not null
--   schema_id: uuid
--   status: character varying default 'pending'::character varying
--   started_at: timestamp with time zone default now()
--   completed_at: timestamp with time zone
--   records_fetched: integer default 0
--   records_inserted: integer default 0
--   records_updated: integer default 0
--   records_failed: integer default 0
--   records_deduplicated: integer default 0
--   next_cursor: text
--   error_log: jsonb default '{}'::jsonb
--   metadata: jsonb default '{}'::jsonb
--   primary key: id

-- TABLE public.investigative_jobs
-- RLS enabled: true
--   job_id: text not null
--   job_type: text not null
--   stream_id: text
--   cursor_id: text
--   status: text not null
--   params: jsonb not null default '{}'::jsonb
--   result: jsonb not null default '{}'::jsonb
--   error: text
--   function_id: text
--   created_at: timestamp with time zone not null default now()
--   completed_at: timestamp with time zone
--   primary key: job_id

-- TABLE public.jurisdictions
-- RLS enabled: true
--   id: uuid not null default gen_random_uuid()
--   geo_id: text not null
--   geo_type: text not null
--   geo_name: text not null
--   state_fips: text
--   county_fips: text
--   parent_id: text
--   lat: numeric
--   lon: numeric
--   created_at: timestamp with time zone not null default now()
--   updated_at: timestamp with time zone not null default now()
--   primary key: id

-- TABLE public.prime_patterns
-- RLS enabled: true
--   pattern_id: text not null
--   pattern_type: text not null
--   module: text not null
--   jurisdiction: text not null
--   stream_id: text
--   job_id: text
--   confidence: numeric not null default 0
--   severity: text not null default 'info'::text
--   detected_at: timestamp with time zone not null default now()
--   summary: text not null
--   evidence: jsonb not null default '{}'::jsonb
--   payload: jsonb not null default '{}'::jsonb
--   created_at: timestamp with time zone not null default now()
--   primary key: pattern_id

-- TABLE public.raw_records
-- RLS enabled: true
--   id: uuid not null default uuid_generate_v4()
--   connector_id: uuid not null
--   external_id: character varying not null
--   raw_payload: jsonb not null
--   sha256_hash: character varying not null
--   fetch_timestamp: timestamp with time zone default now()
--   process_status: character varying default 'pending'::character varying
--   processed_at: timestamp with time zone
--   error_message: text
--   primary key: id

-- TABLE public.schema_registry
-- RLS enabled: true
--   id: uuid not null default uuid_generate_v4()
--   name: character varying not null
--   version: character varying default '1.0'::character varying
--   target_table: character varying not null
--   source_type: character varying not null
--   field_mappings: jsonb not null default '{}'::jsonb
--   validation_rules: jsonb default '{}'::jsonb
--   transform_logic: jsonb default '{}'::jsonb
--   entity_extraction_config: jsonb default '{}'::jsonb
--   signal_generation_config: jsonb default '{}'::jsonb
--   active: boolean default true
--   created_at: timestamp with time zone default now()
--   updated_at: timestamp with time zone default now()
--   primary key: id

-- TABLE public.signal_definitions
-- RLS enabled: true
--   id: uuid not null default gen_random_uuid()
--   rule_id: text not null
--   rule_name: text not null
--   domain: text
--   severity_default: text not null default 'medium'::text
--   description: text
--   enabled: boolean not null default true
--   created_at: timestamp with time zone not null default now()
--   updated_at: timestamp with time zone not null default now()
--   primary key: id

-- TABLE public.signal_events
-- RLS enabled: true
--   stream_id: text not null
--   offset: bigint not null
--   timestamp: timestamp with time zone not null
--   signal_type: text not null
--   spacetime: jsonb not null
--   provenance: jsonb not null
--   payload: jsonb not null default '{}'::jsonb
--   source_id: text not null
--   jurisdiction_id: text not null
--   module_hint: text not null
--   ingested_at: timestamp with time zone not null default now()
--   primary key: stream_id, offset

-- TABLE public.statutes
-- RLS enabled: true
--   id: uuid not null default uuid_generate_v4()
--   jurisdiction_id: uuid
--   external_id: character varying not null
--   title: text
--   citation: character varying
--   identifier: character varying
--   classification: character varying
--   subject: jsonb default '[]'::jsonb
--   text: text
--   summary: text
--   effective_date: date
--   status: character varying default 'active'::character varying
--   source_url: text
--   metadata: jsonb default '{}'::jsonb
--   created_at: timestamp with time zone default now()
--   updated_at: timestamp with time zone default now()
--   jurisdiction: text
--   primary key: id

-- TABLE public.streams
-- RLS enabled: true
--   stream_id: text not null
--   source_id: text not null
--   jurisdiction_id: text not null
--   module_hint: text not null
--   throughput_profile: text not null
--   safety_profile: text not null
--   governance_contract_id: text not null
--   status: text not null
--   created_at: timestamp with time zone not null default now()
--   updated_at: timestamp with time zone not null default now()
--   primary key: stream_id

-- FUNCTION public.get_connector_status(connector_name text) returns TABLE(name text, active boolean, priority integer, last_run timestamp with time zone, next_run timestamp with time zone, health text, records_last_7d bigint)
CREATE OR REPLACE FUNCTION public.get_connector_status(connector_name text DEFAULT NULL::text)
 RETURNS TABLE(name text, active boolean, priority integer, last_run timestamp with time zone, next_run timestamp with time zone, health text, records_last_7d bigint)
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY
    SELECT
        c.name::TEXT,
        c.active,
        c.priority,
        c.last_run_at,
        c.next_run_at,
        CASE
            WHEN NOT c.active THEN 'disabled'
            WHEN c.last_run_at IS NULL THEN 'never_run'
            WHEN c.last_run_at < NOW() - INTERVAL '7 days' THEN 'stale'
            ELSE 'healthy'
        END::TEXT,
        COALESCE(
            (SELECT SUM(j.records_inserted) 
             FROM ingest_jobs j 
             WHERE j.connector_id = c.id 
               AND j.started_at > NOW() - INTERVAL '7 days'),
            0::BIGINT
        )
    FROM connector_registry c
    WHERE connector_name IS NULL OR c.name = connector_name
    ORDER BY c.priority, c.name;
END;
$function$;

-- FUNCTION public.search_atlas_pins(search_query text) returns TABLE(id text, name text, address text, city text, pin_type text, latitude numeric, longitude numeric)
CREATE OR REPLACE FUNCTION public.search_atlas_pins(search_query text)
 RETURNS TABLE(id text, name text, address text, city text, pin_type text, latitude numeric, longitude numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
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

-- FUNCTION public.set_updated_at() returns trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

-- FUNCTION public.trigger_connector_run(connector_name text) returns jsonb
CREATE OR REPLACE FUNCTION public.trigger_connector_run(connector_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
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

-- FUNCTION public.upsert_atlas_entity_registry(_entities jsonb) returns integer
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

-- FUNCTION public.upsert_openstates_civic_map_signals_v1(_signals jsonb) returns TABLE(out_signal_id bigint, out_signal_type character varying, out_statute_id uuid, out_rule_id text, out_action text)
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

-- FUNCTION public.verify_atlas_tables() returns TABLE(table_name text, row_count bigint)
CREATE OR REPLACE FUNCTION public.verify_atlas_tables()
 RETURNS TABLE(table_name text, row_count bigint)
 LANGUAGE plpgsql
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

-- TRIGGER set_cursors_updated_at on public.cursors: BEFORE UPDATE EXECUTE FUNCTION set_updated_at()
-- TRIGGER set_streams_updated_at on public.streams: BEFORE UPDATE EXECUTE FUNCTION set_updated_at()

-- POLICY anon_read_agency_metrics on public.agency_metrics: command=SELECT, roles=["anon"], qual=true, with_check=null
-- POLICY service_role_write_agency_metrics on public.agency_metrics: command=ALL, roles=["service_role"], qual=true, with_check=true
-- POLICY Public read case_law on public.case_law: command=SELECT, roles=["public"], qual=true, with_check=null
-- POLICY anon_read_civic_map_resources on public.civic_map_resources: command=SELECT, roles=["anon"], qual=true, with_check=null
-- POLICY service_role_write_civic_map_resources on public.civic_map_resources: command=ALL, roles=["service_role"], qual=true, with_check=true
-- POLICY Public read connectors on public.connector_registry: command=SELECT, roles=["public"], qual=true, with_check=null
-- POLICY Auth read jobs on public.ingest_jobs: command=SELECT, roles=["public"], qual=(auth.role() = 'authenticated'::text), with_check=null
-- POLICY anon_read_jurisdictions on public.jurisdictions: command=SELECT, roles=["anon"], qual=true, with_check=null
-- POLICY service_role_write_jurisdictions on public.jurisdictions: command=ALL, roles=["service_role"], qual=true, with_check=true
-- POLICY authenticated_read_prime_patterns on public.prime_patterns: command=SELECT, roles=["authenticated"], qual=true, with_check=null
-- POLICY Auth read raw on public.raw_records: command=SELECT, roles=["public"], qual=(auth.role() = 'authenticated'::text), with_check=null
-- POLICY Public read schemas on public.schema_registry: command=SELECT, roles=["public"], qual=true, with_check=null
-- POLICY anon_read_signal_definitions on public.signal_definitions: command=SELECT, roles=["anon"], qual=true, with_check=null
-- POLICY service_role_write_signal_definitions on public.signal_definitions: command=ALL, roles=["service_role"], qual=true, with_check=true
-- POLICY authenticated_read_signal_events on public.signal_events: command=SELECT, roles=["authenticated"], qual=true, with_check=null
-- POLICY Public read statutes on public.statutes: command=SELECT, roles=["public"], qual=true, with_check=null
-- POLICY authenticated_read_streams on public.streams: command=SELECT, roles=["authenticated"], qual=true, with_check=null

CREATE UNIQUE INDEX agency_metrics_pkey ON public.agency_metrics USING btree (id);
CREATE INDEX idx_agency_metrics_agency_type ON public.agency_metrics USING btree (agency_type);
CREATE INDEX idx_agency_metrics_entity_id ON public.agency_metrics USING btree (entity_id);
CREATE INDEX idx_agency_metrics_jurisdiction ON public.agency_metrics USING btree (jurisdiction);
CREATE INDEX idx_agency_metrics_metric_type ON public.agency_metrics USING btree (metric_type);
CREATE UNIQUE INDEX case_law_jurisdiction_id_external_id_key ON public.case_law USING btree (jurisdiction_id, external_id);
CREATE UNIQUE INDEX case_law_pkey ON public.case_law USING btree (id);
CREATE INDEX idx_case_law_court ON public.case_law USING btree (court);
CREATE INDEX idx_case_law_date ON public.case_law USING btree (decision_date DESC);
CREATE INDEX idx_case_law_jur ON public.case_law USING btree (jurisdiction_id);
CREATE UNIQUE INDEX civic_map_resources_pkey ON public.civic_map_resources USING btree (id);
CREATE INDEX idx_civic_map_resources_city ON public.civic_map_resources USING btree (city);
CREATE INDEX idx_civic_map_resources_source ON public.civic_map_resources USING btree (source_table, source_id);
CREATE INDEX idx_civic_map_resources_state ON public.civic_map_resources USING btree (state);
CREATE INDEX idx_civic_map_resources_type ON public.civic_map_resources USING btree (resource_type);
CREATE UNIQUE INDEX connector_registry_name_key ON public.connector_registry USING btree (name);
CREATE UNIQUE INDEX connector_registry_pkey ON public.connector_registry USING btree (id);
CREATE UNIQUE INDEX cursors_pkey ON public.cursors USING btree (cursor_id);
CREATE UNIQUE INDEX cursors_stream_id_name_key ON public.cursors USING btree (stream_id, name);
CREATE INDEX idx_cursors_stream ON public.cursors USING btree (stream_id);
CREATE INDEX idx_jobs_connector ON public.ingest_jobs USING btree (connector_id, started_at DESC);
CREATE INDEX idx_jobs_status ON public.ingest_jobs USING btree (status);
CREATE UNIQUE INDEX ingest_jobs_pkey ON public.ingest_jobs USING btree (id);
CREATE INDEX idx_investigative_jobs_stream_created ON public.investigative_jobs USING btree (stream_id, created_at DESC);
CREATE UNIQUE INDEX investigative_jobs_pkey ON public.investigative_jobs USING btree (job_id);
CREATE INDEX idx_jurisdictions_geo_type ON public.jurisdictions USING btree (geo_type);
CREATE INDEX idx_jurisdictions_state_fips ON public.jurisdictions USING btree (state_fips);
CREATE UNIQUE INDEX jurisdictions_geo_id_key ON public.jurisdictions USING btree (geo_id);
CREATE UNIQUE INDEX jurisdictions_pkey ON public.jurisdictions USING btree (id);
CREATE INDEX idx_prime_patterns_filters ON public.prime_patterns USING btree (module, jurisdiction, detected_at DESC);
CREATE INDEX idx_prime_patterns_stream ON public.prime_patterns USING btree (stream_id, detected_at DESC);
CREATE UNIQUE INDEX prime_patterns_pkey ON public.prime_patterns USING btree (pattern_id);
CREATE INDEX idx_raw_connector_status ON public.raw_records USING btree (connector_id, process_status);
CREATE INDEX idx_raw_hash ON public.raw_records USING btree (sha256_hash);
CREATE UNIQUE INDEX raw_records_connector_id_sha256_hash_key ON public.raw_records USING btree (connector_id, sha256_hash);
CREATE UNIQUE INDEX raw_records_pkey ON public.raw_records USING btree (id);
CREATE UNIQUE INDEX schema_registry_name_version_key ON public.schema_registry USING btree (name, version);
CREATE UNIQUE INDEX schema_registry_pkey ON public.schema_registry USING btree (id);
CREATE INDEX idx_signal_definitions_domain ON public.signal_definitions USING btree (domain);
CREATE INDEX idx_signal_definitions_severity ON public.signal_definitions USING btree (severity_default);
CREATE UNIQUE INDEX signal_definitions_pkey ON public.signal_definitions USING btree (id);
CREATE UNIQUE INDEX signal_definitions_rule_id_key ON public.signal_definitions USING btree (rule_id);
CREATE INDEX idx_signal_events_source ON public.signal_events USING btree (source_id, jurisdiction_id, module_hint);
CREATE INDEX idx_signal_events_stream_offset ON public.signal_events USING btree (stream_id, "offset");
CREATE INDEX idx_signal_events_stream_timestamp ON public.signal_events USING btree (stream_id, "timestamp");
CREATE UNIQUE INDEX signal_events_pkey ON public.signal_events USING btree (stream_id, "offset");
CREATE INDEX idx_statutes_jur ON public.statutes USING btree (jurisdiction_id);
CREATE INDEX idx_statutes_status ON public.statutes USING btree (status, effective_date);
CREATE INDEX idx_statutes_subject ON public.statutes USING gin (subject);
CREATE UNIQUE INDEX statutes_external_id_jurisdiction_unique ON public.statutes USING btree (external_id, jurisdiction) WHERE ((external_id IS NOT NULL) AND (jurisdiction IS NOT NULL));
CREATE UNIQUE INDEX statutes_jurisdiction_id_external_id_key ON public.statutes USING btree (jurisdiction_id, external_id);
CREATE UNIQUE INDEX statutes_pkey ON public.statutes USING btree (id);
CREATE UNIQUE INDEX streams_pkey ON public.streams USING btree (stream_id);
