/**
 * Atlas Deterministic Temporal Substrate
 *
 * Provides explicit temporal windows, as_of semantics, and deterministic
 * timestamp normalization. No implicit "now" — all temporal operations
 * require an explicit reference point.
 *
 * Platform rule: Given the same inputs + as_of → same output.
 */

/**
 * Normalize a timestamp to ISO 8601 UTC with millisecond precision.
 * Returns null for invalid or missing inputs — never invents a value.
 */
export function normalizeTimestamp(input) {
  if (input === null || input === undefined || input === '') return null;
  const date = new Date(input);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

/**
 * Create an explicit temporal window with validated bounds.
 * Both bounds are required — Atlas never assumes unbounded time.
 */
export function createTemporalWindow(from, to, asOf) {
  const normalizedFrom = normalizeTimestamp(from);
  const normalizedTo = normalizeTimestamp(to);
  const normalizedAsOf = normalizeTimestamp(asOf);

  if (!normalizedFrom) throw new Error('temporal window requires explicit "from" bound');
  if (!normalizedTo) throw new Error('temporal window requires explicit "to" bound');
  if (!normalizedAsOf) throw new Error('temporal window requires explicit "as_of" reference');

  const fromMs = new Date(normalizedFrom).getTime();
  const toMs = new Date(normalizedTo).getTime();
  const asOfMs = new Date(normalizedAsOf).getTime();

  if (fromMs > toMs) {
    throw new Error(`temporal window "from" (${normalizedFrom}) must not exceed "to" (${normalizedTo})`);
  }
  if (toMs > asOfMs) {
    throw new Error(`temporal window "to" (${normalizedTo}) must not exceed "as_of" (${normalizedAsOf})`);
  }

  return Object.freeze({
    from: normalizedFrom,
    to: normalizedTo,
    as_of: normalizedAsOf,
    duration_ms: toMs - fromMs,
  });
}

/**
 * Determine whether a given timestamp falls within a temporal window.
 * Returns a tri-state: true, false, or null (if timestamp is invalid).
 */
export function isWithinWindow(timestamp, window) {
  const normalized = normalizeTimestamp(timestamp);
  if (!normalized) return null;
  const ms = new Date(normalized).getTime();
  const fromMs = new Date(window.from).getTime();
  const toMs = new Date(window.to).getTime();
  return ms >= fromMs && ms <= toMs;
}

/**
 * Compute the deterministic temporal fingerprint component for a set of
 * timestamps. Sorted, deduplicated, and hashed for identity stability.
 */
export function temporalFingerprint(timestamps) {
  const valid = timestamps
    .map(normalizeTimestamp)
    .filter(Boolean)
    .sort();
  const unique = [...new Set(valid)];
  return {
    count: unique.length,
    earliest: unique[0] || null,
    latest: unique[unique.length - 1] || null,
    sorted_values: unique,
  };
}

/**
 * Compute the as_of-bounded view of a dataset. Only records with
 * timestamps <= as_of are included. This enforces point-in-time
 * reproducibility.
 */
export function filterByAsOf(records, timestampField, asOf) {
  const normalizedAsOf = normalizeTimestamp(asOf);
  if (!normalizedAsOf) throw new Error('filterByAsOf requires explicit as_of');
  const asOfMs = new Date(normalizedAsOf).getTime();

  return records.filter((record) => {
    const ts = normalizeTimestamp(record[timestampField]);
    if (!ts) return false;
    return new Date(ts).getTime() <= asOfMs;
  });
}
