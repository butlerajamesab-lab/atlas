begin;

-- Fixed-input convergence must not change when an already-known event is seen
-- again. Mutable ingestion telemetry remains in atlas.signal_event_identity, but
-- only immutable identity fields cross into the governed source snapshot.
create or replace function public.atlas_convergence_source_population_page_v1(
  p_from_timestamp timestamptz,
  p_to_timestamp timestamptz,
  p_after_stream_id text default null,
  p_after_offset bigint default null,
  p_limit integer default 1000
)
returns table(row_json jsonb)
language sql
security definer
set search_path = pg_catalog, public, atlas
as $$
  select jsonb_build_object(
    'stream_id', event.stream_id,
    'offset', event.offset::text,
    'timestamp', event.timestamp,
    'signal_type', event.signal_type,
    'spacetime', event.spacetime,
    'provenance', event.provenance,
    'payload', event.payload,
    'source_id', event.source_id,
    'jurisdiction_id', event.jurisdiction_id,
    'module_hint', event.module_hint,
    'ingested_at', event.ingested_at,
    'event_identity_hash', identity.event_identity_hash,
    'canonical_identity', jsonb_build_object(
      'canonical_offset', identity.canonical_offset::text,
      'source_record_key', identity.source_record_key,
      'first_seen_at', identity.first_seen_at,
      'source_timestamp', identity.source_timestamp
    )
  ) as row_json
  from public.signal_events event
  join atlas.signal_event_identity identity
    on identity.stream_id = event.stream_id
   and identity.canonical_offset = event.offset
   and identity.event_identity_hash = event.event_identity_hash
  where event.timestamp >= p_from_timestamp
    and event.timestamp <= p_to_timestamp
    and (
      p_after_stream_id is null
      or event.stream_id > p_after_stream_id
      or (event.stream_id = p_after_stream_id and event.offset > p_after_offset)
    )
  order by event.stream_id, event.offset
  limit least(greatest(coalesce(p_limit, 1000), 1), 1000)
$$;

revoke all on function public.atlas_convergence_source_population_page_v1(
  timestamptz, timestamptz, text, bigint, integer
) from public, anon, authenticated;
grant execute on function public.atlas_convergence_source_population_page_v1(
  timestamptz, timestamptz, text, bigint, integer
) to service_role;

comment on function public.atlas_convergence_source_population_page_v1(
  timestamptz, timestamptz, text, bigint, integer
) is
  'Returns the immutable canonical event population for Atlas convergence. Mutable replay_count, historical aggregates, latest offsets, and last_seen_at remain operational telemetry and are excluded from governed hashes.';

commit;
