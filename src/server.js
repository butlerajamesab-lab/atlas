import dotenv from 'dotenv';
import express from 'express';
import { ingestRouter } from './routes/ingest.js';
import { streamsRouter } from './routes/streams.js';
import { investigationsRouter } from './routes/investigations.js';
import { patternsRouter } from './routes/patterns.js';
import { populationRouter } from './routes/population.js';
import { recognitionAtlasRouter } from './routes/recognition_atlas.js';
import convergenceRouter from './routes/convergence.js';
import { requireBearerToken } from './lib/serviceAuth.js';
import { luminariStreamHealthManifest } from './services/streamHealthInvestigation.js';
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') return res.status(204).end();
  return next();
});

app.use(express.json({ limit: '5mb' }));

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
    live_data_signal_engine: 'atlas.live_data_signal_exact@1.0.0',
  });
});

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

// All remaining operational and data routes require the private control token.
app.use(requireControl);
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
  });
}

export default app;