-- Production ledger parity: 20260815090032_domain3_entity_aware_candidate_semantic_identity

create or replace function atlas.live_data_signal_candidate_semantic_key_v2(
  p_rule_id text,
  p_signal_type text,
  p_primary_stream_id text,
  p_jurisdiction_id text,
  p_title text,
  p_entity_ids text[]
)
returns text
language sql
immutable
set search_path to 'pg_catalog', 'extensions', 'pg_temp'
as $function$
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

create or replace function atlas.enforce_live_data_signal_candidate_currentness_v1()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'atlas', 'extensions', 'pg_temp'
as $function$
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

-- Re-key historical ProPublica candidates without changing their current/noncurrent state.
-- The trigger recalculates semantic_key with v2 and returns early because last_run_id is unchanged.
update atlas.live_data_signal_candidate
set semantic_key = semantic_key
where rule_id = 'atlas.propublica_unresolved_filing_metadata_rate';

comment on function atlas.live_data_signal_candidate_semantic_key_v2(text,text,text,text,text,text[]) is
  'Entity-aware semantic currentness identity. ProPublica entity-specific data-quality signals include resolved entity IDs so independent entities cannot retire one another; all other v1 signal semantics remain unchanged.';
