/**
 * Atlas Domain 3 Live Data Signal Bridge Service
 *
 * Orchestrates detection and transport of live data signal candidates
 * from Atlas to Lighthouse. Uses the JS-side transport when the
 * database-side bridge function is unavailable.
 *
 * Transport strategy:
 * 1. Try database-side bridge_live_data_signal_candidates_v1 (preferred)
 * 2. Fall back to JS-side transport via liveDataSignalTransport.js
 *
 * The JS transport produces identical receipt structures and uses the
 * same mark_live_data_signal_candidate_bridge_v1 RPC for state recording.
 */

import { createClient } from '@supabase/supabase-js';
import { runDomain3Transport, resolveTransportConfiguration } from './liveDataSignalTransport.js';

/**
 * Parse the Lighthouse register_live_data_signal_receipt_v1 response.
 * Extracts the live_data_signal_id from various PostgREST response shapes.
 * This is the canonical receipt parser for Domain 3 bridge operations.
 */
export function parseRegistrationReceipt(data) {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return data.live_data_signal_id || data.register_live_data_signal_receipt_v1 || null;
  }
  if (Array.isArray(data) && data.length > 0) {
    return data[0]?.live_data_signal_id || data[0]?.register_live_data_signal_receipt_v1 || null;
  }
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      return parsed?.live_data_signal_id || null;
    } catch {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data)) {
        return data;
      }
    }
  }
  return null;
}

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

/**
 * Try the database-side transport first. If the function doesn't exist
 * in the schema cache, fall back to JS-side transport.
 */
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

  // Step 1: Run detection
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

  // Step 2: Try database-side bridge first
  const { data: bridge, error: bridgeError } = await atlasClient.rpc(
    'bridge_live_data_signal_candidates_v1',
    {
      p_run_id: detection.run_id,
      p_limit: boundedCandidateLimit,
    },
  );

  if (!bridgeError && bridge && typeof bridge === 'object') {
    // Database-side transport succeeded
    return {
      detection,
      bridge,
      transport_method: 'database_http',
      completed_at: new Date().toISOString(),
    };
  }

  // Step 3: Fall back to JS-side transport
  const isMissingFunction = bridgeError?.message?.includes('Could not find the function')
    || bridgeError?.message?.includes('schema cache')
    || bridgeError?.code === 'PGRST202';

  if (!isMissingFunction) {
    // Real error, not a missing function — throw
    throw new Error(`Atlas Domain 3 transport failed: ${bridgeError.message}`);
  }

  console.log('[bridge] Database transport unavailable, using JS-side transport');

  // JS-side transport uses the detection result directly
  const jsResult = await runDomain3Transport();

  return {
    detection,
    bridge: jsResult,
    transport_method: 'js_receipt',
    completed_at: new Date().toISOString(),
  };
}

export async function runLiveDataSignalBridge(env = process.env) {
  // Check if JS transport credentials are available
  let hasJsTransportCredentials = false;
  try {
    resolveTransportConfiguration(env);
    hasJsTransportCredentials = true;
  } catch {
    // JS transport not configured — will try database-side only
  }

  const config = resolveLiveDataSignalBridgeConfiguration(env);
  const atlasClient = createServiceClient(config.atlasUrl, config.atlasKey);

  try {
    return await executeLiveDataSignalCycle({
      atlasClient,
      minUniqueRecords: config.minUniqueRecords,
      minUnresolvedRate: config.minUnresolvedRate,
      candidateLimit: config.candidateLimit,
    });
  } catch (err) {
    // If the error is about the missing bridge function and we have JS credentials,
    // try the direct JS transport
    const message = err instanceof Error ? err.message : String(err);
    const isMissingFunction = message.includes('Could not find the function')
      || message.includes('schema cache');

    if (isMissingFunction && hasJsTransportCredentials) {
      console.log('[bridge] Retrying with direct JS transport...');
      const result = await runDomain3Transport(env);
      return {
        detection: { run_id: result.run_id, status: result.detection?.status || 'completed' },
        bridge: result,
        transport_method: 'js_receipt_direct',
        completed_at: new Date().toISOString(),
      };
    }

    throw err;
  }
}
