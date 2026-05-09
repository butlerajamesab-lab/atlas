import { supabase } from '../lib/supabaseClient.js';

const BRIDGE_ID = 'atlas-to-lighthouse';
const SOURCE_TABLE = 'prime_patterns';
const TARGET_TABLE = 'lighthouse_bridge_queue';
const DEFAULT_THRESHOLD = 0.7;

function threshold() {
  const parsed = Number(process.env.BRIDGE_CONFIDENCE_THRESHOLD ?? DEFAULT_THRESHOLD);
  if (!Number.isFinite(parsed)) return DEFAULT_THRESHOLD;
  return Math.max(0, Math.min(1, parsed));
}

function asJsonObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function firstNonEmpty(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function normalizePattern(pattern) {
  const evidence = asJsonObject(pattern.evidence);
  const payload = asJsonObject(pattern.payload);
  const alert = asJsonObject(payload.alert);
  const manifest = asJsonObject(payload.manifest);

  const patternId = firstNonEmpty(pattern.pattern_id, pattern.id, payload.pattern_id);
  if (!patternId) throw Object.assign(new Error('Prime pattern is missing pattern_id.'), { status: 400 });

  const confidence = Number(firstNonEmpty(pattern.confidence_score, pattern.confidence, alert.confidence, 0));
  const confidenceScore = Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0;
  const patternType = firstNonEmpty(pattern.pattern_type, payload.pattern_type, 'prime_pattern');
  const ruleId = firstNonEmpty(pattern.rule_id, payload.rule_id, manifest.function_id, `${patternType}_v1`);
  const streamId = firstNonEmpty(pattern.stream_id, payload.stream_id, alert.stream_id);
  const jobId = firstNonEmpty(pattern.job_id, pattern.investigation_job_id, payload.job_id);
  const detectedAt = firstNonEmpty(pattern.detected_at, payload.detected_at, new Date().toISOString());
  const jurisdiction = firstNonEmpty(pattern.jurisdiction, payload.jurisdiction, alert.jurisdiction, 'unknown');
  const summary = firstNonEmpty(pattern.summary, alert.summary, `${patternType} detected by Atlas streaming investigation.`);
  const sourceUrl = firstNonEmpty(pattern.source_url, evidence.source_url, payload.source_url, alert.source_url);

  return {
    patternId: String(patternId),
    patternType: String(patternType),
    confidenceScore,
    ruleId: String(ruleId),
    streamId: streamId ? String(streamId) : null,
    jobId: jobId ? String(jobId) : null,
    detectedAt,
    jurisdiction: String(jurisdiction),
    summary: String(summary),
    sourceUrl: sourceUrl ? String(sourceUrl) : null,
    evidence,
    payload,
  };
}

function severityFromConfidence(confidenceScore) {
  if (confidenceScore >= 0.9) return 'critical';
  if (confidenceScore >= 0.8) return 'high';
  if (confidenceScore >= 0.7) return 'medium';
  if (confidenceScore >= 0.5) return 'low';
  return 'info';
}

function buildBridgePayload(pattern, normalized, provenance, dedupKey) {
  return {
    signal_type: normalized.patternType,
    severity_score: normalized.confidenceScore,
    confidence_score: normalized.confidenceScore,
    severity: severityFromConfidence(normalized.confidenceScore),
    signal_status: 'active',
    metadata_json: {
      title: `Prime pattern: ${normalized.patternType}`,
      description: normalized.summary,
      narrative_summary: normalized.summary,
      source_domain: 'atlas_streaming',
      domain: 'atlas_streaming',
      location: normalized.jurisdiction,
      jurisdiction: normalized.jurisdiction,
      stream_id: normalized.streamId,
      pattern_id: normalized.patternId,
      investigation_job_id: normalized.jobId,
      rule_id: normalized.ruleId,
      confidence_score: normalized.confidenceScore,
      connector_path: 'Atlas streaming investigation -> deterministic bridge -> Lighthouse',
      no_ai_extraction: true,
      no_fuzzy_matching: true,
      no_synthetic_signals: true,
    },
    source_table: SOURCE_TABLE,
    source_record_id: normalized.patternId,
    detected_at: normalized.detectedAt,
    source_url: normalized.sourceUrl,
    jurisdiction_raw_value: normalized.jurisdiction,
    evidence_payload: {
      pattern,
      evidence: normalized.evidence,
      payload: normalized.payload,
      provenance,
    },
    generation_method: 'deterministic_rule',
    rule_id: normalized.ruleId,
    rule_version: 'v1',
    provenance_metadata: provenance,
    signal_dedup_key: dedupKey,
    record_origin: 'streaming_investigation',
    verification_status: 'verified',
    exclude_from_production: false,
  };
}

export async function triggerBridgeForPattern(pattern, jobId = null, streamId = null) {
  const startedAt = Date.now();
  const normalized = normalizePattern({ ...pattern, job_id: pattern.job_id ?? jobId, stream_id: pattern.stream_id ?? streamId });
  const minConfidence = threshold();
  const timestamp = new Date().toISOString();

  const provenance = {
    stream_id: normalized.streamId,
    pattern_id: normalized.patternId,
    investigation_job_id: normalized.jobId,
    confidence_score: normalized.confidenceScore,
    rule_id: normalized.ruleId,
    timestamp,
    no_ai_extraction: true,
    no_fuzzy_matching: true,
    no_synthetic_signals: true,
    bridge_id: BRIDGE_ID,
    threshold: minConfidence,
  };

  if (normalized.confidenceScore < minConfidence) {
    return {
      skipped: true,
      reason: 'below_threshold',
      pattern_id: normalized.patternId,
      confidence_score: normalized.confidenceScore,
      threshold: minConfidence,
    };
  }

  const dedupKey = `${BRIDGE_ID}|${SOURCE_TABLE}|${normalized.patternId}|${normalized.ruleId}`;
  const signalRecord = buildBridgePayload(pattern, normalized, provenance, dedupKey);
  const { data: rpcResult, error: rpcError } = await supabase.rpc('trigger_lighthouse_bridge_for_prime_pattern_v1', {
    p_signal: signalRecord,
    p_audit_context: {
      ...provenance,
      target_table: TARGET_TABLE,
      duration_ms_client: Date.now() - startedAt,
    },
    p_process_queue: true,
  });

  if (rpcError) {
    throw Object.assign(
      new Error(`Lighthouse bridge RPC failed: ${rpcError.message}`),
      { status: 500, details: rpcError.details ?? rpcError.hint ?? null },
    );
  }

  return {
    ...(rpcResult ?? {}),
    pattern_id: normalized.patternId,
    confidence_score: normalized.confidenceScore,
    threshold: minConfidence,
  };
}
