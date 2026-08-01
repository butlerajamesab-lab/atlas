import { sha256 } from './canonical.js';

export function normalizeGeographyId(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim().toUpperCase();
  return normalized || null;
}

export function validateGeographyRecord(record) {
  const errors = [];
  for (const field of ['jurisdiction_id', 'source_id', 'source_record_id', 'name', 'level', 'effective_from']) {
    if (typeof record?.[field] !== 'string' || record[field].trim() === '') errors.push(`missing ${field}`);
  }
  if (!Number.isFinite(record?.area_sq_km) || record.area_sq_km <= 0) {
    errors.push('area_sq_km must be positive');
  }
  if (record?.centroid_lat !== null && record?.centroid_lat !== undefined
      && (!Number.isFinite(record.centroid_lat) || record.centroid_lat < -90 || record.centroid_lat > 90)) {
    errors.push('centroid_lat out of range');
  }
  if (record?.centroid_lon !== null && record?.centroid_lon !== undefined
      && (!Number.isFinite(record.centroid_lon) || record.centroid_lon < -180 || record.centroid_lon > 180)) {
    errors.push('centroid_lon out of range');
  }
  if (record?.fips_code !== null && record?.fips_code !== undefined
      && (typeof record.fips_code !== 'string' || !/^\d{2,5}$/.test(record.fips_code))) {
    errors.push('fips_code must be a 2-5 digit string');
  }
  if (record?.adjacent_to !== undefined && !Array.isArray(record.adjacent_to)) {
    errors.push('adjacent_to must be an array');
  }
  return { valid: errors.length === 0, errors };
}

export function validateGeographyRegistry(records) {
  if (!Array.isArray(records) || records.length === 0) {
    return { valid: false, errors: [{ jurisdiction_id: null, errors: ['registry is empty'] }] };
  }
  const errors = [];
  const byId = new Map();
  const sourceKeys = new Set();
  for (const record of records) {
    const result = validateGeographyRecord(record);
    const id = normalizeGeographyId(record?.jurisdiction_id);
    if (!result.valid) errors.push({ jurisdiction_id: id, errors: result.errors });
    if (id && byId.has(id)) errors.push({ jurisdiction_id: id, errors: ['duplicate jurisdiction_id'] });
    if (id) byId.set(id, record);
    const sourceKey = `${record?.source_id ?? ''}:${record?.source_record_id ?? ''}`;
    if (sourceKeys.has(sourceKey)) errors.push({ jurisdiction_id: id, errors: ['duplicate source_record_id'] });
    sourceKeys.add(sourceKey);
  }
  for (const record of records) {
    const id = normalizeGeographyId(record.jurisdiction_id);
    for (const neighborValue of record.adjacent_to ?? []) {
      const neighbor = normalizeGeographyId(neighborValue);
      const neighborRecord = byId.get(neighbor);
      if (!neighborRecord) {
        errors.push({ jurisdiction_id: id, errors: [`unknown adjacency ${neighbor}`] });
      } else if (!(neighborRecord.adjacent_to ?? []).map(normalizeGeographyId).includes(id)) {
        errors.push({ jurisdiction_id: id, errors: [`asymmetric adjacency ${neighbor}`] });
      }
    }
  }
  return { valid: errors.length === 0, errors, total_records: records.length };
}

export function computeRegistryHash(records) {
  const sorted = [...records]
    .map((record) => ({
      jurisdiction_id: normalizeGeographyId(record.jurisdiction_id),
      source_id: record.source_id,
      source_record_id: record.source_record_id,
      name: record.name,
      level: record.level,
      fips_code: record.fips_code ?? null,
      parent_jurisdiction_id: normalizeGeographyId(record.parent_jurisdiction_id),
      area_sq_km: record.area_sq_km,
      centroid_lat: record.centroid_lat ?? null,
      centroid_lon: record.centroid_lon ?? null,
      effective_from: record.effective_from,
      effective_to: record.effective_to ?? null,
      adjacent_to: [...(record.adjacent_to ?? [])].map(normalizeGeographyId).sort(),
    }))
    .sort((left, right) => left.jurisdiction_id.localeCompare(right.jurisdiction_id));
  return sha256(sorted);
}

export function toRuntimeRegistry(records, version, analysisLevel = null) {
  if (typeof version !== 'string' || version.length === 0) throw new Error('geography registry version is required');
  const selected = analysisLevel ? records.filter((record) => record.level === analysisLevel) : records;
  if (selected.length === 0) throw new Error(`geography registry has no entries for analysis_level '${analysisLevel}'`);
  const entries = selected.map((record) => Object.freeze({
    id: normalizeGeographyId(record.jurisdiction_id),
    level: record.level,
    source_record_id: record.source_record_id,
    parent_id: normalizeGeographyId(record.parent_jurisdiction_id),
    area_sq_km: record.area_sq_km,
    centroid_lat: record.centroid_lat ?? null,
    centroid_lon: record.centroid_lon ?? null,
    adjacency: (record.adjacent_to ?? []).map(normalizeGeographyId).sort(),
  })).sort((left, right) => left.id.localeCompare(right.id));
  return Object.freeze({ version, analysis_level: analysisLevel, entries: Object.freeze(entries) });
}

function derivedStatePostalAlias(record) {
  if (record.level !== 'state') return null;
  const id = normalizeGeographyId(record.jurisdiction_id);
  const match = /^US_([A-Z]{2})$/.exec(id);
  return match?.[1] ?? null;
}

export function resolveGeography(rawValue, records) {
  const normalized = normalizeGeographyId(rawValue);
  if (!normalized) return null;
  for (const record of records) {
    const id = normalizeGeographyId(record.jurisdiction_id);
    if (id === normalized) return id;
    if (normalizeGeographyId(record.name) === normalized) return id;
    if (record.fips_code && String(record.fips_code) === String(rawValue).trim()) return id;
    if (derivedStatePostalAlias(record) === normalized) return id;
  }
  return null;
}

export function buildAdjacencyMap(records) {
  return Object.fromEntries(records
    .map((record) => [
      normalizeGeographyId(record.jurisdiction_id),
      (record.adjacent_to ?? []).map(normalizeGeographyId).sort(),
    ])
    .sort(([left], [right]) => left.localeCompare(right)));
}
