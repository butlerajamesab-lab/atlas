/**
 * ATLAS GEOGRAPHY LOADER v2.1.0
 *
 * Loads, validates, and transforms geography data files into:
 * 1. Provenance format (full source identity, persisted to DB)
 * 2. Runtime format (Math Engine v2.1 GeographyRegistry, used in computation)
 *
 * Washington is the bounded acceptance slice — not the completed national substrate.
 * No wall-clock injection. No mutable state.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateGeographyRegistry,
  computeRegistryHash,
  toRuntimeRegistry,
  buildAdjacencyMap,
  resolveGeography,
} from './geography.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', 'data');

/**
 * Load a geography data file. Returns raw parsed JSON.
 */
export function loadGeographyFile(filename) {
  const filepath = resolve(DATA_DIR, filename);
  const raw = readFileSync(filepath, 'utf-8');
  const data = JSON.parse(raw);
  if (!data.records || !Array.isArray(data.records)) {
    throw new Error(`Geography file ${filename} has no records array`);
  }
  if (!data.source_id) {
    throw new Error(`Geography file ${filename} has no source_id`);
  }
  return data;
}

/**
 * Load and validate the Washington State geography.
 * Returns both provenance and runtime formats.
 *
 * The registry_hash is the immutable version identity computed from
 * ALL provenance fields (source IDs, effective dates, areas, centroids, adjacency).
 */
export function loadWashingtonGeography() {
  const data = loadGeographyFile('washington_geography.json');

  // Validate all records
  const validation = validateGeographyRegistry(data.records);
  if (!validation.valid) {
    const errorSummary = validation.errors.slice(0, 5).map(
      (e) => `${e.jurisdiction_id}: ${e.errors.join(', ')}`,
    ).join('; ');
    throw new Error(`Washington geography validation failed: ${errorSummary}`);
  }

  // Compute the immutable registry hash (includes all provenance fields)
  const registryHash = computeRegistryHash(data.records);

  // Build runtime format for Math Engine v2.1 computations
  const runtime = toRuntimeRegistry(data.records, registryHash);

  // Build adjacency map
  const adjacency = buildAdjacencyMap(data.records);

  return Object.freeze({
    status: 'valid',
    jurisdiction: data.jurisdiction || 'us_wa',
    source_id: data.source_id,
    source_version: data.source_version,
    source_url: data.source_url,
    record_count: data.records.length,
    registry_hash: registryHash,
    // Provenance records (full source identity, for DB persistence)
    records: data.records,
    // Runtime registry (Math Engine v2.1 format, for computation)
    runtime,
    // Adjacency map (uppercase IDs)
    adjacency,
  });
}

/**
 * Load any available geography registry by jurisdiction ID.
 * Returns null if no registry exists for the jurisdiction.
 */
export function loadGeographyByJurisdiction(jurisdictionId) {
  const fileMap = {
    us_wa: 'washington_geography.json',
  };

  const filename = fileMap[jurisdictionId];
  if (!filename) return null;

  if (jurisdictionId === 'us_wa') {
    return loadWashingtonGeography();
  }
  return null;
}

/**
 * List all available geography jurisdictions.
 */
export function listAvailableJurisdictions() {
  return [
    {
      jurisdiction_id: 'us_wa',
      name: 'Washington State',
      level: 'state',
      source: 'census_tiger_2024',
      file: 'washington_geography.json',
    },
  ];
}

export { resolveGeography };
