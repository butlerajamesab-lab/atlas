import express from 'express';
import {
  populatePublicStreams,
  summarizePublicStreamCatalog,
} from '../services/publicStreamCatalog.js';

export function populationRouter({ apiError }) {
  const router = express.Router();

  router.get('/v1/population/catalog', (_req, res) => {
    res.json(summarizePublicStreamCatalog());
  });

  router.post('/v1/population/streams', async (req, res) => {
    try {
      const stream_ids = Array.isArray(req.body?.stream_ids) ? req.body.stream_ids : undefined;
      const result = await populatePublicStreams({ stream_ids });
      res.json({
        ok: true,
        ...result,
      });
    } catch (error) {
      return apiError(res, 500, 'Atlas public stream population failed', {
        message: error.message,
      });
    }
  });

  return router;
}
