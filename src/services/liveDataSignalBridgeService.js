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
  const lighthouseUrl = env.LIGHTHOUSE_SUPABASE_URL;
  const lighthouseKey = env.LIGHTHOUSE_SERVICE_ROLE_KEY || env.LIGHTHOUSE_SERVICE_KEY;

  const missing = [
    ['SUPABASE_URL', atlasUrl],
    ['SUPABASE_SERVICE_ROLE_KEY', atlasKey],
    ['LIGHTHOUSE_SUPABASE_URL', lighthouseUrl],
    ['LIGHTHOUSE_SERVICE_ROLE_KEY or LIGHTHOUSE_SERVICE_KEY', lighthouseKey],
  ].filter(([, value]) => !value).map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(`Atlas Domain 3 bridge is not configured: missing ${missing.join(', ')}`);
  }
  if (atlasUrl === lighthouseUrl) {
    throw new Error('Atlas Domain 3 bridge refused identical source and target URLs');
  }

  return {
    atlasUrl,
    atlasKey,
    lighthouseUrl,
    lighthouseKey,
    minUniqueRecords: Number.parseInt(env.ATLAS_DOMAIN3_MIN_UNIQUE_RECORDS || '10', 10),
    minUnresolvedRate: Number.parseFloat(env.ATLAS_DOMAIN3_MIN_UNRESOLVED_RATE || '0.5'),
    candidateLimit: Number.parseInt(env.ATLAS_DOMAIN3_CANDIDATE_LIMIT || '100', 10),
  };
}

function requireCandidate(candidate) {
  const record = candidate?.lighthouse_record;
  const required = [
    'signal_type',
    'title',
    'description',
    'primary_stream_id',
    'source_event_refs',
    'entity_ids',
    'entity_resolution_status',
    'jurisdiction_id',
    'severity',
    'confidence_score',
    'verification_state',
    'supporting_statistics',
    'evidence_refs',
    'detection_rule_id',
    'detection_rule_version',
    'engine_id',
    'engine_version',
    'source_freshness_at',
    'detected_at',
  ];

  if (!candidate?.candidate_id) throw new Error('Atlas candidate is missing candidate_id');
  if (!record || typeof record !== 'object') throw new Error('Atlas candidate is missing lighthouse_record');
  for (const field of required) {
    if (record[field] === undefined || record[field] === null || record[field] === '') {
      throw new Error(`Atlas candidate is missing required field: ${field}`);
    }
  }
  if (!Array.isArray(record.source_event_refs) || record.source_event_refs.length === 0) {
    throw new Error('Atlas candidate requires source_event_refs');
  }
  if (!record.supporting_statistics || Object.keys(record.supporting_statistics).length === 0) {
    throw new Error('Atlas candidate requires supporting_statistics');
  }
  const confidence = Number(record.confidence_score);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error('Atlas candidate confidence_score must be between 0 and 1');
  }
  return record;
}

async function markCandidate(atlasClient, candidateId, status, lighthouseRecordId = null, errorMessage = null) {
  const { error } = await atlasClient.rpc('mark_live_data_signal_candidate_bridge_v1', {
    p_candidate_id: candidateId,
    p_status: status,
    p_lighthouse_record_id: lighthouseRecordId,
    p_error_message: errorMessage,
  });
  if (error) throw new Error(`Unable to record Atlas candidate bridge status: ${error.message}`);
}

export async function bridgeLiveDataSignalCandidates({ atlasClient, lighthouseClient, detection }) {
  const candidates = Array.isArray(detection?.candidates) ? detection.candidates : [];
  let bridged = 0;
  let idempotent = 0;
  let failed = 0;
  const receipts = [];

  for (const candidate of candidates) {
    try {
      const record = requireCandidate(candidate);
      const { data, error } = await lighthouseClient.rpc('register_live_data_signal_v1', {
        p_record: record,
      });
      if (error) throw new Error(error.message);
      const lighthouseRecordId = typeof data === 'string' ? data : String(data ?? '');
      if (!lighthouseRecordId) throw new Error('Lighthouse returned no live_data_signal_id');

      const wasAlreadyBridged = candidate.lighthouse_status === 'bridged'
        && candidate.lighthouse_record_id === lighthouseRecordId;
      await markCandidate(atlasClient, candidate.candidate_id, 'bridged', lighthouseRecordId, null);
      if (wasAlreadyBridged) idempotent += 1;
      else bridged += 1;
      receipts.push({
        candidate_id: candidate.candidate_id,
        lighthouse_record_id: lighthouseRecordId,
        status: wasAlreadyBridged ? 'idempotent' : 'bridged',
      });
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      try {
        if (candidate?.candidate_id) {
          await markCandidate(atlasClient, candidate.candidate_id, 'failed', null, message);
        }
      } catch (markError) {
        receipts.push({
          candidate_id: candidate?.candidate_id ?? null,
          status: 'failed_unrecorded',
          error: `${message}; status receipt failed: ${markError instanceof Error ? markError.message : String(markError)}`,
        });
        continue;
      }
      receipts.push({
        candidate_id: candidate?.candidate_id ?? null,
        status: 'failed',
        error: message,
      });
    }
  }

  return {
    detection_run_id: detection?.run_id ?? null,
    candidates_seen: candidates.length,
    bridged,
    idempotent,
    failed,
    receipts,
  };
}

export async function runLiveDataSignalBridge(env = process.env) {
  const config = resolveLiveDataSignalBridgeConfiguration(env);
  const atlasClient = createServiceClient(config.atlasUrl, config.atlasKey);
  const lighthouseClient = createServiceClient(config.lighthouseUrl, config.lighthouseKey);

  const { data: detection, error } = await atlasClient.rpc(
    'detect_propublica_unresolved_metadata_v1',
    {
      p_min_unique_records: Math.max(1, config.minUniqueRecords),
      p_min_unresolved_rate: Math.min(1, Math.max(0, config.minUnresolvedRate)),
      p_limit: Math.min(1000, Math.max(1, config.candidateLimit)),
    },
  );
  if (error) throw new Error(`Atlas Domain 3 detection failed: ${error.message}`);

  const bridge = await bridgeLiveDataSignalCandidates({
    atlasClient,
    lighthouseClient,
    detection,
  });

  return {
    detection,
    bridge,
    completed_at: new Date().toISOString(),
  };
}