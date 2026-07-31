/**
 * Atlas Internal Scheduler Service
 *
 * Canonical ownership:
 *   Scheduler → source adapter → replay-safe signal event persistence
 *   Scheduler → deterministic Domain 3 detector → Lighthouse live_data_signals
 *
 * The retired civic-map signal drain is deliberately not scheduled because it
 * can invent transport defaults and targets the legacy mixed signal contract.
 */

import dotenv from 'dotenv';
dotenv.config();

import { runLiveDataSignalBridge } from './liveDataSignalBridgeService.js';

const STATE = process.env.ATLAS_STATE || 'WA';
const STATE_FIPS = STATE === 'WA' ? '53' : STATE;

const ADAPTER_REGISTRY = [
  {
    name: 'courtlistener',
    module: '../adapters/courtListenerAdapter.js',
    fn: 'runIngestCourtListener',
    args: {},
    intervalMs: 6 * 60 * 60 * 1000,
    priority: 'high',
  },
  {
    name: 'openstates',
    module: '../adapters/openStatesAdapter.js',
    fn: 'ingestOpenStatesSignals',
    args: {},
    intervalMs: 6 * 60 * 60 * 1000,
    priority: 'high',
  },
  {
    name: 'propublica',
    module: '../adapters/proPublicaAdapter.js',
    fn: 'runIngestProPublica',
    args: {},
    intervalMs: 6 * 60 * 60 * 1000,
    priority: 'high',
  },
  {
    name: 'cfpb_complaints',
    module: '../adapters/cfpbComplaintsAdapter.js',
    fn: 'ingestCfpbSignals',
    args: { state: STATE },
    intervalMs: 12 * 60 * 60 * 1000,
    priority: 'medium',
  },
  {
    name: 'regulations_gov',
    module: '../adapters/regulationsGovAdapter.js',
    fn: 'ingestRegulationsSignals',
    args: {},
    intervalMs: 12 * 60 * 60 * 1000,
    priority: 'medium',
  },
  {
    name: 'grants_gov',
    module: '../adapters/grantsGovAdapter.js',
    fn: 'ingestGrantsGovSignals',
    args: {},
    intervalMs: 12 * 60 * 60 * 1000,
    priority: 'medium',
  },
  {
    name: 'osha_inspections',
    module: '../adapters/oshaInspectionsAdapter.js',
    fn: 'ingestOshaSignals',
    args: { state: STATE },
    intervalMs: 12 * 60 * 60 * 1000,
    priority: 'medium',
  },
  {
    name: 'epa_echo',
    module: '../adapters/epaEchoAdapter.js',
    fn: 'ingestEpaSignals',
    args: { state: STATE },
    intervalMs: 12 * 60 * 60 * 1000,
    priority: 'medium',
  },
  {
    name: 'census_acs',
    module: '../adapters/censusAcsAdapter.js',
    fn: 'ingestCensusSignals',
    args: { state: STATE_FIPS },
    intervalMs: 24 * 60 * 60 * 1000,
    priority: 'low',
  },
  {
    name: 'usda_snap',
    module: '../adapters/usdaSnapAdapter.js',
    fn: 'ingestSnapSignals',
    args: { state: STATE },
    intervalMs: 24 * 60 * 60 * 1000,
    priority: 'low',
  },
  {
    name: 'hud_fmr',
    module: '../adapters/hudHousingAdapter.js',
    fn: 'ingestHudSignals',
    args: { stateCode: STATE_FIPS },
    intervalMs: 24 * 60 * 60 * 1000,
    priority: 'low',
  },
  {
    name: 'bls_employment',
    module: '../adapters/blsEmploymentAdapter.js',
    fn: 'ingestBlsSignals',
    args: {},
    intervalMs: 24 * 60 * 60 * 1000,
    priority: 'low',
  },
  {
    name: 'fec_campaign_finance',
    module: '../adapters/fecCampaignFinanceAdapter.js',
    fn: 'ingestFecSignals',
    args: { state: STATE },
    intervalMs: 24 * 60 * 60 * 1000,
    priority: 'low',
  },
  {
    name: 'sec_edgar',
    module: '../adapters/secEdgarAdapter.js',
    fn: 'ingestSecSignals',
    args: {},
    intervalMs: 24 * 60 * 60 * 1000,
    priority: 'low',
  },
  {
    name: 'usa_spending',
    module: '../adapters/usaSpendingAdapter.js',
    fn: 'ingestUsaSpendingSignals',
    args: { state: STATE },
    intervalMs: 24 * 60 * 60 * 1000,
    priority: 'low',
  },
  {
    name: 'irs_exempt_orgs',
    module: '../adapters/irsExemptOrgAdapter.js',
    fn: 'ingestIrsExemptSignals',
    args: { state: STATE },
    intervalMs: 24 * 60 * 60 * 1000,
    priority: 'low',
  },
  {
    name: 'opensecrets_lda',
    module: '../adapters/openSecretsAdapter.js',
    fn: 'ingestOpenSecretsSignals',
    args: {},
    intervalMs: 24 * 60 * 60 * 1000,
    priority: 'low',
  },
  {
    name: 'fara_foreign_agents',
    module: '../adapters/faraForeignAgentsAdapter.js',
    fn: 'ingestFaraSignals',
    args: {},
    intervalMs: 24 * 60 * 60 * 1000,
    priority: 'low',
  },
];

const adapterState = new Map();
let schedulerRunning = false;
let schedulerStartedAt = null;
let domain3State = {
  running: false,
  lastRun: null,
  lastResult: null,
  errors: 0,
};

async function runAdapter(adapter) {
  const start = Date.now();
  const state = adapterState.get(adapter.name) || {
    running: false,
    lastRun: null,
    lastResult: null,
    errors: 0,
  };

  if (state.running) {
    console.log(`[scheduler] [SKIP] ${adapter.name} — already running`);
    return { status: 'already_running' };
  }

  state.running = true;
  adapterState.set(adapter.name, state);

  try {
    const mod = await import(adapter.module);
    const fn = mod[adapter.fn];
    if (!fn) throw new Error(`Function ${adapter.fn} not found in ${adapter.module}`);

    const result = await fn(adapter.args || {});
    const elapsed = Date.now() - start;
    const inserted = Number(result?.ingested_count ?? result?.events_inserted ?? result?.count ?? 0);
    const replayed = Number(result?.replayed_count ?? result?.replays_suppressed ?? 0);
    const outcome = inserted > 0
      ? 'productive'
      : replayed > 0
        ? 'completed_no_change'
        : 'unexpectedly_zero';

    console.log(
      `[scheduler] [OK]   ${adapter.name} — inserted=${inserted} replayed=${replayed} outcome=${outcome} (${elapsed}ms)`,
    );

    state.lastRun = new Date().toISOString();
    state.lastResult = { inserted, replayed, elapsed, status: 'ok', outcome };
    state.errors = 0;
    return state.lastResult;
  } catch (err) {
    const elapsed = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[scheduler] [FAIL] ${adapter.name} — ${message.slice(0, 120)} (${elapsed}ms)`);

    state.lastRun = new Date().toISOString();
    state.lastResult = { status: 'error', error: message.slice(0, 500), elapsed, outcome: 'failed' };
    state.errors = (state.errors || 0) + 1;
    return state.lastResult;
  } finally {
    state.running = false;
    adapterState.set(adapter.name, state);
  }
}

async function runDomain3Bridge() {
  if (domain3State.running) {
    return { status: 'already_running' };
  }
  domain3State.running = true;
  const start = Date.now();
  try {
    const result = await runLiveDataSignalBridge();
    domain3State.lastRun = new Date().toISOString();
    domain3State.lastResult = {
      status: 'ok',
      elapsed: Date.now() - start,
      detection_run_id: result?.bridge?.detection_run_id ?? result?.detection?.run_id ?? null,
      candidates_seen: Number(result?.bridge?.candidates_seen ?? 0),
      bridged: Number(result?.bridge?.bridged ?? 0),
      idempotent: Number(result?.bridge?.idempotent ?? 0),
      failed: Number(result?.bridge?.failed ?? 0),
    };
    domain3State.errors = 0;
    console.log('[scheduler] [domain3] Run complete:', domain3State.lastResult);
    return domain3State.lastResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    domain3State.lastRun = new Date().toISOString();
    domain3State.lastResult = {
      status: 'error',
      error: message.slice(0, 500),
      elapsed: Date.now() - start,
    };
    domain3State.errors += 1;
    console.error('[scheduler] [domain3] Failed:', message);
    return domain3State.lastResult;
  } finally {
    domain3State.running = false;
  }
}

function scheduleAdapter(adapter) {
  const initialDelay = adapter.priority === 'high' ? 30_000
    : adapter.priority === 'medium' ? 2 * 60_000
    : 5 * 60_000;

  setTimeout(async () => {
    await runAdapter(adapter);
    setInterval(() => runAdapter(adapter), adapter.intervalMs);
  }, initialDelay);

  console.log(
    `[scheduler] Scheduled ${adapter.name} (${adapter.priority}) — first run in ${Math.round(initialDelay / 1000)}s, then every ${Math.round(adapter.intervalMs / 3600_000)}h`,
  );
}

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

  for (const adapter of ADAPTER_REGISTRY) scheduleAdapter(adapter);
  console.log('\n[scheduler] All source adapters scheduled.\n');

  const DOMAIN3_INTERVAL_MS = 6 * 60 * 60 * 1000;
  const DOMAIN3_INITIAL_DELAY_MS = 3 * 60 * 1000;
  setTimeout(async () => {
    await runDomain3Bridge();
    setInterval(() => runDomain3Bridge(), DOMAIN3_INTERVAL_MS);
  }, DOMAIN3_INITIAL_DELAY_MS);

  console.log(
    `[scheduler] Domain 3 detection/bridge scheduled — first run in ${DOMAIN3_INITIAL_DELAY_MS / 60000}min, then every ${DOMAIN3_INTERVAL_MS / 3600000}h.`,
  );
  console.log('[scheduler] Legacy civic-map bridge drain remains quarantined.\n');
}

export async function triggerLiveDataSignalBridgeNow() {
  console.log('[scheduler] [domain3] Manual trigger...');
  return runDomain3Bridge();
}

export async function triggerBridgeDrainNow() {
  return {
    processed: 0,
    bridged: 0,
    errors: 0,
    quarantined: true,
    reason: 'legacy_mixed_signal_transport_disabled_use_domain3_bridge',
  };
}

export function getSchedulerStatus() {
  return {
    running: schedulerRunning,
    started_at: schedulerStartedAt,
    state: STATE,
    adapters: ADAPTER_REGISTRY.map((adapter) => ({
      name: adapter.name,
      priority: adapter.priority,
      interval_hours: Math.round(adapter.intervalMs / 3600_000),
      ...adapterState.get(adapter.name),
    })),
    live_data_signal_bridge: domain3State,
    legacy_bridge: {
      scheduled: false,
      quarantined: true,
      reason: 'legacy_mixed_signal_transport_disabled',
    },
  };
}

export function triggerAdapterNow(adapterName) {
  const adapter = ADAPTER_REGISTRY.find((candidate) => candidate.name === adapterName);
  if (!adapter) throw new Error(`Unknown adapter: ${adapterName}`);
  return runAdapter(adapter);
}

export { ADAPTER_REGISTRY };