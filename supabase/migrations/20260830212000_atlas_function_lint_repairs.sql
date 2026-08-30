-- Atlas forward function lint repairs.
-- These two captured production functions failed PostgreSQL 17 plpgsql_check.
-- The repairs preserve their signatures and intended behavior while making
-- extension resolution and conflict targets explicit.

set search_path = pg_catalog, public, extensions;

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
        text_hash = ENCODE(extensions.DIGEST(p_extracted_text, 'sha256'), 'hex'),
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
    ON CONFLICT ON CONSTRAINT connector_registry_pkey DO NOTHING;

    INSERT INTO atlas.schema_registry (schema_name, schema_def, created_at)
    VALUES (v_schema_name, v_draft.draft_schema_json, NOW())
    ON CONFLICT ON CONSTRAINT schema_registry_pkey DO UPDATE SET
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

reset search_path;
