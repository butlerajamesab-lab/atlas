create table if not exists atlas.live_data_signal_candidate_retirement_v1 (
  retirement_id uuid primary key default gen_random_uuid(),
  run_id uuid not null references atlas.live_data_signal_run(run_id),
  candidate_id uuid not null references atlas.live_data_signal_candidate(candidate_id),
  rule_id text not null,
  rule_version text not null,
  candidate_hash text not null check (candidate_hash ~ '^[0-9a-f]{64}$'),
  semantic_key text not null check (semantic_key ~ '^[0-9a-f]{64}$'),
  lighthouse_record_id uuid,
  retirement_reason text not null,
  retirement_hash text not null unique check (retirement_hash ~ '^[0-9a-f]{64}$'),
  retired_at timestamptz not null,
  lighthouse_status text not null check (lighthouse_status in ('pending','not_required','bridged','failed')),
  lighthouse_last_error text,
  lighthouse_bridged_at timestamptz,
  created_at timestamptz not null default now(),
  unique (run_id, candidate_id)
);

create index if not exists live_data_signal_candidate_retirement_run_idx
  on atlas.live_data_signal_candidate_retirement_v1(run_id, lighthouse_status, created_at);

create or replace function public.reconcile_domain3_population_currentness_v1(
  p_rule_id text,
  p_rule_version text,
  p_run_id uuid,
  p_current_candidate_hashes jsonb,
  p_replay_complete boolean
)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'atlas', 'extensions', 'pg_temp'
as $function$
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
      'status','skipped','reason','replay_not_complete_or_truncated',
      'run_id',p_run_id,'rule_id',p_rule_id,'retired',0,'retirements','[]'::jsonb
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
      'status','skipped','reason','run_superseded_by_newer_completed_replay',
      'run_id',p_run_id,'newer_run_id',v_newer_run_id,'rule_id',p_rule_id,
      'retired',0,'retirements','[]'::jsonb
    );
  end if;

  for v_hash in select value from jsonb_array_elements_text(p_current_candidate_hashes)
  loop
    if v_hash !~ '^[0-9a-f]{64}$' then raise exception 'domain3_current_candidate_hash_invalid'; end if;
    perform 1 from atlas.live_data_signal_candidate
    where candidate_hash=v_hash and rule_id=p_rule_id and rule_version=p_rule_version and last_run_id=p_run_id;
    if not found then raise exception 'domain3_current_candidate_hash_not_bound_to_run'; end if;
  end loop;

  perform pg_advisory_xact_lock(hashtextextended(p_rule_id || chr(31) || p_rule_version,0));

  for v_candidate in
    select c.*
    from atlas.live_data_signal_candidate c
    where c.rule_id=p_rule_id
      and c.rule_version=p_rule_version
      and c.is_current is true
      and not exists (
        select 1 from jsonb_array_elements_text(p_current_candidate_hashes) h
        where h.value=c.candidate_hash
      )
    order by c.semantic_key,c.candidate_id
    for update
  loop
    update atlas.live_data_signal_candidate
       set is_current=false, retired_at=v_retired_at
     where candidate_id=v_candidate.candidate_id and is_current=true;

    v_retirement_hash := encode(
      extensions.digest(
        convert_to(concat_ws(chr(31),
          'atlas_domain3_negative_currentness_v1',p_run_id::text,
          v_candidate.candidate_id::text,v_candidate.candidate_hash,
          v_candidate.semantic_key,'not_observed_in_complete_replay'
        ),'UTF8'),'sha256'),'hex'
    );

    insert into atlas.live_data_signal_candidate_retirement_v1(
      run_id,candidate_id,rule_id,rule_version,candidate_hash,semantic_key,
      lighthouse_record_id,retirement_reason,retirement_hash,retired_at,lighthouse_status
    ) values (
      p_run_id,v_candidate.candidate_id,p_rule_id,p_rule_version,
      v_candidate.candidate_hash,v_candidate.semantic_key,v_candidate.lighthouse_record_id,
      'not_observed_in_complete_replay',v_retirement_hash,v_retired_at,
      case when v_candidate.lighthouse_record_id is null then 'not_required' else 'pending' end
    ) on conflict (run_id,candidate_id) do nothing;

    v_count := v_count+1;
    v_receipts := v_receipts || jsonb_build_array(jsonb_build_object(
      'candidate_id',v_candidate.candidate_id,'candidate_hash',v_candidate.candidate_hash,
      'semantic_key',v_candidate.semantic_key,'lighthouse_record_id',v_candidate.lighthouse_record_id,
      'retirement_hash',v_retirement_hash,'retired_at',v_retired_at,
      'lighthouse_status',case when v_candidate.lighthouse_record_id is null then 'not_required' else 'pending' end
    ));
  end loop;

  return jsonb_build_object(
    'status','completed','run_id',p_run_id,'rule_id',p_rule_id,'rule_version',p_rule_version,
    'replay_complete',true,'retired',v_count,'retirements',v_receipts
  );
end
$function$;

revoke execute on function public.reconcile_domain3_population_currentness_v1(text,text,uuid,jsonb,boolean)
from public, anon, authenticated;
grant execute on function public.reconcile_domain3_population_currentness_v1(text,text,uuid,jsonb,boolean) to service_role;

create or replace function public.bridge_live_data_signal_retirements_v1(p_run_id uuid,p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'atlas', 'extensions', 'pg_temp'
as $function$
declare
  v_config record;
  v_retirement record;
  v_response extensions.http_response;
  v_body jsonb;
  v_seen integer:=0;
  v_bridged integer:=0;
  v_idempotent integer:=0;
  v_failed integer:=0;
  v_error text;
  v_receipts jsonb:='[]'::jsonb;
begin
  if p_run_id is null then raise exception 'p_run_id is required'; end if;
  select config.target_url,config.enabled,config.config_json->>'domain3_receipt_token' as domain3_receipt_token
    into v_config from atlas.bridge_config config where config.bridge_id='atlas-to-lighthouse' limit 1;
  if not found or not coalesce(v_config.enabled,false) then raise exception 'Atlas-to-Lighthouse bridge configuration is unavailable or disabled'; end if;
  if coalesce(v_config.target_url,'')='' then raise exception 'Atlas-to-Lighthouse target URL is missing'; end if;
  if coalesce(length(v_config.domain3_receipt_token),0)<32 then raise exception 'Atlas-to-Lighthouse scoped Domain 3 receipt token is missing'; end if;

  for v_retirement in
    select r.* from atlas.live_data_signal_candidate_retirement_v1 r
    where r.run_id=p_run_id and r.lighthouse_status in ('pending','failed')
    order by r.retirement_id
    limit least(greatest(coalesce(p_limit,100),1),1000)
  loop
    v_seen:=v_seen+1;
    begin
      select * into v_response from extensions.http((
        'POST',rtrim(v_config.target_url,'/')||'/api/atlas-domain3/retirement',
        array[extensions.http_header('x-atlas-domain3-token',v_config.domain3_receipt_token),extensions.http_header('Accept','application/json')],
        'application/json',jsonb_build_object(
          'semantic_key',v_retirement.semantic_key,'atlas_candidate_id',v_retirement.candidate_id,
          'atlas_candidate_hash',v_retirement.candidate_hash,'atlas_run_id',v_retirement.run_id,
          'lighthouse_record_id',v_retirement.lighthouse_record_id,'retirement_reason',v_retirement.retirement_reason,
          'retirement_hash',v_retirement.retirement_hash,'retired_at',v_retirement.retired_at
        )::text
      )::extensions.http_request);
      if v_response.status<200 or v_response.status>=300 then raise exception 'Lighthouse retirement HTTP %: %',v_response.status,left(coalesce(v_response.content,''),1000); end if;
      if coalesce(v_response.content,'')='' then raise exception 'Lighthouse retirement returned an empty response body'; end if;
      v_body:=v_response.content::jsonb;
      if jsonb_typeof(v_body)<>'object' or coalesce((v_body->>'ok')::boolean,false) is not true then raise exception 'Lighthouse retirement returned a malformed receipt: %',left(v_response.content,1000); end if;
      v_bridged:=v_bridged+1;
      update atlas.live_data_signal_candidate_retirement_v1
         set lighthouse_status='bridged',lighthouse_last_error=null,lighthouse_bridged_at=clock_timestamp()
       where retirement_id=v_retirement.retirement_id;
      v_receipts:=v_receipts||jsonb_build_array(jsonb_build_object(
        'retirement_id',v_retirement.retirement_id,'candidate_id',v_retirement.candidate_id,
        'semantic_key',v_retirement.semantic_key,'status',coalesce(v_body->>'status','retired'),
        'http_status',v_response.status,'lighthouse_retirement_receipt_id',v_body->>'retirement_receipt_id'
      ));
    exception when others then
      get stacked diagnostics v_error=message_text;
      v_failed:=v_failed+1;
      update atlas.live_data_signal_candidate_retirement_v1
         set lighthouse_status='failed',lighthouse_last_error=left(v_error,2000)
       where retirement_id=v_retirement.retirement_id;
      v_receipts:=v_receipts||jsonb_build_array(jsonb_build_object(
        'retirement_id',v_retirement.retirement_id,'candidate_id',v_retirement.candidate_id,
        'semantic_key',v_retirement.semantic_key,'status','failed','error',left(v_error,1000)
      ));
    end;
  end loop;

  return jsonb_build_object(
    'run_id',p_run_id,'retirements_seen',v_seen,'bridged',v_bridged,
    'idempotent',v_idempotent,'failed',v_failed,
    'transport','atlas_lighthouse_signal_retirement_v1','completed_at',clock_timestamp(),'receipts',v_receipts
  );
end
$function$;

revoke execute on function public.bridge_live_data_signal_retirements_v1(uuid,integer)
from public, anon, authenticated;
grant execute on function public.bridge_live_data_signal_retirements_v1(uuid,integer) to service_role;

comment on function public.reconcile_domain3_population_currentness_v1(text,text,uuid,jsonb,boolean) is
  'Retires candidates absent from the latest complete non-truncated governed replay for one rule. Incomplete/truncated or superseded runs cannot retire current candidates.';
comment on function public.bridge_live_data_signal_retirements_v1(uuid,integer) is
  'Projects governed Atlas negative-currentness retirement receipts to Lighthouse without deleting historical signal evidence.';
