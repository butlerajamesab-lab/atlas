import { reconcileIngestJobSourceHealth } from '../src/services/sourceHealthReceiptService.js';

const parsedLimit = Number.parseInt(process.argv[2] ?? '1000', 10);
const limit = Number.isSafeInteger(parsedLimit) ? parsedLimit : 1000;

const result = await reconcileIngestJobSourceHealth({ limit });
console.log(JSON.stringify({
  jobs_seen: result.jobs_seen,
  receipts_processed: result.receipts_processed,
  persisted_count: result.persisted_count,
  idempotent_count: result.idempotent_count,
}, null, 2));
