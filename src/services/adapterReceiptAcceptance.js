/**
 * Reject incomplete adapter transport receipts before reporting a completed run.
 * Not a source-content certification gate. Unknown or partial outcomes fail closed.
 */
export function assertCompleteAdapterReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object' || receipt.accepted !== true) {
    throw new Error('atlas_adapter_missing_receipt: explicit accepted=true is required');
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
  if (['failed', 'error', 'partial', 'held_source_metadata'].includes(state) ||
      receipt.partial_completion === true || failed > 0 || sourceHoldCount > 0 || incompleteWindow) {
    throw new Error(
      `atlas_adapter_incomplete_receipt: status=${state} records_failed=${failed} ` +
      `source_hold_count=${sourceHoldCount} source_window_incomplete=${incompleteWindow}`,
    );
  }
  return receipt;
}
