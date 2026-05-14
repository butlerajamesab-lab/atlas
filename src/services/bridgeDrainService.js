/**
 * Bridge Drain Service
 *
 * Reads unprocessed signals from atlas_lighthouse_signal_bridge_v1 in Lighthouse,
 * writes each to live_signals, then calls evaluate_and_promote_signal() to run
 * the signal through the Sunam gate.
 *
 * Architecture:
 *   atlas_lighthouse_signal_bridge_v1 (Lighthouse)
 *     → live_signals (Lighthouse, transport provenance fields set)
 *     → evaluate_and_promote_signal() [Sunam gate]
 *     → detected_signals (gate-governed, gate_log_id enforced)
 *
 * Idempotency: bridge_hash (atlas_signal_dedup_key) is unique on live_signals.
 * Batch size: 50 signals per run to avoid timeout.
 * Run interval: wired into Atlas scheduler (every 15 minutes).
 */

import { createClient } from '@supabase/supabase-js';

const LIGHTHOUSE_URL = process.env.LIGHTHOUSE_SUPABASE_URL;
const LIGHTHOUSE_KEY = process.env.LIGHTHOUSE_SERVICE_KEY;

// Fallback: try SUPABASE_URL/KEY if Lighthouse-specific vars not set
const lhUrl = LIGHTHOUSE_URL || process.env.SUPABASE_URL;
const lhKey = LIGHTHOUSE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;

const BATCH_SIZE = 50;

/**
 * Map a bridge row to a live_signals insert payload.
 * live_signals uses camelCase column names (legacy schema).
 */
function mapBridgeRowToLiveSignal(row) {
  // Derive a human-readable title from signal_type + jurisdiction
  const title = [
    row.signal_type?.replace(/_/g, ' '),
    row.jurisdiction_raw_value ? `(${row.jurisdiction_raw_value})` : null,
  ].filter(Boolean).join(' ');

  // Derive domain from signal_type prefix
  const domain = deriveDomain(row.signal_type);

  // detected_at is a timestamptz — convert to epoch ms for live_signals.detectedAt (bigint)
  const detectedAtMs = row.detected_at
    ? new Date(row.detected_at).getTime()
    : Date.now();

  return {
    signalType: row.signal_type,
    datasetId: row.source_connector_id?.toString() || row.source_system || 'atlas_bridge',
    jurisdiction: row.jurisdiction_raw_value || row.jurisdiction_id || 'unknown',
    domain: domain,
    title: title,
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
    // Transport provenance fields
    bridge_source_id: row.bridge_record_id,
    bridge_hash: row.atlas_signal_dedup_key || `atlas-${row.atlas_signal_id}`,
    bridge_received_at: row.bridged_at || new Date().toISOString(),
    bridge_transport_version: row.bridge_version || 'atlas_lighthouse_bridge_v1',
  };
}

/**
 * Derive a domain category from signal_type.
 */
function deriveDomain(signalType) {
  if (!signalType) return 'general';
  const st = signalType.toLowerCase();
  if (st.includes('legislative') || st.includes('bill') || st.includes('statute')) return 'legislative';
  if (st.includes('court') || st.includes('judicial') || st.includes('case')) return 'judicial';
  if (st.includes('enforcement') || st.includes('violation') || st.includes('penalty')) return 'enforcement';
  if (st.includes('budget') || st.includes('fiscal') || st.includes('appropriation')) return 'fiscal';
  if (st.includes('housing') || st.includes('eviction') || st.includes('tenant')) return 'housing';
  if (st.includes('health') || st.includes('medical') || st.includes('clinic')) return 'health';
  if (st.includes('education') || st.includes('school')) return 'education';
  if (st.includes('employment') || st.includes('labor') || st.includes('wage')) return 'labor';
  if (st.includes('environment') || st.includes('epa') || st.includes('pollution')) return 'environment';
  return 'civic';
}

/**
 * Main drain function — called by the scheduler.
 */
export async function runBridgeDrain() {
  if (!lhUrl || !lhKey) {
    console.error('[BridgeDrain] Missing Lighthouse credentials. Set LIGHTHOUSE_SUPABASE_URL and LIGHTHOUSE_SERVICE_KEY.');
    return { processed: 0, promoted: 0, staged: 0, rejected: 0, errors: 0 };
  }

  const lh = createClient(lhUrl, lhKey);

  const stats = { processed: 0, promoted: 0, staged: 0, rejected: 0, errors: 0, skipped: 0 };

  try {
    // Step 1: Fetch unprocessed bridge signals
    // "Unprocessed" = bridge_hash not yet in live_signals
    const { data: bridgeRows, error: fetchError } = await lh
      .from('atlas_lighthouse_signal_bridge_v1')
      .select('*')
      .eq('signal_status', 'active')
      .order('bridged_at', { ascending: true })
      .limit(BATCH_SIZE);

    if (fetchError) {
      console.error('[BridgeDrain] Failed to fetch bridge rows:', fetchError.message);
      return stats;
    }

    if (!bridgeRows || bridgeRows.length === 0) {
      console.log('[BridgeDrain] No bridge rows to process.');
      return stats;
    }

    // Step 2: Filter out already-processed signals (idempotency check)
    const bridgeHashes = bridgeRows
      .map(r => r.atlas_signal_dedup_key || `atlas-${r.atlas_signal_id}`)
      .filter(Boolean);

    const { data: existingSignals } = await lh
      .from('live_signals')
      .select('bridge_hash')
      .in('bridge_hash', bridgeHashes);

    const processedHashes = new Set((existingSignals || []).map(s => s.bridge_hash));

    const unprocessed = bridgeRows.filter(row => {
      const hash = row.atlas_signal_dedup_key || `atlas-${row.atlas_signal_id}`;
      return !processedHashes.has(hash);
    });

    if (unprocessed.length === 0) {
      console.log(`[BridgeDrain] All ${bridgeRows.length} bridge rows already processed.`);
      stats.skipped = bridgeRows.length;
      return stats;
    }

    console.log(`[BridgeDrain] Processing ${unprocessed.length} new bridge signals (${bridgeRows.length - unprocessed.length} already processed).`);

    // Step 3: For each unprocessed signal: write to live_signals, then call gate
    for (const row of unprocessed) {
      try {
        const liveSignalPayload = mapBridgeRowToLiveSignal(row);

        // Insert into live_signals
        const { data: insertedSignal, error: insertError } = await lh
          .from('live_signals')
          .insert(liveSignalPayload)
          .select('id')
          .single();

        if (insertError) {
          // Duplicate fingerprint is expected for idempotency — skip silently
          if (insertError.code === '23505') {
            stats.skipped++;
            continue;
          }
          console.error(`[BridgeDrain] Failed to insert live_signal for bridge_record_id=${row.bridge_record_id}:`, insertError.message);
          stats.errors++;
          continue;
        }

        const liveSignalId = insertedSignal?.id;
        stats.processed++;

        // Step 4: Run through Sunam gate
        const { data: gateResult, error: gateError } = await lh.rpc('evaluate_and_promote_signal', {
          p_live_signal_id:         liveSignalId,
          p_signal_type:            row.signal_type,
          p_source_system:          row.source_system,
          p_source_connector_id:    row.source_connector_id?.toString() || row.source_system,
          p_jurisdiction_raw_value: row.jurisdiction_raw_value || row.jurisdiction_id || 'unknown',
          p_dataset_id:             row.source_connector_id?.toString() || row.source_system || 'atlas_bridge',
          p_confidence_score:       row.confidence_score ?? 0.5,
          p_severity:               row.severity || 'medium',
          p_detected_at:            row.detected_at,
          p_source_url:             row.source_url || null,
          p_generation_method:      row.generation_method || 'atlas_bridge_ingest',
          p_record_origin:          row.record_origin || 'atlas',
          p_verification_status:    row.verification_status || 'unverified',
          p_evidence_payload:       row.evidence_payload || {},
          p_provenance_metadata:    row.provenance_metadata || {},
          p_raw_payload:            row.atlas_metadata_json || {},
          p_rule_id:                row.rule_id || null,
        });

        if (gateError) {
          console.error(`[BridgeDrain] Gate error for live_signal_id=${liveSignalId}:`, gateError.message);
          stats.errors++;
          continue;
        }

        const decision = gateResult?.decision;
        if (decision === 'PROMOTE') {
          stats.promoted++;
          console.log(`[BridgeDrain] PROMOTED: live_signal_id=${liveSignalId} score=${gateResult?.composite_score} → detected_signal_id=${gateResult?.detected_signal_id}`);
        } else if (decision === 'STAGE' || decision === 'HOLD' || decision === 'ESCALATE_REVIEW') {
          stats.staged++;
          console.log(`[BridgeDrain] ${decision}: live_signal_id=${liveSignalId} score=${gateResult?.composite_score} → extraction_staging`);
        } else {
          stats.rejected++;
          console.log(`[BridgeDrain] REJECTED: live_signal_id=${liveSignalId} score=${gateResult?.composite_score}`);
        }

      } catch (rowErr) {
        console.error(`[BridgeDrain] Unexpected error for bridge_record_id=${row.bridge_record_id}:`, rowErr.message);
        stats.errors++;
      }
    }

    console.log(`[BridgeDrain] Run complete — processed=${stats.processed} promoted=${stats.promoted} staged=${stats.staged} rejected=${stats.rejected} errors=${stats.errors} skipped=${stats.skipped}`);
    return stats;

  } catch (err) {
    console.error('[BridgeDrain] Fatal error:', err.message);
    return stats;
  }
}
