import { supabase } from '../lib/supabaseClient.js';
import { ENGINE_VERSION, sha256 } from '../substrate/canonical.js';

export const ACTION_RECEIPT_VERSION = 'atlas.action_receipt.v1';

function jsonSafe(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

export async function countStreamEvents(streamId) {
  if (!streamId) return null;
  const { count, error } = await supabase
    .from('signal_events')
    .select('*', { count: 'exact', head: true })
    .eq('stream_id', streamId);
  if (error) throw new Error(`action_receipt_event_count_failed:${error.message}`);
  return Number(count ?? 0);
}

export async function recordActionReceipt({
  actionType,
  initiator,
  targetId = null,
  requestedAt,
  completedAt,
  outcomeStatus,
  beforeEventCount = null,
  afterEventCount = null,
  request = {},
  result = {},
}) {
  const eventDelta = beforeEventCount === null || afterEventCount === null
    ? null
    : afterEventCount - beforeEventCount;
  const receipt = {
    receipt_version: ACTION_RECEIPT_VERSION,
    engine_version: ENGINE_VERSION,
    action_type: actionType,
    initiator,
    target_id: targetId,
    requested_at: requestedAt,
    completed_at: completedAt,
    outcome_status: outcomeStatus,
    before_event_count: beforeEventCount,
    after_event_count: afterEventCount,
    event_delta: eventDelta,
    request: jsonSafe(request),
    result: jsonSafe(result),
  };
  const actionReceiptHash = sha256(receipt);
  const { error } = await supabase.from('atlas_action_receipt').insert({
    action_receipt_hash: actionReceiptHash,
    action_type: actionType,
    initiator,
    target_id: targetId,
    requested_at: requestedAt,
    completed_at: completedAt,
    outcome_status: outcomeStatus,
    before_event_count: beforeEventCount,
    after_event_count: afterEventCount,
    event_delta: eventDelta,
    request_json: receipt.request,
    result_json: receipt.result,
    engine_version: ENGINE_VERSION,
  });
  if (error) throw new Error(`action_receipt_persist_failed:${error.message}`);
  return Object.freeze({ ...receipt, action_receipt_hash: actionReceiptHash });
}
