import express from 'express';
import { assertSignalIngestRequest } from '../lib/validators.js';
import { buildRowsForIngest, persistSignalRows } from '../services/streamStore.js';

export function ingestRouter({ apiError }) {
  const router = express.Router();

  router.post('/v1/ingest/signals', async (req, res) => {
    try {
      const errors = assertSignalIngestRequest(req.body);
      if (errors.length) return apiError(res, 400, 'Invalid SignalIngestRequest', errors);

      const rows = await buildRowsForIngest(req.body);
      const receipt = await persistSignalRows(rows);
      const status = String(receipt.status ?? 'completed');
      const statusCode = status === 'failed' ? 500 : status === 'partial' ? 207 : 200;

      return res.status(statusCode).json({
        accepted: status !== 'failed',
        status,
        ingested_count: Number(receipt.events_inserted ?? 0),
        replayed_count: Number(receipt.replays_suppressed ?? 0),
        records_seen: Number(receipt.records_seen ?? rows.length),
        records_failed: Number(receipt.records_failed ?? 0),
        run_id: receipt.run_id ?? null,
        stream_id: receipt.stream_id ?? null,
        cursor_before: receipt.cursor_before ?? null,
        cursor_after: receipt.cursor_after ?? null,
        partial_completion: Boolean(receipt.partial_completion),
        error_message: receipt.error_message ?? null,
        receipts: Array.isArray(receipt.receipts) ? receipt.receipts : [],
      });
    } catch (error) {
      return apiError(res, error.status || 500, error.message, error.details);
    }
  });

  return router;
}