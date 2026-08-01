import { createHash } from 'node:crypto';

export const ENGINE_VERSION = '2.1.0';

export function canonicalJson(value) {
  if (value === undefined) throw new Error('canonical JSON does not permit undefined');
  if (value === null) return 'null';
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('canonical JSON does not permit non-finite numbers');
  }
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`;
}

export function sha256(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function canonicalEqual(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

export function computeRunKey({
  as_of,
  config,
  geography_registry_version,
  geography_registry_hash,
  rule_manifest_hash,
  source_population_hash,
  engine_version = ENGINE_VERSION,
}) {
  if (!Number.isFinite(as_of)) throw new Error('run key requires finite as_of');
  for (const [name, value] of Object.entries({
    geography_registry_version,
    geography_registry_hash,
    rule_manifest_hash,
    source_population_hash,
    engine_version,
  })) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`run key requires ${name}`);
    }
  }
  return sha256({
    engine_version,
    as_of,
    config,
    geography_registry_version,
    geography_registry_hash,
    rule_manifest_hash,
    source_population_hash,
  });
}
