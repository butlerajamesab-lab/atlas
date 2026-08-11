import crypto from 'crypto';
import { supabase } from '../lib/supabaseClient.js';

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function latestReceiptByTarget(receipts) {
  const map = new Map();
  for (const receipt of receipts || []) {
    if (!receipt?.target_id || map.has(receipt.target_id)) continue;
    map.set(receipt.target_id, receipt);
  }
  return map;
}

export async function buildStreamRuntimeSnapshot({ adapterRegistry, adapterStreamIds }) {
  const { data: streamRows, error: streamError } = await supabase
    .from('v_atlas_stream_runtime_summary_v1')
    .select('*')
    .order('stream_id');
  if (streamError) throw new Error(`Atlas stream runtime read failed: ${streamError.message}`);

  const { data: receipts, error: receiptError } = await supabase
    .from('atlas_action_receipt')
    .select('target_id,outcome_status,completed_at,result_json')
    .eq('action_type', 'adapter_run')
    .order('completed_at', { ascending: false })
    .limit(500);
  if (receiptError) throw new Error(`Atlas adapter receipt read failed: ${receiptError.message}`);

  const receiptByTarget = latestReceiptByTarget(receipts);
  const adapterByStream = new Map((adapterRegistry || []).map((adapter) => [
    adapterStreamIds?.[adapter.name],
    adapter,
  ]));

  const streams = (streamRows || []).map((row) => {
    const adapter = adapterByStream.get(row.stream_id);
    const receipt = receiptByTarget.get(row.stream_id);
    const result = receipt?.result_json || {};
    return {
      stream_id: row.stream_id,
      source_id: row.source_id,
      jurisdiction_id: row.jurisdiction_id,
      module_hint: row.module_hint,
      status: row.status,
      governance_contract_id: row.governance_contract_id || null,
      runnable: Boolean(adapter),
      adapter_name: adapter?.name || null,
      schedule_priority: adapter?.priority || null,
      interval_hours: adapter ? Math.round(adapter.intervalMs / 3_600_000) : null,
      observation_count: Number(row.event_count ?? 0),
      identity_bound_observation_count: Number(row.identity_count ?? 0),
      observation_classification_count: Number(row.signal_type_count ?? 0),
      first_observed_at: row.first_event_at || null,
      latest_observed_at: row.latest_event_at || null,
      latest_ingested_at: row.latest_ingested_at || null,
      last_run_status: result.status || receipt?.outcome_status || null,
      last_run_outcome: result.outcome || receipt?.outcome_status || null,
      last_run_at: receipt?.completed_at || null,
      last_error: result.error || null,
    };
  });

  const observedAt = new Date().toISOString();
  const snapshotMaterial = {
    contract_version: 'atlas_stream_runtime_projection_v1',
    streams,
  };
  return {
    ...snapshotMaterial,
    observed_at: observedAt,
    snapshot_hash: stableHash(snapshotMaterial),
  };
}

export async function projectStreamRuntimeSnapshot({ adapterRegistry, adapterStreamIds }) {
  const snapshot = await buildStreamRuntimeSnapshot({ adapterRegistry, adapterStreamIds });
  const { data, error } = await supabase.rpc('bridge_atlas_stream_runtime_snapshot_v1', {
    p_snapshot: snapshot,
  });
  if (error) throw new Error(`Atlas stream runtime bridge failed: ${error.message}`);
  if (!data || data.status !== 'completed' || data.snapshot_hash !== snapshot.snapshot_hash) {
    throw new Error(`Atlas stream runtime bridge returned invalid receipt: ${JSON.stringify(data ?? null)}`);
  }
  return {
    ...data,
    stream_count: snapshot.streams.length,
  };
}
