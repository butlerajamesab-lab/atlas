import { reconcileIngestJobSourceHealth } from '../src/services/sourceHealthReceiptService.js';

const parsedLimit = Number.parseInt(process.argv[2] ?? '1000', 10);
const limit = Number.isSafeInteger(parsedLimit) ? parsedLimit : 1000;

// Exhaust the immutable UUID cursor in bounded pages instead of repeatedly
// rereading the oldest ingest jobs on each historical reconciliation.
let after_id = null;
const totals = {
  jobs_seen: 0,
  receipts_processed: 0,
  persisted_count: 0,
  idempotent_count: 0,
  pages_processed: 0,
};
do {
  const page = await reconcileIngestJobSourceHealth({ limit, after_id });
  totals.jobs_seen += page.jobs_seen;
  totals.receipts_processed += page.receipts_processed;
  totals.persisted_count += page.persisted_count;
  totals.idempotent_count += page.idempotent_count;
  totals.pages_processed += 1;
  if (page.next_cursor === after_id && page.next_cursor !== null) {
    throw new Error('source_health_reconcile_cursor_did_not_advance');
  }
  after_id = page.next_cursor;
} while (after_id !== null);
console.log(JSON.stringify(totals, null, 2));
