-- Domain 3 population persistence boundary.
-- Internal atlas.* tables remain unexposed to PostgREST; service-role runtime
-- persists governed rules/runs/candidates only through these bounded RPCs.

create or replace function public.register_domain3_population_rules_v1(
  p_rules jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, atlas, pg_temp
as $$
declare
  v_rule jsonb;
  v_count integer := 0;
begin
  if jsonb_typeof(p_rules) <> 'array' then
    raise exception 'domain3_rules_must_be_array';
  end if;

  for v_rule in select value from jsonb_array_elements(p_rules)
  loop
    if coalesce(v_rule->>'rule_id','') = ''
       or coalesce(v_rule->>'rule_version','') = ''
       or coalesce(v_rule->>'signal_type','') = ''
       or coalesce(v_rule->>'engine_id','') = ''
       or coalesce(v_rule->>'engine_version','') = ''
       or coalesce(v_rule->>'rule_contract_hash','') !~ '^[0-9a-f]{64}$'
       or jsonb_typeof(v_rule->'rule_contract') <> 'object' then
      raise exception 'invalid_domain3_rule_contract';
    end if;

    insert into atlas.live_data_signal_rule (
      rule_id,
      rule_version,
      signal_type,
      engine_id,
      engine_version,
      rule_contract,
      rule_contract_hash,
      is_active
    ) values (
      v_rule->>'rule_id',
      v_rule->>'rule_version',
      v_rule->>'signal_type',
      v_rule->>'engine_id',
      v_rule->>'engine_version',
      v_rule->'rule_contract',
      v_rule->>'rule_contract_hash',
      coalesce((v_rule->>'is_active')::boolean, true)
    )
    on conflict (rule_id, rule_version) do update set
      signal_type = excluded.signal_type,
      engine_id = excluded.engine_id,
      engine_version = excluded.engine_version,
      rule_contract = excluded.rule_contract,
      rule_contract_hash = excluded.rule_contract_hash,
      is_active = excluded.is_active;

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object(
    'status','completed',
    'rules_registered',v_count
  );
end;
$$;

revoke all on function public.register_domain3_population_rules_v1(jsonb) from public, anon, authenticated;
grant execute on function public.register_domain3_population_rules_v1(jsonb) to service_role;

create or replace function public.persist_domain3_population_run_v1(
  p_rule jsonb,
  p_run_id uuid,
  p_observations_scanned bigint,
  p_candidates jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, atlas, pg_temp
as $$
declare
  v_candidate jsonb;
  v_produced integer := 0;
  v_replayed integer := 0;
  v_inserted integer := 0;
  v_entities integer := 0;
  v_rule_id text;
  v_rule_version text;
  v_rule_hash text;
begin
  if p_run_id is null then
    raise exception 'domain3_run_id_required';
  end if;
  if jsonb_typeof(p_rule) <> 'object' then
    raise exception 'domain3_rule_must_be_object';
  end if;
  if jsonb_typeof(p_candidates) <> 'array' then
    raise exception 'domain3_candidates_must_be_array';
  end if;

  v_rule_id := p_rule->>'rule_id';
  v_rule_version := p_rule->>'rule_version';
  v_rule_hash := p_rule->>'rule_contract_hash';

  if coalesce(v_rule_id,'') = ''
     or coalesce(v_rule_version,'') = ''
     or coalesce(v_rule_hash,'') !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_domain3_run_rule_identity';
  end if;

  -- Reassert the exact rule contract at the run boundary. This is idempotent and
  -- prevents a run from existing without its declared rule/version/hash.
  insert into atlas.live_data_signal_rule (
    rule_id, rule_version, signal_type, engine_id, engine_version,
    rule_contract, rule_contract_hash, is_active
  ) values (
    v_rule_id,
    v_rule_version,
    p_rule->>'signal_type',
    p_rule->>'engine_id',
    p_rule->>'engine_version',
    p_rule->'rule_contract',
    v_rule_hash,
    coalesce((p_rule->>'is_active')::boolean, true)
  )
  on conflict (rule_id, rule_version) do update set
    signal_type = excluded.signal_type,
    engine_id = excluded.engine_id,
    engine_version = excluded.engine_version,
    rule_contract = excluded.rule_contract,
    rule_contract_hash = excluded.rule_contract_hash,
    is_active = excluded.is_active;

  v_produced := jsonb_array_length(p_candidates);
  select count(*)::integer
    into v_replayed
  from jsonb_array_elements(p_candidates) c
  join atlas.live_data_signal_candidate existing
    on existing.candidate_hash = c->>'candidate_hash';
  v_inserted := v_produced - v_replayed;

  select count(*)::integer
    into v_entities
  from jsonb_array_elements(p_candidates) c
  where coalesce(c->'supporting_statistics'->>'entity_name','') <> '';

  insert into atlas.live_data_signal_run (
    run_id,
    rule_id,
    rule_version,
    rule_contract_hash,
    status,
    canonical_events_scanned,
    entities_evaluated,
    candidates_produced,
    started_at,
    completed_at
  ) values (
    p_run_id,
    v_rule_id,
    v_rule_version,
    v_rule_hash,
    'completed',
    greatest(coalesce(p_observations_scanned,0),0),
    v_entities,
    v_produced,
    now(),
    now()
  )
  on conflict (run_id) do nothing;

  for v_candidate in select value from jsonb_array_elements(p_candidates)
  loop
    if coalesce(v_candidate->>'candidate_hash','') !~ '^[0-9a-f]{64}$'
       or coalesce(v_candidate->>'source_input_hash','') !~ '^[0-9a-f]{64}$'
       or jsonb_typeof(v_candidate->'source_event_refs') <> 'array'
       or jsonb_array_length(v_candidate->'source_event_refs') = 0
       or jsonb_typeof(v_candidate->'supporting_statistics') <> 'object'
       or v_candidate->'supporting_statistics' = '{}'::jsonb then
      raise exception 'invalid_domain3_candidate_contract';
    end if;

    insert into atlas.live_data_signal_candidate (
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
      last_run_id
    ) values (
      v_candidate->>'candidate_hash',
      v_rule_id,
      v_rule_version,
      v_rule_hash,
      p_rule->>'engine_id',
      p_rule->>'engine_version',
      v_candidate->>'signal_type',
      v_candidate->>'title',
      v_candidate->>'description',
      v_candidate->>'primary_stream_id',
      v_candidate->'source_event_refs',
      array(select jsonb_array_elements_text(coalesce(v_candidate->'entity_ids','[]'::jsonb))),
      v_candidate->>'entity_resolution_status',
      v_candidate->>'jurisdiction_id',
      v_candidate->>'severity',
      (v_candidate->>'confidence_score')::numeric,
      v_candidate->>'verification_state',
      v_candidate->'supporting_statistics',
      coalesce(v_candidate->'evidence_refs','[]'::jsonb),
      (v_candidate->>'source_freshness_at')::timestamptz,
      (v_candidate->>'detected_at')::timestamptz,
      v_candidate->>'source_input_hash',
      p_run_id,
      p_run_id
    )
    on conflict (candidate_hash) do update set
      last_run_id = excluded.last_run_id,
      last_replayed_at = now(),
      source_event_refs = excluded.source_event_refs,
      supporting_statistics = excluded.supporting_statistics,
      evidence_refs = excluded.evidence_refs,
      source_freshness_at = excluded.source_freshness_at,
      detected_at = excluded.detected_at;
  end loop;

  return jsonb_build_object(
    'status','completed',
    'run_id',p_run_id,
    'rule_id',v_rule_id,
    'observations_scanned',greatest(coalesce(p_observations_scanned,0),0),
    'candidates_produced',v_produced,
    'candidates_inserted',v_inserted,
    'candidates_replayed',v_replayed
  );
end;
$$;

revoke all on function public.persist_domain3_population_run_v1(jsonb,uuid,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.persist_domain3_population_run_v1(jsonb,uuid,bigint,jsonb) to service_role;
