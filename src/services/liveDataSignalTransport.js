/**
 * Atlas Domain 3 Live Data Signal Transport (JS-side)
 *
 * Replaces the database-side bridge_live_data_signal_candidates_v1 function
 * that could not be applied due to Management API authorization issues.
 *
 * This implementation:
 * 1. Reads candidates from the detection run (via enqueue RPC)
 * 2. Sends each to Lighthouse register_live_data_signal_receipt_v1
 * 3. Records bridge status via mark_live_data_signal_candidate_bridge_v1
 * 4. Produces an identical receipt structure to the SQL transport
 *
 * The SQL migration remains in the repo for future application when
 * Management API access is restored.
 */

import { createClient } from '@supabase/supabase-js';

const TRANSPORT_VERSION = 'atlas_js_receipt_v1';

function createServiceClient(url, key) {
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Resolve transport configuration from environment.
 * Requires both Atlas and Lighthouse credentials since the transport
 * is now JS-side rather than database-side.
 */
export function resolveTransportConfiguration(env = process.env) {
  const atlasUrl = env.SUPABASE_URL;
  const atlasKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const lighthouseUrl = env.LIGHTHOUSE_SUPABASE_URL;
  const lighthouseKey = env.LIGHTHOUSE_SERVICE_ROLE_KEY || env.LIGHTHOUSE_SERVICE_KEY;

  const missing = [
    ['SUPABASE_URL', atlasUrl],
    ['SUPABASE_SERVICE_ROLE_KEY', atlasKey],
    ['LIGHTHOUSE_SUPABASE_URL', lighthouseUrl],
    ['LIGHTHOUSE_SERVICE_ROLE_KEY or LIGHTHOUSE_SERVICE_KEY', lighthouseKey],
  ].filter(([, v]) => !v).map(([n]) => n);

  if (missing.length > 0) {
    throw new Error(`Domain 3 transport not configured: missing ${missing.join(', ')}`);
  }

  return { atlasUrl, atlasKey, lighthouseUrl, lighthouseKey };
}

/**
 * Bridge a single candidate to Lighthouse.
 * Returns { status, lighthouse_record_id, error }.
 */
async function bridgeCandidate(candidate, lighthouseClient) {
  const record = {
    signal_type: candidate.signal_type,
    title: candidate.title,
    description: candidate.description,
    primary_stream_id: candidate.primary_stream_id,
    source_event_refs: candidate.source_event_refs,
    entity_ids: candidate.entity_ids,
    entity_resolution_status: candidate.entity_resolution_status,
    jurisdiction_id: candidate.jurisdiction_id,
    severity: candidate.severity,
    confidence_score: candidate.confidence_score,
    verification_state: candidate.verification_state,
    supporting_statistics: candidate.supporting_statistics,
    evidence_refs: candidate.evidence_refs,
    detection_rule_id: candidate.rule_id || candidate.detection_rule_id,
    detection_rule_version: candidate.rule_version || candidate.detection_rule_version,
    engine_id: candidate.engine_id,
    engine_version: candidate.engine_version,
    source_freshness_at: candidate.source_freshness_at,
    detected_at: candidate.detected_at,
    governance_status: 'observation_candidate',
  };

  const { data, error } = await lighthouseClient.rpc(
    'register_live_data_signal_receipt_v1',
    { p_record: record },
  );

  if (error) {
    throw new Error(`Lighthouse registration failed: ${error.message}`);
  }

  // Parse the response to extract live_data_signal_id
  let lighthouseRecordId = null;

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    lighthouseRecordId = data.live_data_signal_id || data.register_live_data_signal_receipt_v1 || null;
  } else if (Array.isArray(data) && data.length > 0) {
    lighthouseRecordId = data[0]?.live_data_signal_id || data[0]?.register_live_data_signal_receipt_v1 || null;
  } else if (typeof data === 'string') {
    // PostgREST sometimes wraps scalar returns
    try {
      const parsed = JSON.parse(data);
      lighthouseRecordId = parsed?.live_data_signal_id || null;
    } catch {
      // Try as raw UUID
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data)) {
        lighthouseRecordId = data;
      }
    }
  }

  if (!lighthouseRecordId) {
    throw new Error(`Lighthouse receipt contains no live_data_signal_id: ${JSON.stringify(data)?.slice(0, 500)}`);
  }

  return { status: 'bridged', lighthouse_record_id: lighthouseRecordId };
}

/**
 * Execute the complete Domain 3 transport cycle.
 * Detection → Enqueue → Bridge → Mark → Receipt.
 */
export async function executeDomain3Transport({
  atlasClient,
  lighthouseClient,
  minUniqueRecords = 10,
  minUnresolvedRate = 0.5,
  candidateLimit = 100,
}) {
  // Step 1: Run detection
  const { data: detection, error: detectionError } = await atlasClient.rpc(
    'detect_propublica_unresolved_metadata_v1',
    {
      p_min_unique_records: Math.max(1, Number(minUniqueRecords) || 10),
      p_min_unresolved_rate: Math.min(1, Math.max(0, Number(minUnresolvedRate) || 0.5)),
      p_limit: Math.min(1000, Math.max(1, Number(candidateLimit) || 100)),
    },
  );

  if (detectionError) {
    throw new Error(`Domain 3 detection failed: ${detectionError.message}`);
  }
  if (!detection || detection.status === 'failed' || !detection.run_id) {
    throw new Error(`Domain 3 detection returned no completed run: ${JSON.stringify(detection)?.slice(0, 500)}`);
  }

  const runId = detection.run_id;
  const candidates = detection.candidates || [];

  // Step 2: Bridge each candidate to Lighthouse
  let bridged = 0;
  let idempotent = 0;
  let failed = 0;
  const receipts = [];

  for (const candidate of candidates) {
    const candidateId = candidate.candidate_id;
    const candidateHash = candidate.candidate_hash;

    // Skip already-bridged candidates (idempotent)
    if (candidate.lighthouse_status === 'bridged' && candidate.lighthouse_record_id) {
      idempotent++;
      receipts.push({
        candidate_id: candidateId,
        candidate_hash: candidateHash,
        status: 'idempotent',
        lighthouse_record_id: candidate.lighthouse_record_id,
      });
      continue;
    }

    try {
      const result = await bridgeCandidate(
        candidate.lighthouse_record || candidate,
        lighthouseClient,
      );

      // Step 3: Mark candidate as bridged in Atlas
      const { error: markError } = await atlasClient.rpc(
        'mark_live_data_signal_candidate_bridge_v1',
        {
          p_candidate_id: candidateId,
          p_status: 'bridged',
          p_lighthouse_record_id: result.lighthouse_record_id,
          p_error_message: null,
        },
      );

      if (markError) {
        console.error(`[transport] Failed to mark candidate ${candidateId}: ${markError.message}`);
      }

      bridged++;
      receipts.push({
        candidate_id: candidateId,
        candidate_hash: candidateHash,
        status: 'bridged',
        lighthouse_record_id: result.lighthouse_record_id,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      // Mark as failed in Atlas
      try {
        await atlasClient.rpc('mark_live_data_signal_candidate_bridge_v1', {
          p_candidate_id: candidateId,
          p_status: 'failed',
          p_lighthouse_record_id: null,
          p_error_message: message.slice(0, 2000),
        });
      } catch (markErr) {
        console.error(`[transport] Failed to mark failure for ${candidateId}: ${markErr.message}`);
      }

      failed++;
      receipts.push({
        candidate_id: candidateId,
        candidate_hash: candidateHash,
        status: 'failed',
        error: message.slice(0, 500),
      });
    }
  }

  return {
    run_id: runId,
    candidates_seen: candidates.length,
    bridged,
    idempotent,
    failed,
    transport: TRANSPORT_VERSION,
    target_project: 'lighthouse',
    completed_at: new Date().toISOString(),
    receipts,
    detection: {
      run_id: runId,
      status: detection.status,
      candidates_produced: detection.candidates_produced || candidates.length,
    },
  };
}

/**
 * Run the complete Domain 3 live data signal bridge.
 * This is the drop-in replacement for the previous bridge service.
 */
export async function runDomain3Transport(env = process.env) {
  const config = resolveTransportConfiguration(env);
  const atlasClient = createServiceClient(config.atlasUrl, config.atlasKey);
  const lighthouseClient = createServiceClient(config.lighthouseUrl, config.lighthouseKey);

  const minUniqueRecords = Number.parseInt(env.ATLAS_DOMAIN3_MIN_UNIQUE_RECORDS || '10', 10);
  const minUnresolvedRate = Number.parseFloat(env.ATLAS_DOMAIN3_MIN_UNRESOLVED_RATE || '0.5');
  const candidateLimit = Number.parseInt(env.ATLAS_DOMAIN3_CANDIDATE_LIMIT || '100', 10);

  return executeDomain3Transport({
    atlasClient,
    lighthouseClient,
    minUniqueRecords,
    minUnresolvedRate,
    candidateLimit,
  });
}

export { TRANSPORT_VERSION };
