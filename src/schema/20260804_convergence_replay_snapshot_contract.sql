begin;

-- The persistence writer accepts snapshot payloads as `records`, while the
-- storage table names the immutable JSONB column `records_json`. The replay RPC
-- is a transport boundary and must expose the declared engine contract rather
-- than leak the storage-column name.
create or replace function public.atlas_convergence_get_replay_bundle_v1(p_run_key text)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, atlas
as $$
  select jsonb_build_object(
    'manifest', to_jsonb(manifest) - 'persisted_at',
    'registry', jsonb_build_object(
      'registry_hash', registry.registry_hash,
      'registry_version', registry.registry_version,
      'jurisdiction', registry.jurisdiction,
      'analysis_level', registry.analysis_level,
      'source_id', registry.source_id,
      'source_version', registry.source_version,
      'source_url', registry.source_url,
      'entries_json', registry.entries_json,
      'provenance_records', registry.provenance_records
    ),
    'snapshots', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'run_key', snapshot.run_key,
          'snapshot_type', snapshot.snapshot_type,
          'population_hash', snapshot.population_hash,
          'record_count', snapshot.record_count,
          'records', snapshot.records_json
        )
        order by snapshot.snapshot_type
      )
      from atlas.convergence_signal_snapshot snapshot
      where snapshot.run_key = manifest.run_key
    ), '[]'::jsonb),
    'receipts', coalesce((
      select jsonb_agg(to_jsonb(receipt) - 'persisted_at' order by receipt.geography_id)
      from atlas.convergence_receipt receipt
      where receipt.run_key = manifest.run_key
    ), '[]'::jsonb),
    'result', to_jsonb(result) - 'persisted_at'
  )
  from atlas.convergence_run_manifest manifest
  join atlas.geography_registry_snapshot registry
    on registry.registry_hash = manifest.analysis_registry_hash
  join atlas.convergence_result_payload result using (run_key)
  where manifest.run_key = p_run_key
$$;

revoke all on function public.atlas_convergence_get_replay_bundle_v1(text)
  from public, anon, authenticated;
grant execute on function public.atlas_convergence_get_replay_bundle_v1(text)
  to service_role;

comment on function public.atlas_convergence_get_replay_bundle_v1(text) is
  'Returns an immutable Atlas convergence replay bundle using engine-contract snapshot key records; records_json remains an internal storage-column name.';

commit;
