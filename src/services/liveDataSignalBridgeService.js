import { createClient } from '@supabase/supabase-js';

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
  };
}

export async function executeLiveDataSignalCycle({
  atlasClient,
  minUniqueRecords = 10,
  minUnresolvedRate = 0.5,
  candidateLimit = 100,
}) {
  const boundedMinUniqueRecords = Math.max(1, Number(minUniqueRecords) || 10);
  const boundedMinUnresolvedRate = Math.min(
    1,
    Math.max(0, Number(minUnresolvedRate) || 0),
  );
  const boundedCandidateLimit = Math.min(
    1000,
    Math.max(1, Number(candidateLimit) || 100),
  );

  const { data: detection, error: detectionError } = await atlasClient.rpc(
    'detect_propublica_unresolved_metadata_v1',
    {
      p_min_unique_records: boundedMinUniqueRecords,
      p_min_unresolved_rate: boundedMinUnresolvedRate,
      p_limit: boundedCandidateLimit,
    },
  );
  if (detectionError) {
    throw new Error(`Atlas Domain 3 detection failed: ${detectionError.message}`);
  }
  if (!detection || detection.status === 'failed' || !detection.run_id) {
    throw new Error(
      `Atlas Domain 3 detection returned no completed run receipt: ${JSON.stringify(detection ?? null)}`,
    );
  }

  const { data: bridge, error: bridgeError } = await atlasClient.rpc(
    'bridge_live_data_signal_candidates_v1',
    {
      p_run_id: detection.run_id,
      p_limit: boundedCandidateLimit,
    },
  );
  if (bridgeError) {
    throw new Error(`Atlas Domain 3 transport failed: ${bridgeError.message}`);
  }
  if (!bridge || typeof bridge !== 'object') {
    throw new Error('Atlas Domain 3 transport returned no receipt');
  }

  return {
    detection,
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
  });
}
