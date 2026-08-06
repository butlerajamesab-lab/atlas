import { buildLegislativeTraitBindingAccounting } from '../civic-genome/legislativeTraitAccounting.js';

async function defaultClient() {
  const { supabase } = await import('../lib/supabaseClient.js');
  return supabase;
}

export async function accountCivicGenomeLegislativeTraits({ snapshotId, projectionKey, client = null }) {
  if (typeof snapshotId !== 'string' || snapshotId.trim() === '') throw new Error('trait_accounting_snapshot_id_required');
  if (typeof projectionKey !== 'string' || !/^[0-9a-f]{64}$/.test(projectionKey)) throw new Error('trait_accounting_projection_key_invalid');
  const db = client ?? await defaultClient();
  const { data: snapshot, error: readError } = await db.rpc('atlas_civic_genome_snapshot_get_v1', {
    p_snapshot_id: snapshotId.trim(),
  });
  if (readError) throw new Error(`trait_accounting_snapshot_read_failed:${readError.message}`);
  if (!snapshot) throw new Error('trait_accounting_snapshot_not_found');
  const accounting = buildLegislativeTraitBindingAccounting(snapshot, projectionKey);
  const { data: receipt, error: persistError } = await db.rpc(
    'atlas_civic_genome_legislative_trait_accounting_persist_v1',
    { p_receipt: accounting },
  );
  if (persistError) throw new Error(`trait_accounting_persist_failed:${persistError.message}`);
  return Object.freeze({ accounting, receipt });
}

export async function runCivicGenomeLegislativeTraitAccountingFromEnvironment(environment = process.env) {
  const snapshotId = environment.ATLAS_CIVIC_GENOME_TRAIT_ACCOUNTING_SNAPSHOT_ID?.trim() ?? '';
  const projectionKey = environment.ATLAS_CIVIC_GENOME_TRAIT_ACCOUNTING_PROJECTION_KEY?.trim() ?? '';
  if (!snapshotId && !projectionKey) return null;
  if (!snapshotId || !projectionKey) throw new Error('trait_accounting_requires_complete_environment');
  const result = await accountCivicGenomeLegislativeTraits({ snapshotId, projectionKey });
  return Object.freeze({
    snapshot_id: snapshotId,
    projection_key: projectionKey,
    status: result.receipt?.status ?? null,
    total_trait_count: result.accounting.total_trait_count,
    exact_version_bound_trait_count: result.accounting.exact_version_bound_trait_count,
    historical_same_source_trait_count: result.accounting.historical_same_source_trait_count,
    unresolved_trait_count: result.accounting.unresolved_trait_count,
    completeness_state: result.accounting.completeness_state,
    accounting_hash: result.accounting.accounting_hash,
  });
}
