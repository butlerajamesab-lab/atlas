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
  if (['failed', 'error', 'partial'].includes(state) || receipt.partial_completion === true || failed > 0) {
    throw new Error('atlas_adapter_incomplete_receipt: partial/failed source transport cannot be called complete');
  }
  return receipt;
}
