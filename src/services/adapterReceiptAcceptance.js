/**
 * Reject incomplete adapter transport receipts before reporting a completed run.
 * Not a source-content certification gate. Unknown or partial outcomes fail closed.
 */
function rejectedAdapterReceipt(message, receipt) {
  const error = new Error(message);
  if (receipt?.source_hold && typeof receipt.source_hold === 'object') {
    error.source_hold = receipt.source_hold;
  } else if (receipt?.source_holds?.length) {
    error.source_hold = {
      source: 'pro_publica',
      reason: 'source_metadata_unverified',
      held_count: Number(receipt.source_hold_count ?? receipt.source_holds.length),
      held_refs: receipt.source_holds.slice(0, 25),
      held_refs_truncated: Number(receipt.source_hold_count ?? 0) > 25,
    };
  } else if (receipt?.source_window_incomplete === true) {
    error.source_hold = {
      reason: 'source_window_incomplete',
      pages_fetched: receipt.source_pages_processed ?? null,
      pages_total: receipt.source_pages_total ?? null,
    };
  }
  return error;
}

export function assertCompleteAdapterReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object' || receipt.accepted !== true) {
    throw rejectedAdapterReceipt('atlas_adapter_missing_receipt: explicit accepted=true is required', receipt);
  }
  const state = String(receipt.status ?? 'completed');
  const failed = receipt.records_failed === undefined ? 0 : Number(receipt.records_failed);
  if (!Number.isFinite(failed) || failed < 0) {
    throw new Error('atlas_adapter_invalid_receipt: records_failed must be nonnegative');
  }
  const sourceHoldCount = Number(receipt.source_hold_count ?? 0);
  const incompleteWindow = receipt.source_window_incomplete === true;
  if (!Number.isSafeInteger(sourceHoldCount) || sourceHoldCount < 0) {
    throw new Error('atlas_adapter_invalid_receipt: source_hold_count must be a nonnegative integer');
  }
  if (!['completed', 'source_empty'].includes(state) ||
      receipt.partial_completion === true || failed > 0 || sourceHoldCount > 0 || incompleteWindow) {
    throw rejectedAdapterReceipt(
      `atlas_adapter_incomplete_receipt: status=${state} records_failed=${failed} ` +
      `source_hold_count=${sourceHoldCount} source_window_incomplete=${incompleteWindow}`,
      receipt,
    );
  }
  return receipt;
}

/** Standalone commands must not turn an incomplete/held transport receipt into exit 0. */
export function evaluateAdapterCliReceipt(receipt) {
  try {
    assertCompleteAdapterReceipt(receipt);
    return { ok: true, exit_code: 0, reason: null };
  } catch (error) {
    return { ok: false, exit_code: 1, reason: String(error.message), source_hold: error.source_hold ?? null };
  }
}
