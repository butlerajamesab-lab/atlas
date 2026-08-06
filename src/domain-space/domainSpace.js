import { sha256 } from '../substrate/canonical.js';
import { haversineDistance } from '../substrate/convergence.js';

export const DOMAIN_SPACE_CONTRACT_VERSION = '0.1.0';

export const DOMAIN_SPACE_TYPES = Object.freeze([
  'geographic',
  'network',
  'organizational',
  'procedural',
  'document_lineage',
  'hybrid',
  'registered_extension',
]);

const DOMAIN_SPACE_TYPE_SET = new Set(DOMAIN_SPACE_TYPES);

function assertPlainObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
}

function assertNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function assertPositiveFinite(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`);
}

function assertUnit(value, name) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be in [0,1]`);
}

function normalizeCoordinateHash(value) {
  return sha256(value);
}

function gaussianSimilarity(distance, sigma) {
  assertPositiveFinite(distance === 0 ? 1 : distance, 'distance');
  assertPositiveFinite(sigma, 'sigma');
  if (distance === 0) return 1;
  return Math.exp(-(distance ** 2) / (2 * sigma ** 2));
}

function validateGeographicCoordinate(coordinate, label) {
  assertPlainObject(coordinate, label);
  if (!Number.isFinite(coordinate.lat) || coordinate.lat < -90 || coordinate.lat > 90) {
    throw new Error(`domain_space_coordinate_invalid:${label}.lat`);
  }
  if (!Number.isFinite(coordinate.lon) || coordinate.lon < -180 || coordinate.lon > 180) {
    throw new Error(`domain_space_coordinate_invalid:${label}.lon`);
  }
}

function validateNodeCoordinate(coordinate, label) {
  assertPlainObject(coordinate, label);
  if (typeof coordinate.node_id !== 'string' || coordinate.node_id.trim() === '') {
    throw new Error(`domain_space_coordinate_invalid:${label}.node_id`);
  }
}

function normalizeAdjacency(adjacency) {
  assertPlainObject(adjacency, 'context.adjacency');
  const normalized = {};
  for (const [node, neighbors] of Object.entries(adjacency)) {
    if (!Array.isArray(neighbors)) throw new Error(`domain_space_coordinate_invalid:adjacency.${node}`);
    normalized[node] = [...new Set(neighbors.map((value) => String(value)))].sort();
  }
  return normalized;
}

function shortestPathDistance(leftNode, rightNode, adjacency, directed) {
  if (leftNode === rightNode) return 0;
  const graph = normalizeAdjacency(adjacency);
  if (!directed) {
    for (const [node, neighbors] of Object.entries({ ...graph })) {
      for (const neighbor of neighbors) {
        graph[neighbor] ??= [];
        if (!graph[neighbor].includes(node)) graph[neighbor].push(node);
      }
    }
    for (const node of Object.keys(graph)) graph[node].sort();
  }

  const visited = new Set([leftNode]);
  let frontier = [leftNode];
  let depth = 0;
  const maxDepth = Object.keys(graph).length + 1;
  while (frontier.length > 0 && depth < maxDepth) {
    depth += 1;
    const next = [];
    for (const node of frontier.sort()) {
      for (const neighbor of graph[node] ?? []) {
        if (neighbor === rightNode) return depth;
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          next.push(neighbor);
        }
      }
    }
    frontier = [...new Set(next)].sort();
  }
  return null;
}

const RULES = Object.freeze({
  'atlas.geographic.haversine_gaussian': Object.freeze({
    rule_version: '1.0.0',
    allowed_space_types: Object.freeze(['geographic']),
    score_range: Object.freeze([0, 1]),
    validate_configuration(configuration) {
      assertPlainObject(configuration, 'domain_space.configuration');
      assertPositiveFinite(configuration.sigma_km, 'domain_space.configuration.sigma_km');
      if (Object.keys(configuration).sort().join(',') !== 'sigma_km') {
        throw new Error('domain_space_configuration_invalid:geographic');
      }
    },
    compare(left, right, configuration) {
      validateGeographicCoordinate(left, 'left');
      validateGeographicCoordinate(right, 'right');
      const distance = haversineDistance(left.lat, left.lon, right.lat, right.lon);
      return {
        distance,
        distance_unit: 'km',
        similarity: gaussianSimilarity(distance, configuration.sigma_km),
      };
    },
  }),
  'atlas.graph.shortest_path_gaussian': Object.freeze({
    rule_version: '1.0.0',
    allowed_space_types: Object.freeze(['network', 'organizational', 'procedural', 'document_lineage']),
    score_range: Object.freeze([0, 1]),
    validate_configuration(configuration) {
      assertPlainObject(configuration, 'domain_space.configuration');
      assertPositiveFinite(configuration.sigma_hops, 'domain_space.configuration.sigma_hops');
      if (typeof configuration.directed !== 'boolean') {
        throw new Error('domain_space_configuration_invalid:directed');
      }
      if (Object.keys(configuration).sort().join(',') !== 'directed,sigma_hops') {
        throw new Error('domain_space_configuration_invalid:graph');
      }
    },
    compare(left, right, configuration, context) {
      validateNodeCoordinate(left, 'left');
      validateNodeCoordinate(right, 'right');
      assertPlainObject(context, 'domain_space.context');
      const distance = shortestPathDistance(
        left.node_id,
        right.node_id,
        context.adjacency,
        configuration.directed,
      );
      return {
        distance,
        distance_unit: 'hops',
        similarity: distance === null ? null : gaussianSimilarity(distance, configuration.sigma_hops),
      };
    },
  }),
});

export function listDomainSpaceRules() {
  return Object.freeze(Object.entries(RULES).map(([rule_id, rule]) => Object.freeze({
    rule_id,
    rule_version: rule.rule_version,
    allowed_space_types: rule.allowed_space_types,
    score_range: rule.score_range,
    deterministic: true,
  })).sort((left, right) => left.rule_id.localeCompare(right.rule_id)));
}

export function normalizeDomainSpaceDefinition(definition) {
  assertPlainObject(definition, 'domain_space_definition');
  const space_type = assertNonEmptyString(definition.space_type, 'domain_space.space_type');
  if (!DOMAIN_SPACE_TYPE_SET.has(space_type)) {
    throw new Error(`domain_space_definition_invalid:space_type:${space_type}`);
  }
  const coordinate_schema = assertNonEmptyString(definition.coordinate_schema, 'domain_space.coordinate_schema');
  const distance_or_similarity_rule = assertNonEmptyString(
    definition.distance_or_similarity_rule,
    'domain_space.distance_or_similarity_rule',
  );
  const rule_version = assertNonEmptyString(definition.rule_version, 'domain_space.rule_version');
  if (!/^\d+\.\d+\.\d+$/.test(rule_version)) {
    throw new Error('domain_space_rule_version_mismatch:invalid_semver');
  }
  const normalization_rule = definition.normalization_rule === null || definition.normalization_rule === undefined
    ? null
    : assertNonEmptyString(definition.normalization_rule, 'domain_space.normalization_rule');
  const transform_rule = definition.transform_rule === null || definition.transform_rule === undefined
    ? null
    : assertNonEmptyString(definition.transform_rule, 'domain_space.transform_rule');
  assertPlainObject(definition.configuration ?? {}, 'domain_space.configuration');
  const configuration = Object.freeze({ ...(definition.configuration ?? {}) });

  const rule = RULES[distance_or_similarity_rule];
  if (!rule) throw new Error(`domain_space_rule_not_registered:${distance_or_similarity_rule}`);
  if (rule.rule_version !== rule_version) {
    throw new Error(`domain_space_rule_version_mismatch:${distance_or_similarity_rule}`);
  }
  if (!rule.allowed_space_types.includes(space_type)) {
    throw new Error(`domain_space_rule_not_registered_for_space:${space_type}:${distance_or_similarity_rule}`);
  }
  if (space_type === 'hybrid') {
    throw new Error('domain_space_transform_not_supported:hybrid');
  }
  rule.validate_configuration(configuration);

  const normalized = {
    contract_version: DOMAIN_SPACE_CONTRACT_VERSION,
    space_type,
    coordinate_schema,
    distance_or_similarity_rule,
    normalization_rule,
    transform_rule,
    rule_version,
    configuration,
    configuration_hash: sha256(configuration),
  };
  return Object.freeze({
    ...normalized,
    definition_hash: sha256(normalized),
  });
}

export function compareDomainSpaceCoordinates({ definition, left, right, context = {} }) {
  const normalized = normalizeDomainSpaceDefinition(definition);
  const rule = RULES[normalized.distance_or_similarity_rule];
  const result = rule.compare(left, right, normalized.configuration, context);
  if (result.similarity !== null) assertUnit(result.similarity, 'domain_space similarity');

  const computed = Object.freeze({
    distance: result.distance,
    distance_unit: result.distance_unit,
    similarity: result.similarity,
  });
  const receiptPayload = {
    contract_version: DOMAIN_SPACE_CONTRACT_VERSION,
    space_type: normalized.space_type,
    space_rule_id: normalized.distance_or_similarity_rule,
    space_rule_version: normalized.rule_version,
    space_definition_hash: normalized.definition_hash,
    space_configuration_hash: normalized.configuration_hash,
    left_coordinate_hash: normalizeCoordinateHash(left),
    right_coordinate_hash: normalizeCoordinateHash(right),
    context_hash: sha256(context),
    computed,
  };
  const output_hash = sha256(computed);
  return Object.freeze({
    ...receiptPayload,
    output_hash,
    receipt_identity: sha256({ ...receiptPayload, output_hash }),
  });
}

export function hashDomainSpaceCoordinatePopulation(coordinates) {
  if (!Array.isArray(coordinates)) throw new Error('domain_space coordinates must be an array');
  return sha256([...coordinates].map((value) => ({ hash: normalizeCoordinateHash(value) })));
}
