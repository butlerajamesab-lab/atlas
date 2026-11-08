import { createClient } from '@supabase/supabase-js';
import { executeDomain3FullReplay } from './domain3PopulationReplayService.js';

function createServiceClient(url, key) {
  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export function resolveLiveDataSignalBridgeConfiguration(env = process.env) {
  const atlasUrl = env.SUPABASE_URL;
  const atlasKey = env.SUPABASE_SERVICE_ROLE_KEY;

  const missing = [
    ['SUPABASE_URL', atlasUrl],
    ['SUPABASE_SERVICE_ROLE_KEY', atlasKey],
  ].filter(([, value]) => !value).map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(`Atlas Domain 3 bridge is not configured: missing ${missing.join(', ')}`);
  }

  return {
    atlasUrl,
    atlasKey,
    minUniqueRecords: Number.parseInt(env.ATLAS_DOMAIN3_MIN_UNIQUE_RECORDS || '10', 10),
    minUnresolvedRate: Number.parseFloat(env.ATLAS_DOMAIN3_MIN_UNRESOLVED_RATE || '0.5'),
    // ATLAS_DOMAIN3_CANDIDATE_LIMIT is now a chunk size (persist + bridge
    // drain batches), not a truncation: derivation covers the full stored
    // set and every derived candidate is persisted and bridged.
    candidateLimit: Number.parseInt(env.ATLAS_DOMAIN3_CANDIDATE_LIMIT || '250', 10),
  };
}

const MAX_BRIDGE_CALLS_PER_RUN = 200;

async function bridgeRunOnce(atlasClient, runId, candidateLimit) {
  const { data: bridge, error: bridgeError } = await atlasClient.rpc(
    'bridge_live_data_signal_candidates_v1',
    { p_run_id: runId, p_limit: candidateLimit },
  );
  if (bridgeError) throw new Error(`Atlas Domain 3 transport failed for run ${runId}: ${bridgeError.message}`);
  if (!bridge || typeof bridge !== 'object') {
    throw new Error(`Atlas Domain 3 transport returned no receipt for run ${runId}`);
  }
  return bridge;
}

// The bridge RPC processes at most p_limit not-yet-bridged candidates of a
// run per call; drain by repeating until a call sees fewer than the limit.
async function bridgeRun(atlasClient, runId, candidateLimit) {
  const aggregate = {
    run_id: runId,
    calls: 0,
    candidates_seen: 0,
    bridged: 0,
    idempotent: 0,
    failed: 0,
    drained_fully: false,
    receipts_sample: [],
  };
  for (let call = 0; call < MAX_BRIDGE_CALLS_PER_RUN; call += 1) {
    const receipt = await bridgeRunOnce(atlasClient, runId, candidateLimit);
    aggregate.calls += 1;
    aggregate.candidates_seen += Number(receipt.candidates_seen || 0);
    aggregate.bridged += Number(receipt.bridged || 0);
    aggregate.idempotent += Number(receipt.idempotent || 0);
    aggregate.failed += Number(receipt.failed || 0);
    if (call === 0 && Array.isArray(receipt.receipts)) {
      aggregate.receipts_sample = receipt.receipts.slice(0, 3);
    }
    if (Number(receipt.candidates_seen || 0) < candidateLimit) {
      aggregate.drained_fully = true;
      break;
    }
  }
  return aggregate;
}

async function bridgeRetirementsOnce(atlasClient, runId, candidateLimit) {
  const { data: bridge, error: bridgeError } = await atlasClient.rpc(
    'bridge_live_data_signal_retirements_v1',
    { p_run_id: runId, p_limit: candidateLimit },
  );
  if (bridgeError) throw new Error(`Atlas Domain 3 retirement transport failed for run ${runId}: ${bridgeError.message}`);
  if (!bridge || typeof bridge !== 'object') {
    throw new Error(`Atlas Domain 3 retirement transport returned no receipt for run ${runId}`);
  }
  return bridge;
}

async function bridgeRetirements(atlasClient, runId, candidateLimit) {
  const aggregate = {
    run_id: runId,
    calls: 0,
    retirements_seen: 0,
    bridged: 0,
    idempotent: 0,
    failed: 0,
    drained_fully: false,
    receipts_sample: [],
  };
  for (let call = 0; call < MAX_BRIDGE_CALLS_PER_RUN; call += 1) {
    const receipt = await bridgeRetirementsOnce(atlasClient, runId, candidateLimit);
    aggregate.calls += 1;
    aggregate.retirements_seen += Number(receipt.retirements_seen || 0);
    aggregate.bridged += Number(receipt.bridged || 0);
    aggregate.idempotent += Number(receipt.idempotent || 0);
    aggregate.failed += Number(receipt.failed || 0);
    if (call === 0 && Array.isArray(receipt.receipts)) {
      aggregate.receipts_sample = receipt.receipts.slice(0, 3);
    }
    if (Number(receipt.retirements_seen || 0) < candidateLimit) {
      aggregate.drained_fully = true;
      break;
    }
  }
  return aggregate;
}

async function runSeedDetector({ atlasClient, minUniqueRecords, minUnresolvedRate, candidateLimit }) {
  try {
    const { data, error } = await atlasClient.rpc(
      'detect_propublica_unresolved_metadata_v1',
      {
        p_min_unique_records: minUniqueRecords,
        p_min_unresolved_rate: minUnresolvedRate,
        p_limit: candidateLimit,
      },
    );
    if (error) throw new Error(error.message);
    if (!data || data.status === 'failed' || !data.run_id) {
      throw new Error(`no completed run receipt: ${JSON.stringify(data ?? null)}`);
    }
    return { detection: data, error: null };
  } catch (error) {
    return {
      detection: null,
      error: `Atlas Domain 3 ProPublica seed detector unavailable: ${error?.message || error}`,
    };
  }
}

export async function executeLiveDataSignalCycle({
  atlasClient,
  minUniqueRecords = 10,
  minUnresolvedRate = 0.5,
  candidateLimit = 250,
  populationDetector = executeDomain3FullReplay,
}) {
  const boundedMinUniqueRecords = Math.max(1, Number(minUniqueRecords) || 10);
  const boundedMinUnresolvedRate = Math.min(1, Math.max(0, Number(minUnresolvedRate) || 0));
  const boundedCandidateLimit = Math.min(1000, Math.max(1, Number(candidateLimit) || 250));

  const seed = await runSeedDetector({
    atlasClient,
    minUniqueRecords: boundedMinUniqueRecords,
    minUnresolvedRate: boundedMinUnresolvedRate,
    candidateLimit: boundedCandidateLimit,
  });

  const populationDetection = await populationDetector({
    atlasClient,
    candidateChunkSize: boundedCandidateLimit,
  });

  const populationSkipped = populationDetection?.status === 'skipped_no_change';
  const runIds = [
    ...(seed.detection?.run_id ? [seed.detection.run_id] : []),
    ...(populationSkipped
      ? (populationDetection?.last_run_ids || [])
      : (populationDetection?.runs || []).map((run) => run.run_id).filter(Boolean)),
  ];
  const bridgeReceipts = [];
  const bridgeErrors = [];
  const retirementBridgeReceipts = [];
  const retirementBridgeErrors = [];

  for (const runId of runIds) {
    try {
      bridgeReceipts.push(await bridgeRun(atlasClient, runId, boundedCandidateLimit));
    } catch (error) {
      bridgeErrors.push({ run_id: runId, error: String(error?.message || error).slice(0, 1000) });
    }
    try {
      retirementBridgeReceipts.push(await bridgeRetirements(atlasClient, runId, boundedCandidateLimit));
    } catch (error) {
      retirementBridgeErrors.push({ run_id: runId, error: String(error?.message || error).slice(0, 1000) });
    }
  }

  const bridge = bridgeReceipts.reduce((summary, receipt) => ({
    detection_run_id: summary.detection_run_id || receipt.detection_run_id || null,
    candidates_seen: summary.candidates_seen + Number(receipt.candidates_seen || 0),
    bridged: summary.bridged + Number(receipt.bridged || 0),
    idempotent: summary.idempotent + Number(receipt.idempotent || 0),
    failed: summary.failed + Number(receipt.failed || 0),
    receipts: [...summary.receipts, receipt],
  }), {
    detection_run_id: seed.detection?.run_id || populationDetection?.runs?.[0]?.run_id || null,
    candidates_seen: 0,
    bridged: 0,
    idempotent: 0,
    failed: bridgeErrors.length,
    receipts: [],
  });
  bridge.errors = bridgeErrors;

  const retirementBridge = retirementBridgeReceipts.reduce((summary, receipt) => ({
    retirements_seen: summary.retirements_seen + Number(receipt.retirements_seen || 0),
    bridged: summary.bridged + Number(receipt.bridged || 0),
    idempotent: summary.idempotent + Number(receipt.idempotent || 0),
    failed: summary.failed + Number(receipt.failed || 0),
    receipts: [...summary.receipts, receipt],
  }), {
    retirements_seen: 0,
    bridged: 0,
    idempotent: 0,
    failed: retirementBridgeErrors.length,
    receipts: [],
  });
  retirementBridge.errors = retirementBridgeErrors;

  const populationRuleErrors = Array.isArray(populationDetection?.rule_errors)
    ? populationDetection.rule_errors
    : [];
  const populationRuleWarnings = Array.isArray(populationDetection?.rule_warnings)
    ? populationDetection.rule_warnings
    : [];
  const partial = bridgeErrors.length > 0
    || retirementBridgeErrors.length > 0
    || retirementBridge.failed > 0
    || bridgeReceipts.some((receipt) => receipt.drained_fully === false)
    || retirementBridgeReceipts.some((receipt) => receipt.drained_fully === false)
    || Boolean(seed.error)
    || populationDetection?.status === 'partial'
    || populationRuleErrors.length > 0
    || populationRuleWarnings.length > 0;

  return {
    status: partial ? 'partial' : (populationSkipped ? 'skipped_no_change' : 'completed'),
    detection: seed.detection,
    seed_error: seed.error,
    population_detection: populationDetection,
    population_rule_errors: populationRuleErrors,
    population_rule_warnings: populationRuleWarnings,
    bridge,
    retirement_bridge: retirementBridge,
    completed_at: new Date().toISOString(),
  };
}

export async function runLiveDataSignalBridge(env = process.env) {
  const config = resolveLiveDataSignalBridgeConfiguration(env);
  const atlasClient = createServiceClient(config.atlasUrl, config.atlasKey);

  return executeLiveDataSignalCycle({
    atlasClient,
    minUniqueRecords: config.minUniqueRecords,
    minUnresolvedRate: config.minUnresolvedRate,
    candidateLimit: config.candidateLimit,
  });
}
