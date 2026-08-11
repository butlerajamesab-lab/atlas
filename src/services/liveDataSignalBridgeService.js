import { createClient } from '@supabase/supabase-js';
import { executeDomain3PopulationDetection } from './domain3PopulationDetectorService.js';

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
    candidateLimit: Number.parseInt(env.ATLAS_DOMAIN3_CANDIDATE_LIMIT || '100', 10),
    observationLimit: Number.parseInt(env.ATLAS_DOMAIN3_OBSERVATION_LIMIT || '20000', 10),
  };
}

async function bridgeRun(atlasClient, runId, candidateLimit) {
  const { data: bridge, error: bridgeError } = await atlasClient.rpc(
    'bridge_live_data_signal_candidates_v1',
    {
      p_run_id: runId,
      p_limit: candidateLimit,
    },
  );
  if (bridgeError) {
    throw new Error(`Atlas Domain 3 transport failed for run ${runId}: ${bridgeError.message}`);
  }
  if (!bridge || typeof bridge !== 'object') {
    throw new Error(`Atlas Domain 3 transport returned no receipt for run ${runId}`);
  }
  return bridge;
}

export async function executeLiveDataSignalCycle({
  atlasClient,
  minUniqueRecords = 10,
  minUnresolvedRate = 0.5,
  candidateLimit = 100,
  observationLimit = 20000,
  populationDetector = executeDomain3PopulationDetection,
}) {
  const boundedMinUniqueRecords = Math.max(1, Number(minUniqueRecords) || 10);
  const boundedMinUnresolvedRate = Math.min(1, Math.max(0, Number(minUnresolvedRate) || 0));
  const boundedCandidateLimit = Math.min(1000, Math.max(1, Number(candidateLimit) || 100));
  const boundedObservationLimit = Math.min(100000, Math.max(1, Number(observationLimit) || 20000));

  // Preserve the existing ProPublica unresolved-metadata rule as a narrow seed detector.
  // It is no longer treated as the complete Domain 3 detector population.
  const { data: seedDetection, error: detectionError } = await atlasClient.rpc(
    'detect_propublica_unresolved_metadata_v1',
    {
      p_min_unique_records: boundedMinUniqueRecords,
      p_min_unresolved_rate: boundedMinUnresolvedRate,
      p_limit: boundedCandidateLimit,
    },
  );
  if (detectionError) {
    throw new Error(`Atlas Domain 3 seed detection failed: ${detectionError.message}`);
  }
  if (!seedDetection || seedDetection.status === 'failed' || !seedDetection.run_id) {
    throw new Error(
      `Atlas Domain 3 seed detection returned no completed run receipt: ${JSON.stringify(seedDetection ?? null)}`,
    );
  }

  const populationDetection = await populationDetector({
    atlasClient,
    observationLimit: boundedObservationLimit,
    candidateLimit: boundedCandidateLimit,
  });

  const runIds = [
    seedDetection.run_id,
    ...(populationDetection?.runs || []).map((run) => run.run_id),
  ];
  const bridgeReceipts = [];
  for (const runId of runIds) {
    bridgeReceipts.push(await bridgeRun(atlasClient, runId, boundedCandidateLimit));
  }

  const bridge = bridgeReceipts.reduce((summary, receipt) => ({
    detection_run_id: summary.detection_run_id || receipt.detection_run_id || null,
    candidates_seen: summary.candidates_seen + Number(receipt.candidates_seen || 0),
    bridged: summary.bridged + Number(receipt.bridged || 0),
    idempotent: summary.idempotent + Number(receipt.idempotent || 0),
    failed: summary.failed + Number(receipt.failed || 0),
    receipts: [...summary.receipts, receipt],
  }), {
    detection_run_id: seedDetection.run_id,
    candidates_seen: 0,
    bridged: 0,
    idempotent: 0,
    failed: 0,
    receipts: [],
  });

  return {
    detection: seedDetection,
    population_detection: populationDetection,
    bridge,
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
    observationLimit: config.observationLimit,
  });
}
