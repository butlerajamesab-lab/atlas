-- Receipted projection of Atlas's authoritative stream/runtime state into the
-- Lighthouse frontend-facing database. The bridge uses the existing scoped
-- Atlas→Lighthouse credential stored in atlas.bridge_config; the credential is
-- never exposed to the Node runtime or frontend.

create or replace function public.bridge_atlas_stream_runtime_snapshot_v1(
  p_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, atlas, extensions, pg_temp
as $$
declare
  v_config record;
  v_response extensions.http_response;
  v_body jsonb;
begin
  if jsonb_typeof(p_snapshot) <> 'object'
     or jsonb_typeof(p_snapshot->'streams') <> 'array'
     or coalesce(p_snapshot->>'snapshot_hash','') !~ '^[0-9a-f]{64}$' then
    raise exception 'atlas_stream_runtime_snapshot_invalid';
  end if;

  select
    config.target_url,
    config.enabled,
    config.config_json->>'domain3_receipt_token' as bridge_token
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
  if coalesce(length(v_config.bridge_token),0) < 32 then
    raise exception 'Atlas-to-Lighthouse scoped receipt token is missing';
  end if;

  select * into v_response
    from extensions.http((
      'POST',
      rtrim(v_config.target_url,'/') || '/api/atlas-domain3/streams',
      array[
        extensions.http_header('x-atlas-domain3-token', v_config.bridge_token),
        extensions.http_header('Accept','application/json')
      ],
      'application/json',
      p_snapshot::text
    )::extensions.http_request);

  if v_response.status < 200 or v_response.status >= 300 then
    raise exception 'Lighthouse stream projection HTTP %: %',
      v_response.status,
      left(coalesce(v_response.content,''),1000);
  end if;
  if coalesce(v_response.content,'') = '' then
    raise exception 'Lighthouse stream projection returned empty response';
  end if;

  v_body := v_response.content::jsonb;
  if jsonb_typeof(v_body) <> 'object'
     or coalesce((v_body->>'ok')::boolean,false) is not true
     or coalesce(v_body->>'snapshot_hash','') <> p_snapshot->>'snapshot_hash' then
    raise exception 'Lighthouse stream projection receipt invalid: %', left(v_response.content,1000);
  end if;

  return jsonb_build_object(
    'status','completed',
    'streams_registered',coalesce((v_body->>'streams_registered')::integer,0),
    'snapshot_hash',v_body->>'snapshot_hash',
    'observed_at',v_body->>'observed_at',
    'registered_at',v_body->>'registered_at',
    'transport','atlas_lighthouse_stream_runtime_receipt_v1',
    'http_status',v_response.status
  );
end;
$$;

revoke all on function public.bridge_atlas_stream_runtime_snapshot_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.bridge_atlas_stream_runtime_snapshot_v1(jsonb)
  to service_role;
