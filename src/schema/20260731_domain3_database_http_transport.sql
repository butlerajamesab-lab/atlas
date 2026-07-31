-- Governed Atlas -> Lighthouse Domain 3 transport.
--
-- The Atlas scheduler remains the execution owner. Cross-project receipt
-- delivery uses Atlas's existing encrypted bridge configuration and synchronous
-- PostgreSQL HTTP extension so target identity and response content are audited
-- in one database-owned operation.

create or replace function public.bridge_live_data_signal_candidates_v1(
  p_run_id uuid,
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'atlas', 'extensions', 'pg_temp'
as $function$
declare
  v_config record;
  v_candidate record;
  v_response http_response;
  v_body jsonb;
  v_nested jsonb;
  v_lighthouse_record_id uuid;
  v_record jsonb;
  v_bridged integer := 0;
  v_idempotent integer := 0;
  v_failed integer := 0;
  v_seen integer := 0;
  v_error text;
  v_receipts jsonb := '[]'::jsonb;
begin
  if p_run_id is null then
    raise exception 'p_run_id is required';
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
    v_lighthouse_record_id := null;
    v_body := null;
    v_nested := null;

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
      select *
        into v_response
        from http((
          'POST',
          rtrim(v_config.target_url, '/') ||
            '/rest/v1/rpc/register_live_data_signal_receipt_v1',
          array[
            http_header('Authorization', 'Bearer ' || v_config.target_service_key),
            http_header('apikey', v_config.target_service_key),
            http_header('Content-Type', 'application/json'),
            http_header('Accept', 'application/json')
          ],
          'application/json',
          jsonb_build_object('p_record', v_record)::text
        )::http_request);

      if v_response.status < 200 or v_response.status >= 300 then
        raise exception 'Lighthouse registration HTTP %: %',
          v_response.status,
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
        'lighthouse_record_id', v_lighthouse_record_id,
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
    'transport', 'atlas_database_http_receipt_v1',
    'target_project', 'lighthouse',
    'completed_at', clock_timestamp(),
    'receipts', v_receipts
  );
end
$function$;

revoke all on function public.bridge_live_data_signal_candidates_v1(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.bridge_live_data_signal_candidates_v1(uuid, integer)
  to service_role;

comment on function public.bridge_live_data_signal_candidates_v1(uuid, integer) is
  'Atlas-owned synchronous Domain 3 transport using encrypted bridge config and explicit Lighthouse JSON receipts.';