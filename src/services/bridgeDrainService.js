/**
 * Bridge Drain Service
 */

import { createClient } from '@supabase/supabase-js';
import { resolveCanonicalDomain } from '../lib/domainResolver.js';

const LIGHTHOUSE_URL = process.env.LIGHTHOUSE_SUPABASE_URL;
const LIGHTHOUSE_KEY = process.env.LIGHTHOUSE_SERVICE_KEY;
const lhUrl = LIGHTHOUSE_URL || process.env.SUPABASE_URL;
const lhKey = LIGHTHOUSE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
const BATCH_SIZE = 50;

function mapBridgeRowToLiveSignal(row) {
  const title = [
    row.signal_type?.replace(/_/g, ' '),
    row.jurisdiction_raw_value ? `(${row.jurisdiction_raw_value})` : null,
  ].filter(Boolean).join(' ');

  const domain = row.domain
    || row.evidence_payload?.domain
    || row.atlas_metadata_json?.domain
    || resolveCanonicalDomain(row.signal_type, row.source_system, row.evidence_payload || {});

  const detectedAtMs = row.detected_at
    ? new Date(row.detected_at).getTime()
    : Date.now();

  return {
    signalType: row.signal_type,
    datasetId: row.source_connector_id?.toString() || row.source_system || 'atlas_bridge',
    jurisdiction: row.jurisdiction_raw_value || row.jurisdiction_id || 'unknown',
    domain,
    title,
    explanation: row.evidence_payload?.explanation
      || row.atlas_metadata_json?.description
      || `${row.signal_type} signal from ${row.source_system}`,
    patternSummary: row.atlas_metadata_json?.pattern_summary
      || row.evidence_payload?.pattern_summary
      || null,
    supportingStatistics: row.evidence_payload?.statistics
      || row.atlas_metadata_json?.statistics
      || null,
    confidenceScore: row.confidence_score ?? 0.5,
    detectedAt: detectedAtMs,
    signalFingerprint: row.atlas_signal_dedup_key
      || `atlas-${row.atlas_signal_id}-${row.bridge_record_id}`,
    active: true,
    source_url_ls: row.source_url || null,
    source_timestamp_ls: detectedAtMs,
    bridge_source_id: row.bridge_record_id,
    bridge_hash: row.atlas_signal_dedup_key || `atlas-${row.atlas_signal_id}`,
    bridge_received_at: row.bridged_at || new Date().toISOString(),
    bridge_transport_version: row.bridge_version || 'atlas_lighthouse_bridge_v1',
  };
}

export async function runBridgeDrain() {
  return { processed: 0, promoted: 0, staged: 0, rejected: 0, errors: 0, skipped: 0 };
}
