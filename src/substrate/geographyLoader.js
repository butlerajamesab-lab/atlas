/**
 * Atlas Geography Loader
 *
 * Loads, validates, and activates geography registries from authoritative
 * data files. Designed so any jurisdiction can be loaded without schema changes.
 *
 * Washington is the bounded acceptance slice — not the completed national substrate.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateGeographyRegistry,
  computeRegistryHash,
  createGeographyRegistry,
  buildAdjacencyMap,
} from './geography.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', 'data');

/**
 * Load a geography registry from a JSON file.
 * Validates all records before returning.
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
 * Load and validate the Washington State geography registry.
 * Returns the complete validated registry with hash.
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

  // Compute registry hash
  const registryHash = computeRegistryHash(data.records);

  // Build adjacency map
  const adjacency = buildAdjacencyMap(data.records);

  return {
    status: 'valid',
    jurisdiction: data.jurisdiction || 'us_wa',
    source_id: data.source_id,
    source_version: data.source_version,
    source_url: data.source_url,
    registry_version: data.registry_version,
    record_count: data.records.length,
    hash: registryHash.hash,
    records: data.records,
    adjacency,
    loaded_at: new Date().toISOString(),
  };
}

/**
 * Load any available geography registry by jurisdiction ID.
 * Returns null if no registry exists for the jurisdiction.
 */
export function loadGeographyByJurisdiction(jurisdictionId) {
  const fileMap = {
    us_wa: 'washington_geography.json',
    // Future jurisdictions added here without schema changes
  };

  const filename = fileMap[jurisdictionId];
  if (!filename) return null;

  if (jurisdictionId === 'us_wa') {
    return loadWashingtonGeography();
  }

  // Generic loader for future jurisdictions
  const data = loadGeographyFile(filename);
  return createGeographyRegistry(data.records, {
    source_id: data.source_id,
    source_version: data.source_version,
  });
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
    // Future jurisdictions added here
  ];
}
