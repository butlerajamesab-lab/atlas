-- Public RPC wrapper for deterministic Atlas-to-Lighthouse bridge writes.
-- The Atlas schema itself is intentionally not exposed through PostgREST, so API services
-- must call this SECURITY DEFINER function instead of using supabase.schema('atlas').

CREATE OR REPLACE FUNCTION public.trigger_lighthouse_bridge_for_prime_pattern_v1(
  p_signal jsonb,
  p_audit_context jsonb DEFAULT '{}'::jsonb,
  p_process_queue boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO atlas, public, pg_temp
AS $function$
DECLARE
  inserted_signal_id bigint;
  queued_item jsonb := NULL;
  audit_log_id uuid;
  bridge_id text := COALESCE(p_audit_context->>'bridge_id', 'atlas-to-lighthouse');
  source_table text := COALESCE(p_signal->>'source_table', 'prime_patterns');
  source_record_id text := p_signal->>'source_record_id';
  target_table text := COALESCE(p_audit_context->>'target_table', 'lighthouse_bridge_queue');
  dedup_key text := p_signal->>'signal_dedup_key';
  queue_process_result jsonb := NULL;
  existing_log jsonb := NULL;
  started_at timestamptz := clock_timestamp();
BEGIN
  IF p_signal IS NULL OR jsonb_typeof(p_signal) <> 'object' THEN
    RAISE EXCEPTION 'p_signal must be a JSON object';
  END IF;

  IF COALESCE(source_record_id, '') = '' THEN
    RAISE EXCEPTION 'p_signal.source_record_id is required';
  END IF;

  IF COALESCE(p_signal->>'generation_method', '') <> 'deterministic_rule' THEN
    RAISE EXCEPTION 'Bridge signal generation_method must be deterministic_rule';
  END IF;

  SELECT to_jsonb(t)
  INTO existing_log
  FROM (
    SELECT log_id, synced_at
    FROM atlas.bridge_sync_log
    WHERE bridge_sync_log.bridge_id = trigger_lighthouse_bridge_for_prime_pattern_v1.bridge_id
      AND bridge_sync_log.source_table = trigger_lighthouse_bridge_for_prime_pattern_v1.source_table
      AND bridge_sync_log.source_record_id = trigger_lighthouse_bridge_for_prime_pattern_v1.source_record_id
      AND bridge_sync_log.status = 'sent'
    ORDER BY synced_at DESC NULLS LAST
    LIMIT 1
  ) t;

  IF existing_log IS NOT NULL THEN
    RETURN jsonb_build_object(
      'bridged', false,
      'skipped', true,
      'reason', 'already_bridged',
      'pattern_id', source_record_id,
      'log_id', existing_log->>'log_id',
      'synced_at', existing_log->>'synced_at'
    );
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
    signal_dedup_key,
    record_origin,
    verification_status,
    exclude_from_production,
    quarantine_reason
  ) VALUES (
    p_signal->>'signal_type',
    NULLIF(p_signal->>'geography_key', ''),
    COALESCE(NULLIF(p_signal->>'severity_score', '')::numeric, NULLIF(p_signal->>'confidence_score', '')::numeric, 0.0),
    COALESCE(p_signal->'metadata_json', '{}'::jsonb),
    source_table,
    source_record_id,
    COALESCE(NULLIF(p_signal->>'detected_at', '')::timestamptz, now()),
    NULLIF(p_signal->>'source_connector_id', '')::uuid,
    NULLIF(p_signal->>'raw_record_id', '')::uuid,
    NULLIF(p_signal->>'statute_id', '')::uuid,
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_signal->'entity_ids', '[]'::jsonb))), ARRAY[]::text[]),
    NULLIF(p_signal->>'jurisdiction_raw_value', ''),
    NULLIF(p_signal->>'jurisdiction_id', '')::uuid,
    NULLIF(p_signal->>'source_url', ''),
    COALESCE(NULLIF(p_signal->>'confidence_score', '')::numeric, 1.0),
    COALESCE(NULLIF(p_signal->>'severity', ''), 'informational'),
    COALESCE(NULLIF(p_signal->>'signal_status', ''), 'active'),
    COALESCE(p_signal->'evidence_payload', '{}'::jsonb),
    p_signal->>'generation_method',
    p_signal->>'rule_id',
    COALESCE(NULLIF(p_signal->>'rule_version', ''), 'v1'),
    COALESCE(p_signal->'provenance_metadata', '{}'::jsonb),
    dedup_key,
    COALESCE(NULLIF(p_signal->>'record_origin', ''), 'streaming_investigation'),
    COALESCE(NULLIF(p_signal->>'verification_status', ''), 'verified'),
    COALESCE(NULLIF(p_signal->>'exclude_from_production', '')::boolean, false),
    NULLIF(p_signal->>'quarantine_reason', '')
  )
  ON CONFLICT (signal_dedup_key)
    WHERE signal_dedup_key IS NOT NULL
  DO UPDATE SET
    metadata_json = EXCLUDED.metadata_json,
    evidence_payload = EXCLUDED.evidence_payload,
    provenance_metadata = EXCLUDED.provenance_metadata,
    confidence_score = EXCLUDED.confidence_score,
    severity_score = EXCLUDED.severity_score,
    severity = EXCLUDED.severity,
    signal_status = EXCLUDED.signal_status,
    source_url = EXCLUDED.source_url,
    jurisdiction_raw_value = EXCLUDED.jurisdiction_raw_value,
    detected_at = EXCLUDED.detected_at
  RETURNING signal_id INTO inserted_signal_id;

  SELECT to_jsonb(q)
  INTO queued_item
  FROM (
    SELECT queue_id, status, created_at
    FROM atlas.lighthouse_bridge_queue
    WHERE atlas_signal_id = inserted_signal_id
    ORDER BY created_at DESC NULLS LAST
    LIMIT 1
  ) q;

  IF p_process_queue AND to_regprocedure('atlas.bridge_process_queue_v3(integer)') IS NOT NULL THEN
    EXECUTE 'SELECT to_jsonb(t) FROM atlas.bridge_process_queue_v3($1) t' USING 1 INTO queue_process_result;
  ELSIF p_process_queue AND to_regprocedure('public.bridge_process_queue_v3(integer)') IS NOT NULL THEN
    EXECUTE 'SELECT to_jsonb(t) FROM public.bridge_process_queue_v3($1) t' USING 1 INTO queue_process_result;
  END IF;

  INSERT INTO atlas.bridge_sync_log (
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
  ) VALUES (
    bridge_id,
    'prime_pattern_bridge',
    source_table,
    source_record_id,
    target_table,
    queued_item->>'queue_id',
    'sent',
    jsonb_build_object(
      'audit_context', p_audit_context,
      'civic_map_signal_id', inserted_signal_id,
      'lighthouse_bridge_queue_id', queued_item->>'queue_id',
      'signal_dedup_key', dedup_key
    ),
    jsonb_build_object(
      'queue_lookup', queued_item,
      'queue_process_result', queue_process_result
    ),
    NULL,
    GREATEST(0, (extract(epoch FROM (clock_timestamp() - started_at)) * 1000)::integer)
  )
  RETURNING log_id INTO audit_log_id;

  RETURN jsonb_build_object(
    'bridged', true,
    'pattern_id', source_record_id,
    'signal_id', inserted_signal_id,
    'queue_id', queued_item->>'queue_id',
    'log_id', audit_log_id,
    'confidence_score', COALESCE(NULLIF(p_signal->>'confidence_score', '')::numeric, 1.0),
    'queue_process_result', queue_process_result
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.trigger_lighthouse_bridge_for_prime_pattern_v1(jsonb, jsonb, boolean) TO service_role;
