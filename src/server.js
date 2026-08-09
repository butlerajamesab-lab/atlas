import dotenv from 'dotenv';
import express from 'express';
import { ingestRouter } from './routes/ingest.js';
import { streamsRouter } from './routes/streams.js';
import { investigationsRouter } from './routes/investigations.js';
import { patternsRouter } from './routes/patterns.js';
import { populationRouter } from './routes/population.js';
import { recognitionAtlasRouter } from './routes/recognition_atlas.js';
import { civicGenomeSnapshotsRouter } from './routes/civicGenomeSnapshots.js';
import { atlasUiRouter, FRONTEND_READ_MODEL_VERSION } from './routes/ui.js';
import { atlasOperatorRouter } from './routes/operator.js';
import { esquireBridgeRouter } from './routes/esquireBridge.js';
import convergenceRouter from './routes/convergence.js';
import { requireBearerToken } from './lib/serviceAuth.js';
import { luminariStreamHealthManifest } from './services/streamHealthInvestigation.js';
import { runConvergenceAcceptanceFromEnvironment } from './services/convergenceAcceptance.js';
import { runCivicGenomeLegislativeProjectionFromEnvironment } from './services/civicGenomeLegislativeProjectionService.js';
import { runCivicGenomeLegislativeTraitAccountingFromEnvironment } from './services/civicGenomeLegislativeTraitAccountingService.js';
import {
  startScheduler,
  getSchedulerStatus,
  triggerAdapterNow,
  triggerBridgeDrainNow,
  triggerLiveDataSignalBridgeNow,
} from './services/scheduler.js';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 8787);
const SCHEDULER_ENABLED = process.env.ATLAS_SCHEDULER_ENABLED !== 'false';
const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
];
const ALLOWED_ORIGINS = (process.env.ATLAS_ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(','))
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('*'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Atlas-Civic-Genome-Key-Id,X-Atlas-Civic-Genome-Signature');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') return res.status(204).end();
  return next();
});

app.use(express.json({ limit: '25mb' }));

export function apiError(res, status, message, details = undefined) {
  return res.status(status).json({ error: message, details });
}

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'atlas-streaming-engine',
    supabase_project_ref: process.env.SUPABASE_PROJECT_REF || 'bjdjjgnkhxblnpdrjqtw',
    function_id: luminariStreamHealthManifest.function_id,
    scheduler_enabled: SCHEDULER_ENABLED,
    event_identity_version: '1.0.0',
    live_data_signal_engine: 'atlas.live_data_signal_exact@1.1.0',
    convergence_engine_version: '2.1.0',
    civic_genome_snapshot_intake: 'atlas.civic_genome_snapshot_delivery.v1',
    civic_genome_legislative_mapping: 'atlas.civic_genome_legislative_version_observation@1.0.0',
    civic_genome_trait_accounting: 'atlas.civic_genome_legislative_trait_binding_accounting@1.0.0',
    frontend_read_model_version: FRONTEND_READ_MODEL_VERSION,
    frontend_available: true,
  });
});

app.get('/favicon.ico', (_req, res) => res.status(204).end());

const requireControl = requireBearerToken('ATLAS_CONTROL_TOKEN');
const requireIngest = requireBearerToken('ATLAS_INGEST_TOKEN');

app.use('/v1/ingest', requireIngest);
app.use('/scheduler', requireControl);

app.get('/scheduler/status', (_req, res) => {
  res.json(getSchedulerStatus());
});

app.post('/scheduler/bridge-drain', async (_req, res) => {
  const stats = await triggerBridgeDrainNow();
  res.status(410).json({ ok: false, stats, triggered_at: new Date().toISOString() });
});

app.post('/scheduler/live-data-signals', async (_req, res) => {
  try {
    const stats = await triggerLiveDataSignalBridgeNow();
    res.json({ ok: true, stats, triggered_at: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.post('/scheduler/trigger/:adapterName', async (req, res) => {
  const { adapterName } = req.params;
  try {
    const result = await triggerAdapterNow(adapterName);
    res.json({ ok: true, adapter: adapterName, result, triggered_at: new Date().toISOString() });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

const routeContext = { apiError };
app.use(ingestRouter(routeContext));
app.use(civicGenomeSnapshotsRouter(routeContext));

// Atlas Frontend v1 is a bounded inspection surface. These routes expose only
// public-safe aggregate/source metadata and the public legislative-history stream.
// They never expose service-role credentials, connector auth configuration, or
// generic signal payloads from complaint/benefit/enforcement streams.
app.use(atlasUiRouter(routeContext));
app.use(express.static('public', { etag: true, maxAge: '5m' }));

// All operational, unrestricted data, and case bridge routes remain private control surfaces.
app.use(requireControl);
app.use(atlasOperatorRouter(routeContext));
app.use(esquireBridgeRouter());
app.use(streamsRouter(routeContext));
app.use(populationRouter(routeContext));
app.use(investigationsRouter(routeContext));
app.use(patternsRouter(routeContext));
app.use(recognitionAtlasRouter);
app.use('/v1/convergence', convergenceRouter);

app.use((req, res) => apiError(res, 404, `Route not found: ${req.method} ${req.path}`));

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Atlas Streaming Engine listening on http://0.0.0.0:${PORT}`);
    if (SCHEDULER_ENABLED) startScheduler();
    else console.log('[scheduler] Disabled via ATLAS_SCHEDULER_ENABLED=false');

    void runConvergenceAcceptanceFromEnvironment()
      .then((receipt) => {
        if (!receipt) return;
        console.log('[convergence-acceptance] completed', receipt);
      })
      .catch((error) => {
        console.error('[convergence-acceptance] failed', {
          error_class: error instanceof Error ? error.name : 'unknown',
          error_message: error instanceof Error ? error.message : String(error),
        });
      });

    void runCivicGenomeLegislativeProjectionFromEnvironment()
      .then((receipt) => {
        if (!receipt) return;
        console.log('[civic-genome-legislative-projection] completed', receipt);
      })
      .catch((error) => {
        console.error('[civic-genome-legislative-projection] failed', {
          error_class: error instanceof Error ? error.name : 'unknown',
          error_message: error instanceof Error ? error.message : String(error),
        });
      });

    void runCivicGenomeLegislativeTraitAccountingFromEnvironment()
      .then((receipt) => {
        if (!receipt) return;
        console.log('[civic-genome-trait-accounting] completed', receipt);
      })
      .catch((error) => {
        console.error('[civic-genome-trait-accounting] failed', {
          error_class: error instanceof Error ? error.name : 'unknown',
          error_message: error instanceof Error ? error.message : String(error),
        });
      });
  });
}

export default app;
