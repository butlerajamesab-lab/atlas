import express from 'express';
import {
  listReservoirStreams,
  listReservoirRecords,
  getReservoirRecord,
  RESERVOIR_CENSUS_CACHE_TTL_MS,
} from '../services/reservoirViewerService.js';

// Reservoir viewer API (Lane B). Mounted in server.js AFTER
// requireControl: raw signal payloads are an operator surface and
// never cross the public-safe frontend boundary.
export function reservoirRouter({ apiError }) {
  const router = express.Router();

  let censusCache = null;
  let censusCachedAt = 0;

  router.get('/reservoir-api/streams', async (_req, res) => {
    try {
      const now = Date.now();
      if (!censusCache || now - censusCachedAt > RESERVOIR_CENSUS_CACHE_TTL_MS) {
        censusCache = await listReservoirStreams();
        censusCachedAt = now;
      }
      return res.json(censusCache);
    } catch (error) {
      console.error('[reservoir] census failed:', error?.message ?? error);
      return apiError(res, 500, error.message);
    }
  });

  router.get('/reservoir-api/streams/:stream_id/records', async (req, res) => {
    try {
      const page = await listReservoirRecords(undefined, req.params.stream_id, {
        limit: req.query.limit,
        beforeOffset: req.query.before_offset,
      });
      if (!page) return apiError(res, 404, 'Stream not found');
      return res.json(page);
    } catch (error) {
      console.error('[reservoir] records failed:', error?.message ?? error);
      return apiError(res, 500, error.message);
    }
  });

  router.get('/reservoir-api/streams/:stream_id/records/:offset', async (req, res) => {
    try {
      const record = await getReservoirRecord(
        undefined,
        req.params.stream_id,
        req.params.offset,
      );
      if (!record) return apiError(res, 404, 'Record not found');
      return res.json(record);
    } catch (error) {
      console.error('[reservoir] record failed:', error?.message ?? error);
      return apiError(res, 500, error.message);
    }
  });

  return router;
}
