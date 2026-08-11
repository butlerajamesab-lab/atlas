-- Enforce semantic currentness centrally so every candidate writer obeys the
-- same replay/versioning contract without duplicating ownership logic in Node.

create or replace function atlas.enforce_live_data_signal_candidate_currentness_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, atlas, extensions, pg_temp
as $$
declare
  v_prior_current_id uuid;
begin
  new.semantic_key := atlas.live_data_signal_candidate_semantic_key_v1(
    new.rule_id,
    new.signal_type,
    new.primary_stream_id,
    new.jurisdiction_id,
    new.title
  );

  if tg_op = 'UPDATE' then
    -- Exact replay updates receipts/freshness/statistics, not the original
    -- detection time that identifies this content version downstream.
    new.first_detected_at := old.first_detected_at;
    if new.candidate_hash = old.candidate_hash then
      new.detected_at := old.detected_at;
    end if;

    -- Bridge status and other bookkeeping updates do not change candidate
    -- currentness. A new derivation run is the only replay/version trigger.
    if new.last_run_id is not distinct from old.last_run_id then
      return new;
    end if;
  else
    if new.first_detected_at is null then
      new.first_detected_at := coalesce(new.detected_at, clock_timestamp());
    end if;
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
           retired_at = coalesce(new.first_detected_at, new.detected_at, clock_timestamp())
     where candidate_id = v_prior_current_id;
    new.supersedes_candidate_id := v_prior_current_id;
  end if;

  new.is_current := true;
  new.retired_at := null;
  return new;
end;
$$;

drop trigger if exists trg_live_data_signal_candidate_currentness_v1
  on atlas.live_data_signal_candidate;
create trigger trg_live_data_signal_candidate_currentness_v1
before insert or update on atlas.live_data_signal_candidate
for each row
execute function atlas.enforce_live_data_signal_candidate_currentness_v1();
