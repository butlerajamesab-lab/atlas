import express from 'express';
import { supabase } from '../lib/supabaseClient.js';
import { assertSignalIngestRequest } from '../lib/validators.js';
import { buildRowsForIngest } from '../services/streamStore.js';

export function ingestRouter({ apiError }) {
  const router = express.Router();

  router.post('/v1/ingest/signals', async (req, res) => {
    try {
      const errors = assertSignalIngestRequest(req.body);
      if (errors.length) return apiError(res, 400, 'Invalid SignalIngestRequest', errors);

      const rows = await buildRowsForIngest(req.body);
      if (!rows.length) return res.json({ accepted: true, ingested_count: 0 });

      const { data, error } = await supabase
        .from('signal_events')
        .upsert(rows, { onConflict: 'stream_id,offset' })
        .select('stream_id,offset');
      if (error) throw error;

      return res.json({ accepted: true, ingested_count: data?.length ?? rows.length });
    } catch (error) {
      return apiError(res, error.status || 500, error.message, error.details);
    }
  });

  return router;
}
