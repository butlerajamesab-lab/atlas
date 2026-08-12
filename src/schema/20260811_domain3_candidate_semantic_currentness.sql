-- Domain 3 candidate semantic identity/currentness.
--
-- Candidate hashes are content/version identities. A changing observation
-- population can legitimately produce a new candidate_hash for the same
-- semantic pattern. This migration preserves every version while making the
-- current version explicit and bridgeable exactly once.

alter table atlas.live_data_signal_candidate
  add column if not exists semantic_key text,
  add column if not exists is_current boolean not null default true,
  add column if not exists supersedes_candidate_id uuid,
  add column if not exists retired_at timestamptz;

create or replace function atlas.live_data_signal_candidate_semantic_key_v1(
  p_rule_id text,
  p_signal_type text,
  p_primary_stream_id text,
  p_jurisdiction_id text,
  p_title text
)
returns text
language sql
immutable
set search_path = pg_catalog, extensions, pg_temp
as $$
  select encode(
    extensions.digest(
      convert_to(
        concat_ws(
          chr(31),
          coalesce(p_rule_id, ''),
          coalesce(p_signal_type, ''),
          coalesce(p_primary_stream_id, ''),
          coalesce(p_jurisdiction_id, ''),
          coalesce(p_title, '')
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
$$;

update atlas.live_data_signal_candidate
   set semantic_key = atlas.live_data_signal_candidate_semantic_key_v1(
     rule_id,
     signal_type,
     primary_stream_id,
     jurisdiction_id,
     title
   )
 where semantic_key is null;

with ranked as (
  select
    candidate_id,
    semantic_key,
    row_number() over (
      partition by semantic_key
      order by
        coalesce(last_replayed_at, detected_at, first_detected_at) desc,
        detected_at desc,
        candidate_id desc
    ) as current_rank,
    lag(candidate_id) over (
      partition by semantic_key
      order by
        coalesce(first_detected_at, detected_at) asc,
        detected_at asc,
        candidate_id asc
    ) as prior_candidate_id,
    lead(coalesce(first_detected_at, detected_at)) over (
      partition by semantic_key
      order by
        coalesce(first_detected_at, detected_at) asc,
        detected_at asc,
        candidate_id asc
    ) as next_version_at
  from atlas.live_data_signal_candidate
)
update atlas.live_data_signal_candidate candidate
   set is_current = (ranked.current_rank = 1),
       supersedes_candidate_id = case
         when ranked.prior_candidate_id = candidate.candidate_id then null
         else ranked.prior_candidate_id
       end,
       retired_at = case
         when ranked.current_rank = 1 then null
         else coalesce(ranked.next_version_at, candidate.last_replayed_at, candidate.detected_at)
       end
  from ranked
 where ranked.candidate_id = candidate.candidate_id;

alter table atlas.live_data_signal_candidate
  alter column semantic_key set not null;

alter table atlas.live_data_signal_candidate
  drop constraint if exists live_data_signal_candidate_semantic_key_check;
alter table atlas.live_data_signal_candidate
  add constraint live_data_signal_candidate_semantic_key_check
  check (semantic_key ~ '^[0-9a-f]{64}$');

alter table atlas.live_data_signal_candidate
  drop constraint if exists live_data_signal_candidate_supersedes_fkey;
alter table atlas.live_data_signal_candidate
  add constraint live_data_signal_candidate_supersedes_fkey
  foreign key (supersedes_candidate_id)
  references atlas.live_data_signal_candidate(candidate_id);

create unique index if not exists live_data_signal_candidate_one_current_semantic_idx
  on atlas.live_data_signal_candidate (semantic_key)
  where is_current;

create index if not exists live_data_signal_candidate_semantic_history_idx
  on atlas.live_data_signal_candidate (
    semantic_key,
    is_current,
    first_detected_at desc,
    candidate_id
  );

create or replace view atlas.v_live_data_signal_candidate_current_v1 as
select *
from atlas.live_data_signal_candidate
where is_current;

comment on column atlas.live_data_signal_candidate.semantic_key is
  'Stable semantic pattern identity. candidate_hash remains the immutable population/version identity.';
comment on column atlas.live_data_signal_candidate.is_current is
  'True only for the current candidate version within semantic_key; historical versions are retained.';
comment on column atlas.live_data_signal_candidate.supersedes_candidate_id is
  'Prior semantic version replaced by this candidate version when one exists.';

-- Bridge only the current version of a semantic pattern. Include Atlas
-- identities in the downstream record so Lighthouse can maintain the same
-- currentness chain without becoming the canonical owner.
create or replace function public.bridge_live_data_signal_candidates_v1(
  p_run_id uuid,
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, atlas, extensions, pg_temp
as $$
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

  if not found or not coalesce(v_config.enabled,false) then
    raise exception 'Atlas-to-Lighthouse bridge configuration is unavailable or disabled';
  end if;
  if coalesce(v_config.target_url,'') = '' then
    raise exception 'Atlas-to-Lighthouse target URL is missing';
  end if;
  if coalesce(length(v_config.domain3_receipt_token),0) < 32 then
    raise exception 'Atlas-to-Lighthouse scoped Domain 3 receipt token is missing';
  end if;

  for v_candidate in
    select candidate.*
      from atlas.live_data_signal_candidate candidate
     where candidate.last_run_id = p_run_id
       and candidate.is_current is true
     order by candidate.candidate_id
     limit least(greatest(coalesce(p_limit,100),1),1000)
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
      -- Exact replay of an unchanged candidate must not manufacture a new
      -- downstream signal version merely because the detector ran again.
      'detected_at', coalesce(v_candidate.first_detected_at, v_candidate.detected_at),
      'governance_status', 'observation_candidate'
    );

    begin
      select * into v_response
        from extensions.http((
          'POST',
          rtrim(v_config.target_url,'/') || '/api/atlas-domain3/receipt',
          array[
            extensions.http_header('x-atlas-domain3-token',v_config.domain3_receipt_token),
            extensions.http_header('Accept','application/json')
          ],
          'application/json',
          v_record::text
        )::extensions.http_request);

      if v_response.status < 200 or v_response.status >= 300 then
        raise exception 'Lighthouse registration HTTP %: %',
          v_response.status,
          left(coalesce(v_response.content,''),1000);
      end if;
      if coalesce(v_response.content,'') = '' then
        raise exception 'Lighthouse registration returned an empty response body';
      end if;

      v_body := v_response.content::jsonb;
      if jsonb_typeof(v_body) <> 'object'
         or coalesce((v_body->>'ok')::boolean,false) is not true then
        raise exception 'Lighthouse registration returned a malformed receipt: %',
          left(v_response.content,1000);
      end if;
      v_lighthouse_record_id := nullif(v_body->>'live_data_signal_id','')::uuid;
      if v_lighthouse_record_id is null then
        raise exception 'Lighthouse registration receipt contains no live_data_signal_id: %',
          left(v_response.content,1000);
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
             lighthouse_last_error = left(v_error,2000)
       where candidate_id = v_candidate.candidate_id;
      v_receipts := v_receipts || jsonb_build_array(jsonb_build_object(
        'candidate_id', v_candidate.candidate_id,
        'candidate_hash', v_candidate.candidate_hash,
        'semantic_key', v_candidate.semantic_key,
        'status','failed',
        'error',left(v_error,1000)
      ));
    end;
  end loop;

  return jsonb_build_object(
    'run_id',p_run_id,
    'candidates_seen',v_seen,
    'bridged',v_bridged,
    'idempotent',v_idempotent,
    'failed',v_failed,
    'transport','atlas_lighthouse_direct_postgres_receipt_v1',
    'state_projection','atlas_candidate_semantic_currentness_v1',
    'target_project','lighthouse',
    'completed_at',clock_timestamp(),
    'receipts',v_receipts
  );
end;
$$;
