/**
 * Atlas Internal Scheduler Service
 * 
 * Governs ingestion cadence internally. No external cron dependency.
 * All adapters run on defined intervals. Bridge emission is automatic
 * via the trg_bridge_emit_signal_v1 trigger on civic_map_signals.
 * 
 * Canonical flow:
 *   Scheduler → Adapter → civic_map_signals → trigger → atlas_lighthouse_signal_bridge_v1
 * 
 * IMPORTANT: The scheduler NEVER writes directly to Lighthouse.
 * It only drives adapter ingestion. Bridge is handled by the DB trigger.
 */

import dotenv from 'dotenv';
dotenv.config();

// ─── Adapter registry ────────────────────────────────────────────────────────
// Each adapter has: name, module path, function name, args, intervalMs, lastRun
const STATE = process.env.ATLAS_STATE || 'WA';
const STATE_FIPS = STATE === 'WA' ? '53' : STATE;

const ADAPTER_REGISTRY = [
  // High-frequency: judicial + legislative (every 6 hours)
  {
    name: 'courtlistener',
    module: '../adapters/courtListenerAdapter.js',
    fn: 'runIngestCourtListener',
    args: {},
    intervalMs: 6 * 60 * 60 * 1000,   // 6h
    priority: 'high',
  },
  {
    name: 'openstates',
    module: '../adapters/openStatesAdapter.js',
    fn: 'ingestOpenStatesSignals',
    args: {},
    intervalMs: 6 * 60 * 60 * 1000,   // 6h
    priority: 'high',
  },
  {
    name: 'propublica',
    module: '../adapters/proPublicaAdapter.js',
    fn: 'runIngestProPublica',
    args: {},
    intervalMs: 6 * 60 * 60 * 1000,   // 6h
    priority: 'high',
  },
  // Medium-frequency: civic + regulatory (every 12 hours)
  {
    name: 'cfpb_complaints',
    module: '../adapters/cfpbComplaintsAdapter.js',
    fn: 'ingestCfpbSignals',
    args: { state: STATE },
    intervalMs: 12 * 60 * 60 * 1000,  // 12h
    priority: 'medium',
  },
  {
    name: 'regulations_gov',
    module: '../adapters/regulationsGovAdapter.js',
    fn: 'ingestRegulationsSignals',
    args: {},
    intervalMs: 12 * 60 * 60 * 1000,  // 12h
    priority: 'medium',
  },
  {
    name: 'grants_gov',
    module: '../adapters/grantsGovAdapter.js',
    fn: 'ingestGrantsGovSignals',
    args: {},
    intervalMs: 12 * 60 * 60 * 1000,  // 12h
    priority: 'medium',
  },
  {
    name: 'osha_inspections',
    module: '../adapters/oshaInspectionsAdapter.js',
    fn: 'ingestOshaSignals',
    args: { state: STATE },
    intervalMs: 12 * 60 * 60 * 1000,  // 12h
    priority: 'medium',
  },
  {
    name: 'epa_echo',
    module: '../adapters/epaEchoAdapter.js',
    fn: 'ingestEpaSignals',
    args: { state: STATE },
    intervalMs: 12 * 60 * 60 * 1000,  // 12h
    priority: 'medium',
  },
  // Low-frequency: economic / financial (every 24 hours)
  {
    name: 'census_acs',
    module: '../adapters/censusAcsAdapter.js',
    fn: 'ingestCensusSignals',
    args: { state: STATE_FIPS },
    intervalMs: 24 * 60 * 60 * 1000,  // 24h
    priority: 'low',
  },
  {
    name: 'usda_snap',
    module: '../adapters/usdaSnapAdapter.js',
    fn: 'ingestSnapSignals',
    args: { state: STATE },
    intervalMs: 24 * 60 * 60 * 1000,  // 24h
    priority: 'low',
  },
  {
    name: 'hud_fmr',
    module: '../adapters/hudHousingAdapter.js',
    fn: 'ingestHudSignals',
    args: { stateCode: STATE_FIPS },
    intervalMs: 24 * 60 * 60 * 1000,  // 24h
    priority: 'low',
  },
  {
    name: 'bls_employment',
    module: '../adapters/blsEmploymentAdapter.js',
    fn: 'ingestBlsSignals',
    args: {},
    intervalMs: 24 * 60 * 60 * 1000,  // 24h
    priority: 'low',
  },
  {
    name: 'fec_campaign_finance',
    module: '../adapters/fecCampaignFinanceAdapter.js',
    fn: 'ingestFecSignals',
    args: { state: STATE },
    intervalMs: 24 * 60 * 60 * 1000,  // 24h
    priority: 'low',
  },
  {
    name: 'sec_edgar',
    module: '../adapters/secEdgarAdapter.js',
    fn: 'ingestSecSignals',
    args: {},
    intervalMs: 24 * 60 * 60 * 1000,  // 24h
    priority: 'low',
  },
  {
    name: 'usa_spending',
    module: '../adapters/usaSpendingAdapter.js',
    fn: 'ingestUsaSpendingSignals',
    args: { state: STATE },
    intervalMs: 24 * 60 * 60 * 1000,  // 24h
    priority: 'low',
  },
  {
    name: 'irs_exempt_orgs',
    module: '../adapters/irsExemptOrgAdapter.js',
    fn: 'ingestIrsExemptSignals',
    args: { state: STATE },
    intervalMs: 24 * 60 * 60 * 1000,  // 24h
    priority: 'low',
  },
  {
    name: 'opensecrets_lda',
    module: '../adapters/openSecretsAdapter.js',
    fn: 'ingestOpenSecretsSignals',
    args: {},
    intervalMs: 24 * 60 * 60 * 1000,  // 24h
    priority: 'low',
  },
  {
    name: 'fara_foreign_agents',
    module: '../adapters/faraForeignAgentsAdapter.js',
    fn: 'ingestFaraSignals',
    args: {},
    intervalMs: 24 * 60 * 60 * 1000,  // 24h
    priority: 'low',
  },
];

// ─── Scheduler state ─────────────────────────────────────────────────────────
const adapterState = new Map();
let schedulerRunning = false;
let schedulerStartedAt = null;

// ─── Run a single adapter ─────────────────────────────────────────────────────
async function runAdapter(adapter) {
  const start = Date.now();
  const state = adapterState.get(adapter.name) || { running: false, lastRun: null, lastResult: null, errors: 0 };

  if (state.running) {
    console.log(`[scheduler] [SKIP] ${adapter.name} — already running`);
    return;
  }

  state.running = true;
  adapterState.set(adapter.name, state);

  try {
    const mod = await import(adapter.module);
    const fn = mod[adapter.fn];

    if (!fn) {
      throw new Error(`Function ${adapter.fn} not found in ${adapter.module}`);
    }

    const result = await fn(adapter.args || {});
    const elapsed = Date.now() - start;
    const count = result?.ingested_count ?? result?.accepted ?? result?.count ?? '?';

    console.log(`[scheduler] [OK]   ${adapter.name} — ${count} signals (${elapsed}ms)`);

    state.lastRun = new Date().toISOString();
    state.lastResult = { count, elapsed, status: 'ok' };
    state.errors = 0;
  } catch (err) {
    const elapsed = Date.now() - start;
    console.error(`[scheduler] [FAIL] ${adapter.name} — ${err.message?.slice(0, 120)} (${elapsed}ms)`);

    state.lastRun = new Date().toISOString();
    state.lastResult = { status: 'error', error: err.message?.slice(0, 200), elapsed };
    state.errors = (state.errors || 0) + 1;
  } finally {
    state.running = false;
    adapterState.set(adapter.name, state);
  }
}

// ─── Schedule a single adapter ────────────────────────────────────────────────
function scheduleAdapter(adapter) {
  // Stagger initial run: high = 30s, medium = 2min, low = 5min
  const initialDelay = adapter.priority === 'high' ? 30_000
    : adapter.priority === 'medium' ? 2 * 60_000
    : 5 * 60_000;

  // Run once after initial delay, then on interval
  setTimeout(async () => {
    await runAdapter(adapter);
    setInterval(() => runAdapter(adapter), adapter.intervalMs);
  }, initialDelay);

  console.log(`[scheduler] Scheduled ${adapter.name} (${adapter.priority}) — first run in ${Math.round(initialDelay / 1000)}s, then every ${Math.round(adapter.intervalMs / 3600_000)}h`);
}

// ─── Public API ───────────────────────────────────────────────────────────────
export function startScheduler() {
  if (schedulerRunning) {
    console.log('[scheduler] Already running');
    return;
  }

  schedulerRunning = true;
  schedulerStartedAt = new Date().toISOString();

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║  ATLAS INTERNAL SCHEDULER — STARTING             ║');
  console.log(`║  State: ${STATE.padEnd(5)} | Adapters: ${ADAPTER_REGISTRY.length.toString().padEnd(2)}                ║`);
  console.log('╚══════════════════════════════════════════════════╝\n');

  for (const adapter of ADAPTER_REGISTRY) {
    scheduleAdapter(adapter);
  }

  console.log('\n[scheduler] All adapters scheduled. Bridge emission is automatic via DB trigger.\n');
}

export function getSchedulerStatus() {
  return {
    running: schedulerRunning,
    started_at: schedulerStartedAt,
    state: STATE,
    adapters: ADAPTER_REGISTRY.map(a => ({
      name: a.name,
      priority: a.priority,
      interval_hours: Math.round(a.intervalMs / 3600_000),
      ...adapterState.get(a.name),
    })),
  };
}

export function triggerAdapterNow(adapterName) {
  const adapter = ADAPTER_REGISTRY.find(a => a.name === adapterName);
  if (!adapter) {
    throw new Error(`Unknown adapter: ${adapterName}`);
  }
  return runAdapter(adapter);
}

export { ADAPTER_REGISTRY };
