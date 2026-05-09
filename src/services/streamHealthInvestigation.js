import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 14);

export const luminariStreamHealthManifest = {
  function_id: 'luminari_stream_health_v1',
  input_types: ['signal_event'],
  output_types: ['stream_health_alert', 'prime_pattern'],
  description: 'Evaluates Atlas stream staleness, signal frequency, and confidence-score distribution.',
};

function confidenceStats(events) {
  const values = events
    .map((event) => Number(event.provenance?.confidence))
    .filter((value) => !Number.isNaN(value));

  if (!values.length) {
    return { count: 0, min: null, max: null, avg: null, low_confidence_count: 0, high_confidence_count: 0 };
  }

  const sum = values.reduce((acc, value) => acc + value, 0);
  return {
    count: values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    avg: sum / values.length,
    low_confidence_count: values.filter((value) => value < 0.5).length,
    high_confidence_count: values.filter((value) => value >= 0.85).length,
  };
}

function frequencyStats(events) {
  if (events.length < 2) {
    return { event_count: events.length, span_seconds: 0, events_per_hour: events.length };
  }

  const timestamps = events
    .map((event) => Date.parse(event.timestamp))
    .filter((value) => !Number.isNaN(value))
    .sort((a, b) => a - b);

  if (timestamps.length < 2) {
    return { event_count: events.length, span_seconds: 0, events_per_hour: events.length };
  }

  const spanSeconds = Math.max(1, (timestamps.at(-1) - timestamps[0]) / 1000);
  return {
    event_count: events.length,
    span_seconds: spanSeconds,
    events_per_hour: events.length / (spanSeconds / 3600),
  };
}

function stalenessStats(events) {
  if (!events.length) return { stale: true, age_seconds: null, latest_timestamp: null };
  const latest = events
    .map((event) => Date.parse(event.timestamp))
    .filter((value) => !Number.isNaN(value))
    .sort((a, b) => b - a)[0];
  if (!latest) return { stale: true, age_seconds: null, latest_timestamp: null };
  const ageSeconds = Math.max(0, (Date.now() - latest) / 1000);
  return {
    stale: ageSeconds > 24 * 3600,
    age_seconds: ageSeconds,
    latest_timestamp: new Date(latest).toISOString(),
  };
}

function severityFor({ stale, confidence, frequency }) {
  if (stale.stale || confidence.avg === null || confidence.avg < 0.35) return 'high';
  if (confidence.low_confidence_count / Math.max(1, confidence.count) > 0.4) return 'medium';
  if (frequency.event_count === 0) return 'medium';
  return 'info';
}

export function evaluateStreamHealth({ stream, events, fromOffset, toOffset }) {
  const confidence = confidenceStats(events);
  const frequency = frequencyStats(events);
  const stale = stalenessStats(events);
  const severity = severityFor({ stale, confidence, frequency });
  const detectedAt = new Date().toISOString();
  const hasAlert = severity !== 'info' || stale.stale || confidence.low_confidence_count > 0;

  const alert = {
    type: 'stream_health_alert',
    function_id: luminariStreamHealthManifest.function_id,
    stream_id: stream.stream_id,
    module: stream.module_hint,
    jurisdiction: stream.jurisdiction_id,
    severity,
    detected_at: detectedAt,
    summary: hasAlert
      ? `Atlas stream ${stream.stream_id} health requires review: ${events.length} event(s), average confidence ${confidence.avg === null ? 'n/a' : confidence.avg.toFixed(3)}, stale=${stale.stale}.`
      : `Atlas stream ${stream.stream_id} is healthy across ${events.length} event(s).`,
    evidence: { from_offset: fromOffset, to_offset: toOffset, confidence, frequency, staleness: stale },
  };

  const patterns = [];
  if (hasAlert) {
    patterns.push({
      pattern_id: `pat_${nanoid()}`,
      pattern_type: 'stream_health_alert',
      module: stream.module_hint,
      jurisdiction: stream.jurisdiction_id,
      stream_id: stream.stream_id,
      confidence: confidence.avg === null ? 0.5 : Math.max(0.1, Math.min(1, 1 - confidence.low_confidence_count / Math.max(1, confidence.count))),
      severity,
      detected_at: detectedAt,
      summary: alert.summary,
      evidence: alert.evidence,
      payload: { manifest: luminariStreamHealthManifest, alert },
    });
  }

  return { alert, patterns };
}
