import express from 'express';
import { acceptAtlasCivicGenomeSnapshot } from '../services/civicGenomeSnapshotIntakeService.js';

export function civicGenomeSnapshotsRouter({ apiError }) {
  const router = express.Router();

  router.post('/v1/civic-genome/snapshots', async (req, res) => {
    try {
      const key_id = String(req.headers['x-atlas-civic-genome-key-id'] ?? '').trim();
      const signature = String(req.headers['x-atlas-civic-genome-signature'] ?? '').trim();
      const receipt = await acceptAtlasCivicGenomeSnapshot({
        body: req.body,
        key_id,
        signature,
      });
      res.status(200).json(receipt);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('unauthorized_civic_genome_delivery:')) {
        return apiError(res, 401, 'Civic Genome snapshot authentication failed');
      }
      if (message.startsWith('invalid_civic_genome_snapshot:')) {
        return apiError(res, 400, 'Civic Genome snapshot validation failed', message);
      }
      return apiError(res, 500, 'Civic Genome snapshot intake failed', message);
    }
  });

  return router;
}
