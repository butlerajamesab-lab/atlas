/**
 * Atlas Deterministic Geography Registry
 *
 * Versioned, source-identified geographic normalization. Each geography
 * record carries its source identity, effective period, area, centroid,
 * and adjacency. No placeholder assumptions — missing data is null.
 *
 * Platform rule: Same geography version + same input → same normalized output.
 */

import { createHash } from 'node:crypto';

const GEOGRAPHY_REGISTRY_VERSION = '1.0.0';

/**
 * Validate a single geography record. Returns { valid, errors }.
 * Rejects negative areas, duplicate IDs, zero-weight entries, and
 * missing required fields.
 */
export function validateGeographyRecord(record) {
  const errors = [];

  if (!record.jurisdiction_id || typeof record.jurisdiction_id !== 'string') {
    errors.push('missing or invalid jurisdiction_id');
  }
  if (!record.source_id || typeof record.source_id !== 'string') {
    errors.push('missing source_id');
  }
  if (!record.source_record_id || typeof record.source_record_id !== 'string') {
    errors.push('missing source_record_id');
  }
  if (!record.name || typeof record.name !== 'string') {
    errors.push('missing name');
  }
  if (!record.level || typeof record.level !== 'string') {
    errors.push('missing level (state, county, city, tract)');
  }
  if (!record.effective_from) {
    errors.push('missing effective_from');
  }

  // Area validation: must be positive if present
  if (record.area_sq_km !== null && record.area_sq_km !== undefined) {
    if (typeof record.area_sq_km !== 'number' || record.area_sq_km < 0) {
      errors.push('area_sq_km must be a non-negative number');
    }
    if (record.area_sq_km === 0) {
      errors.push('area_sq_km is zero — likely invalid');
    }
  }

  // Centroid validation
  if (record.centroid_lat !== null && record.centroid_lat !== undefined) {
    if (typeof record.centroid_lat !== 'number' || record.centroid_lat < -90 || record.centroid_lat > 90) {
      errors.push('centroid_lat must be between -90 and 90');
    }
  }
  if (record.centroid_lon !== null && record.centroid_lon !== undefined) {
    if (typeof record.centroid_lon !== 'number' || record.centroid_lon < -180 || record.centroid_lon > 180) {
      errors.push('centroid_lon must be between -180 and 180');
    }
  }

  // FIPS validation for US jurisdictions
  if (record.fips_code !== null && record.fips_code !== undefined) {
    if (typeof record.fips_code !== 'string' || !/^\d{2,5}$/.test(record.fips_code)) {
      errors.push('fips_code must be 2-5 digit string');
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a complete geography registry. Checks for duplicates,
 * negative areas, and missing data.
 */
export function validateGeographyRegistry(records) {
  const errors = [];
  const seenIds = new Set();
  const seenSourceRecords = new Set();

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const recordValidation = validateGeographyRecord(record);

    if (!recordValidation.valid) {
      errors.push({ index: i, jurisdiction_id: record.jurisdiction_id, errors: recordValidation.errors });
    }

    // Duplicate jurisdiction_id check
    if (record.jurisdiction_id) {
      if (seenIds.has(record.jurisdiction_id)) {
        errors.push({ index: i, jurisdiction_id: record.jurisdiction_id, errors: ['duplicate jurisdiction_id'] });
      }
      seenIds.add(record.jurisdiction_id);
    }

    // Duplicate source_record_id check
    const sourceKey = `${record.source_id}:${record.source_record_id}`;
    if (record.source_record_id) {
      if (seenSourceRecords.has(sourceKey)) {
        errors.push({ index: i, jurisdiction_id: record.jurisdiction_id, errors: ['duplicate source_record_id'] });
      }
      seenSourceRecords.add(sourceKey);
    }
  }

  return {
    valid: errors.length === 0,
    total_records: records.length,
    errors,
  };
}

/**
 * Compute the deterministic registry hash for a set of geography records.
 * Records are sorted by jurisdiction_id to ensure stability.
 */
export function computeRegistryHash(records) {
  const sorted = [...records].sort((a, b) =>
    (a.jurisdiction_id || '').localeCompare(b.jurisdiction_id || ''),
  );

  const canonical = sorted.map((r) => ({
    jurisdiction_id: r.jurisdiction_id,
    source_id: r.source_id,
    source_record_id: r.source_record_id,
    name: r.name,
    level: r.level,
    fips_code: r.fips_code || null,
    parent_jurisdiction_id: r.parent_jurisdiction_id || null,
    area_sq_km: r.area_sq_km ?? null,
    centroid_lat: r.centroid_lat ?? null,
    centroid_lon: r.centroid_lon ?? null,
    effective_from: r.effective_from,
    effective_to: r.effective_to || null,
  }));

  const hash = createHash('sha256')
    .update(JSON.stringify(canonical))
    .digest('hex');

  return {
    registry_version: GEOGRAPHY_REGISTRY_VERSION,
    record_count: sorted.length,
    hash,
    computed_at: new Date().toISOString(),
  };
}

/**
 * Normalize a geographic input to its canonical jurisdiction_id.
 * Returns null if no match — never guesses.
 */
export function normalizeGeography(input, registry) {
  if (!input || typeof input !== 'string') return null;
  const normalized = input.trim().toLowerCase();
  if (!normalized) return null;

  // Exact jurisdiction_id match
  const exactById = registry.find(
    (r) => r.jurisdiction_id.toLowerCase() === normalized,
  );
  if (exactById) return exactById.jurisdiction_id;

  // Exact name match
  const exactByName = registry.find(
    (r) => r.name.toLowerCase() === normalized,
  );
  if (exactByName) return exactByName.jurisdiction_id;

  // FIPS code match
  const byFips = registry.find(
    (r) => r.fips_code && r.fips_code === input.trim(),
  );
  if (byFips) return byFips.jurisdiction_id;

  // No match — return null, never guess
  return null;
}

/**
 * Build adjacency map from explicit adjacency data.
 * Only includes adjacencies that are explicitly declared — never inferred.
 */
export function buildAdjacencyMap(records) {
  const map = new Map();

  for (const record of records) {
    if (!record.adjacent_to || !Array.isArray(record.adjacent_to)) continue;
    const existing = map.get(record.jurisdiction_id) || new Set();
    for (const adj of record.adjacent_to) {
      existing.add(adj);
    }
    map.set(record.jurisdiction_id, existing);
  }

  // Convert sets to sorted arrays for determinism
  const result = {};
  for (const [key, value] of map.entries()) {
    result[key] = [...value].sort();
  }
  return result;
}

/**
 * Create a versioned geography registry snapshot.
 */
export function createGeographyRegistry(records, metadata = {}) {
  const validation = validateGeographyRegistry(records);
  if (!validation.valid) {
    return {
      status: 'invalid',
      validation,
      registry: null,
    };
  }

  const registryHash = computeRegistryHash(records);
  const adjacency = buildAdjacencyMap(records);

  return {
    status: 'valid',
    validation,
    registry: {
      version: GEOGRAPHY_REGISTRY_VERSION,
      source_id: metadata.source_id || null,
      source_version: metadata.source_version || null,
      loaded_at: new Date().toISOString(),
      record_count: records.length,
      hash: registryHash.hash,
      records,
      adjacency,
    },
  };
}

export { GEOGRAPHY_REGISTRY_VERSION };
