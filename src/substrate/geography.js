/**
 * ATLAS GEOGRAPHY AUTHORITY v2.1.0
 *
 * Atlas is the canonical geography authority. Lighthouse consumes Atlas geography receipts.
 *
 * The geography registry is a versioned, immutable snapshot of geography entries.
 * The registry hash includes: source IDs, effective dates, areas, centroids,
 * hierarchy, and adjacency — canonicalized and hashed via canonical.js.
 *
 * Runtime format (Math Engine v2.1):
 *   GeographyRegistry { version: string, entries: GeographyEntry[] }
 *   GeographyEntry { id: string, area_sq_km: number, centroid_lat: number|null, centroid_lon: number|null, adjacency: string[] }
 *
 * Provenance format (full, persisted):
 *   Includes source_id, source_record_id, name, level, fips_code,
 *   parent_jurisdiction_id, effective_from, effective_to, adjacent_to.
 *
 * Geography IDs are uppercase strings (e.g., "US_WA", "US_WA_KING").
 */

import { sha256 } from './canonical.js';

/**
 * Normalize a geography ID to canonical form: trimmed uppercase.
 * Matches Math Engine v2.1 normalizeGeographyId.
 */
export function normalizeGeographyId(value) {
  if (value === null || value === undefined) return null;
  return String(value).trim().toUpperCase();
}

/**
 * Validate a single geography record (provenance format).
 * Returns { valid, errors }.
 */
export function validateGeographyRecord(record) {
  const errors = [];
  if (!record.jurisdiction_id) errors.push('missing jurisdiction_id');
  if (!record.source_id) errors.push('missing source_id');
  if (!record.source_record_id) errors.push('missing source_record_id');
  if (!record.name) errors.push('missing name');
  if (!record.level) errors.push('missing level');
  if (!record.effective_from) errors.push('missing effective_from');
  if (record.area_sq_km !== null && record.area_sq_km !== undefined) {
    if (typeof record.area_sq_km !== 'number' || record.area_sq_km < 0) {
      errors.push('area_sq_km must be non-negative');
    }
    if (record.area_sq_km === 0) {
      errors.push('area_sq_km is zero — likely invalid');
    }
  }
  if (record.centroid_lat !== null && record.centroid_lat !== undefined) {
    if (record.centroid_lat < -90 || record.centroid_lat > 90) errors.push('centroid_lat out of range');
  }
  if (record.centroid_lon !== null && record.centroid_lon !== undefined) {
    if (record.centroid_lon < -180 || record.centroid_lon > 180) errors.push('centroid_lon out of range');
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Validate a full geography registry (provenance format).
 * Checks for duplicates and validates each record.
 */
export function validateGeographyRegistry(records) {
  const errors = [];
  const seen = new Set();
  for (const record of records) {
    if (seen.has(record.jurisdiction_id)) {
      errors.push({ jurisdiction_id: record.jurisdiction_id, errors: ['duplicate jurisdiction_id'] });
    }
    seen.add(record.jurisdiction_id);
    const result = validateGeographyRecord(record);
    if (!result.valid) {
      errors.push({ jurisdiction_id: record.jurisdiction_id, errors: result.errors });
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Compute the immutable registry hash from provenance records.
 * Includes ALL provenance fields: source IDs, effective dates, areas, centroids,
 * hierarchy, and adjacency. Canonical JSON sorted by jurisdiction_id.
 *
 * This hash IS the registry version identity.
 */
export function computeRegistryHash(records) {
  const sorted = [...records].sort((a, b) =>
    a.jurisdiction_id.localeCompare(b.jurisdiction_id),
  );
  const payload = sorted.map((r) => ({
    jurisdiction_id: r.jurisdiction_id,
    source_id: r.source_id,
    source_record_id: r.source_record_id,
    name: r.name,
    level: r.level,
    fips_code: r.fips_code || null,
    parent_jurisdiction_id: r.parent_jurisdiction_id || null,
    area_sq_km: r.area_sq_km || null,
    centroid_lat: r.centroid_lat ?? null,
    centroid_lon: r.centroid_lon ?? null,
    effective_from: r.effective_from,
    effective_to: r.effective_to || null,
    adjacent_to: [...(r.adjacent_to || [])].sort(),
  }));
  return sha256(payload);
}

/**
 * Transform provenance records into Math Engine v2.1 runtime format.
 * Geography IDs are normalized to uppercase.
 */
export function toRuntimeRegistry(records, version) {
  if (!version) throw new Error('geography registry version is required');
  const entries = records.map((r) => ({
    id: normalizeGeographyId(r.jurisdiction_id),
    area_sq_km: r.area_sq_km,
    centroid_lat: r.centroid_lat ?? null,
    centroid_lon: r.centroid_lon ?? null,
    adjacency: (r.adjacent_to || []).map(normalizeGeographyId).sort(),
  }));
  return Object.freeze({
    version,
    entries: Object.freeze(entries.sort((a, b) => a.id.localeCompare(b.id))),
  });
}

/**
 * Resolve a raw geography string to a canonical geography ID.
 * Matches by: exact ID (case-insensitive), name, FIPS code.
 * Returns null if no match — never guesses.
 */
export function resolveGeography(rawValue, records) {
  if (!rawValue) return null;
  const normalized = normalizeGeographyId(rawValue);

  // Exact jurisdiction_id match (uppercase)
  const byId = records.find((r) => normalizeGeographyId(r.jurisdiction_id) === normalized);
  if (byId) return normalizeGeographyId(byId.jurisdiction_id);

  // Name match (case-insensitive)
  const byName = records.find((r) => r.name && r.name.toUpperCase() === normalized);
  if (byName) return normalizeGeographyId(byName.jurisdiction_id);

  // FIPS code match
  const byFips = records.find((r) => r.fips_code && r.fips_code === rawValue.trim());
  if (byFips) return normalizeGeographyId(byFips.jurisdiction_id);

  return null;
}

/**
 * Build the adjacency map from provenance records.
 * Keys are normalized (uppercase) geography IDs.
 */
export function buildAdjacencyMap(records) {
  const map = {};
  for (const record of records) {
    const id = normalizeGeographyId(record.jurisdiction_id);
    map[id] = (record.adjacent_to || []).map(normalizeGeographyId).sort();
  }
  return map;
}
