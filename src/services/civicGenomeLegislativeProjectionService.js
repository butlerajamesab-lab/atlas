import { buildLegislativeVersionObservations } from '../civic-genome/legislativeObservationMapper.js';

async function getDefaultClient() {
  const module = await import('../lib/supabaseClient.js');
  return module.supabase;
}

export async function projectCivicGenomeLegislativeSnapshot(snapshotId, client = null) {
  const normalizedId = typeof snapshotId === 'string' ? snapshotId.trim() : '';
  if (!normalizedId) throw new Error('civic_genome_legislative_projection_snapshot_id_required');
  const db = client ?? await getDefaultClient();

  const snapshotResponse = await db.rpc('atlas_civic_genome_snapshot_get_v1', {
    p_snapshot_id: normalizedId,
  });
  if (snapshotResponse.error) {
    throw new Error(`civic_genome_legislative_projection_snapshot_read_failed:${snapshotResponse.error.message}`);
  }
  if (!snapshotResponse.data) {
    throw new Error('civic_genome_legislative_projection_snapshot_not_found');
  }

  const bundle = buildLegislativeVersionObservations(snapshotResponse.data);
  const persistResponse = await db.rpc('atlas_civic_genome_legislative_projection_persist_v1', {
    p_bundle: bundle,
  });
  if (persistResponse.error) {
    throw new Error(`civic_genome_legislative_projection_persist_failed:${persistResponse.error.message}`);
  }
  return Object.freeze({ bundle, receipt: persistResponse.data });
}

export async function runCivicGenomeLegislativeProjectionFromEnvironment(
  environment = process.env,
  client = null,
) {
  const snapshotId = environment.ATLAS_CIVIC_GENOME_LEGISLATIVE_PROJECTION_SNAPSHOT_ID?.trim() ?? '';
  if (!snapshotId) return null;
  const result = await projectCivicGenomeLegislativeSnapshot(snapshotId, client);
  return Object.freeze({
    snapshot_id: snapshotId,
    projection_key: result.bundle.projection_key,
    source_version_count: result.bundle.source_version_count,
    observation_count: result.bundle.observation_count,
    status: result.receipt?.status ?? null,
    events_inserted: result.receipt?.events_inserted ?? null,
    replays_suppressed: result.receipt?.replays_suppressed ?? null,
  });
}
