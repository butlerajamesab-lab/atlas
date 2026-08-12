-- Follow-up hardening for Domain 3 semantic currentness review findings.
--
-- 1. cross_category_entity groups span streams by design, so primary_stream_id is
--    not part of that rule's stable semantic identity.
-- 2. reactivating an older exact content version uses the replay transition time
--    and preserves the existing historical supersession chain instead of
--    reversing it into an A<->B cycle.

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
$$;

-- Re-key the already-preserved cross-category history before restoring the
-- singleton-current invariant. Historical candidate rows remain intact.
drop index if exists atlas.live_data_signal_candidate_one_current_semantic_idx;

update atlas.live_data_signal_candidate
   set semantic_key = atlas.live_data_signal_candidate_semantic_key_v1(
     rule_id,
     signal_type,
     primary_stream_id,
     jurisdiction_id,
     title
   )
 where rule_id = 'atlas.domain3.cross_category_entity';

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
  where rule_id = 'atlas.domain3.cross_category_entity'
)
update atlas.live_data_signal_candidate candidate
   set is_current = (ranked.current_rank = 1),
       supersedes_candidate_id = ranked.prior_candidate_id,
       retired_at = case
         when ranked.current_rank = 1 then null
         else coalesce(ranked.next_version_at, candidate.last_replayed_at, candidate.detected_at)
       end
  from ranked
 where ranked.candidate_id = candidate.candidate_id;

create unique index live_data_signal_candidate_one_current_semantic_idx
  on atlas.live_data_signal_candidate (semantic_key)
  where is_current;

create or replace function atlas.enforce_live_data_signal_candidate_currentness_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, atlas, extensions, pg_temp
as $$
declare
  v_prior_current_id uuid;
  v_transition_at timestamptz;
  v_reactivation boolean := false;
begin
  new.semantic_key := atlas.live_data_signal_candidate_semantic_key_v1(
    new.rule_id,
    new.signal_type,
    new.primary_stream_id,
    new.jurisdiction_id,
    new.title
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
      -- The existing row's last_replayed_at records recurrence. Preserve the
      -- historical predecessor edge so recurrence cannot reverse the chain.
      new.supersedes_candidate_id := old.supersedes_candidate_id;
    else
      new.supersedes_candidate_id := v_prior_current_id;
    end if;
  end if;

  new.is_current := true;
  new.retired_at := null;
  return new;
end;
$$;
