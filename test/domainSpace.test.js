import assert from 'node:assert/strict';
import test from 'node:test';

import { spatialSimilarityHaversine } from '../src/substrate/convergence.js';
import {
  DOMAIN_SPACE_CONTRACT_VERSION,
  compareDomainSpaceCoordinates,
  hashDomainSpaceCoordinatePopulation,
  listDomainSpaceRules,
  normalizeDomainSpaceDefinition,
} from '../src/domain-space/domainSpace.js';

const geographicDefinition = Object.freeze({
  space_type: 'geographic',
  coordinate_schema: 'atlas.lat_lon.v1',
  distance_or_similarity_rule: 'atlas.geographic.haversine_gaussian',
  normalization_rule: null,
  transform_rule: null,
  rule_version: '1.0.0',
  configuration: { sigma_km: 250 },
});

const lineageDefinition = Object.freeze({
  space_type: 'document_lineage',
  coordinate_schema: 'atlas.document_node.v1',
  distance_or_similarity_rule: 'atlas.graph.shortest_path_gaussian',
  normalization_rule: null,
  transform_rule: null,
  rule_version: '1.0.0',
  configuration: { sigma_hops: 2, directed: true },
});

test('domain-space registry is deterministic and declares only deterministic rules', () => {
  const first = listDomainSpaceRules();
  const second = listDomainSpaceRules();
  assert.deepEqual(first, second);
  assert.ok(first.length >= 2);
  assert.equal(first.every((rule) => rule.deterministic === true), true);
});

test('domain-space definition hashes are canonical and configuration-bound', () => {
  const left = normalizeDomainSpaceDefinition(geographicDefinition);
  const right = normalizeDomainSpaceDefinition({
    ...geographicDefinition,
    configuration: { sigma_km: 250 },
  });
  assert.equal(left.contract_version, DOMAIN_SPACE_CONTRACT_VERSION);
  assert.equal(left.definition_hash, right.definition_hash);
  assert.equal(left.configuration_hash, right.configuration_hash);
  assert.match(left.definition_hash, /^[0-9a-f]{64}$/);
});

test('geographic domain-space comparison preserves existing Haversine Gaussian behavior', () => {
  const registry = {
    entries: [
      { id: 'WA', centroid_lat: 47.3826, centroid_lon: -120.4472 },
      { id: 'OR', centroid_lat: 43.8041, centroid_lon: -120.5542 },
    ],
  };
  const legacy = spatialSimilarityHaversine('WA', 'OR', registry, 250);
  const result = compareDomainSpaceCoordinates({
    definition: geographicDefinition,
    left: { lat: 47.3826, lon: -120.4472 },
    right: { lat: 43.8041, lon: -120.5542 },
  });
  assert.equal(result.computed.similarity, legacy);
  assert.equal(result.computed.distance_unit, 'km');
});

test('document-lineage space resolves declared directed graph distance without geography', () => {
  const result = compareDomainSpaceCoordinates({
    definition: lineageDefinition,
    left: { node_id: 'introduced' },
    right: { node_id: 'enrolled' },
    context: {
      adjacency: {
        introduced: ['amendment_1'],
        amendment_1: ['engrossed'],
        engrossed: ['enrolled'],
        enrolled: [],
      },
    },
  });
  assert.equal(result.computed.distance, 3);
  assert.equal(result.computed.distance_unit, 'hops');
  assert.ok(result.computed.similarity > 0 && result.computed.similarity < 1);
  assert.match(result.receipt_identity, /^[0-9a-f]{64}$/);
});

test('directed lineage does not silently reverse unreachable paths', () => {
  const result = compareDomainSpaceCoordinates({
    definition: lineageDefinition,
    left: { node_id: 'enrolled' },
    right: { node_id: 'introduced' },
    context: {
      adjacency: {
        introduced: ['amendment_1'],
        amendment_1: ['enrolled'],
        enrolled: [],
      },
    },
  });
  assert.equal(result.computed.distance, null);
  assert.equal(result.computed.similarity, null);
});

test('non-geographic space never falls back to geographic behavior', () => {
  assert.throws(() => compareDomainSpaceCoordinates({
    definition: {
      ...lineageDefinition,
      distance_or_similarity_rule: 'atlas.geographic.haversine_gaussian',
    },
    left: { node_id: 'a' },
    right: { node_id: 'b' },
  }), /domain_space_rule_not_registered_for_space/);
});

test('unsupported rule and malformed configuration fail closed', () => {
  assert.throws(() => normalizeDomainSpaceDefinition({
    ...geographicDefinition,
    distance_or_similarity_rule: 'atlas.unknown.rule',
  }), /domain_space_rule_not_registered/);

  assert.throws(() => normalizeDomainSpaceDefinition({
    ...geographicDefinition,
    configuration: {},
  }), /sigma_km must be positive/);
});

test('hybrid space is explicit but not silently implemented before composition rules exist', () => {
  assert.throws(() => normalizeDomainSpaceDefinition({
    space_type: 'hybrid',
    coordinate_schema: 'atlas.hybrid.v1',
    distance_or_similarity_rule: 'atlas.graph.shortest_path_gaussian',
    normalization_rule: null,
    transform_rule: 'atlas.hybrid.weighted_similarity',
    rule_version: '1.0.0',
    configuration: { sigma_hops: 1, directed: false },
  }), /domain_space_rule_not_registered_for_space|domain_space_transform_not_supported/);
});

test('coordinate population hash is deterministic and order-sensitive by declared population order', () => {
  const a = [{ node_id: 'v1' }, { node_id: 'v2' }];
  const b = [{ node_id: 'v1' }, { node_id: 'v2' }];
  const c = [{ node_id: 'v2' }, { node_id: 'v1' }];
  assert.equal(hashDomainSpaceCoordinatePopulation(a), hashDomainSpaceCoordinatePopulation(b));
  assert.notEqual(hashDomainSpaceCoordinatePopulation(a), hashDomainSpaceCoordinatePopulation(c));
});
