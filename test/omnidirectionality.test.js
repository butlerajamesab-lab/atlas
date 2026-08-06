import assert from 'node:assert/strict';
import test from 'node:test';

import { compareDomainSpaceCoordinates } from '../src/domain-space/domainSpace.js';
import { compileAtlasModuleDefinition } from '../src/modules/moduleDefinition.js';

function uuid(seed) {
  const suffix = String(seed).padStart(12, '0');
  return `00000000-0000-4000-8000-${suffix}`;
}

function moduleDefinition({ module_id, core_question, space, lens_id, connector_seed }) {
  return {
    module_id,
    module_version: '1.0.0',
    core_question,
    domain_space_definition: space,
    adapter_bindings: [{
      connector_id: uuid(connector_seed),
      schema_id: uuid(connector_seed + 100),
      adapter_class: `${module_id}Adapter`,
      role: 'primary_source',
      required: true,
    }],
    signal_taxonomy: [
      { signal_type: `${module_id}_primary`, universal_role: 'primary_evidence' },
      { signal_type: `${module_id}_anchor`, universal_role: 'spacetime_anchor' },
    ],
    filter_requirements: {
      module_required_filters: [{
        filter_id: 'deterministic_deduplication',
        parameters: { fingerprint_rule_id: 'atlas.signal_fingerprint.v2.1' },
      }],
      domain_required_filters: [{
        filter_id: 'domain_space_scope',
        parameters: { space_types: [space.space_type] },
      }],
    },
    structural_lens_stack: {
      stack_id: `${module_id}_stack`,
      lenses: [
        { lens_id, weight: 0.8 },
        { lens_id: 'disconfirmation', weight: 0.2 },
      ],
      require_disconfirmation: true,
    },
    convergence_configuration: {
      convergence_rule_id: 'atlas.convergence.v2.1',
      minimum_signal_count: 2,
      time_window_ms: 86400000,
      similarity_threshold: 0.65,
      deduplication_rule_id: 'atlas.signal_fingerprint.v2.1',
    },
    receipt_requirements: [
      'source_population_hash',
      'domain_space_receipt',
      'filter_stack_receipt',
      'structural_lens_receipt',
      'complete_output_hash',
      'replay_receipt',
    ],
  };
}

const proceduralSpace = {
  space_type: 'procedural',
  coordinate_schema: 'atlas.process_node.v1',
  distance_or_similarity_rule: 'atlas.graph.shortest_path_gaussian',
  normalization_rule: null,
  transform_rule: null,
  rule_version: '1.0.0',
  configuration: { sigma_hops: 2, directed: true },
};

const geographicSpace = {
  space_type: 'geographic',
  coordinate_schema: 'atlas.lat_lon.v1',
  distance_or_similarity_rule: 'atlas.geographic.haversine_gaussian',
  normalization_rule: null,
  transform_rule: null,
  rule_version: '1.0.0',
  configuration: { sigma_km: 50 },
};

const orbitalVectorSpace = {
  space_type: 'registered_extension',
  coordinate_schema: 'atlas.normalized_orbital_parameters.v1',
  distance_or_similarity_rule: 'atlas.vector.euclidean_gaussian',
  normalization_rule: 'adapter_declared_normalization.v1',
  transform_rule: null,
  rule_version: '1.0.0',
  configuration: { dimension_count: 4, sigma: 0.5 },
};

test('radically different domains compile through one Atlas module contract without engine forks', () => {
  const modules = [
    moduleDefinition({
      module_id: 'civic_accountability_process',
      core_question: 'Where does a governed process repeatedly fail to continue?',
      space: proceduralSpace,
      lens_id: 'orphaned_pathway',
      connector_seed: 1,
    }),
    moduleDefinition({
      module_id: 'meteorite_recovery',
      core_question: 'Where do independent fall, access, and timing signals converge?',
      space: geographicSpace,
      lens_id: 'recurrence',
      connector_seed: 2,
    }),
    moduleDefinition({
      module_id: 'rare_species_habitat',
      core_question: 'Where do independent habitat observations recur across governed geography?',
      space: geographicSpace,
      lens_id: 'geographic_diffusion',
      connector_seed: 3,
    }),
    moduleDefinition({
      module_id: 'orbital_target_opportunity',
      core_question: 'Which normalized orbital targets occupy compatible mission parameter space?',
      space: orbitalVectorSpace,
      lens_id: 'recurrence',
      connector_seed: 4,
    }),
  ].map(compileAtlasModuleDefinition);

  assert.equal(new Set(modules.map((module) => module.contract_version)).size, 1);
  assert.equal(new Set(modules.map((module) => module.module_definition_hash)).size, 4);
  assert.equal(modules.every((module) => module.filter_binding.receipt_identity.length === 64), true);
  assert.equal(modules.every((module) => module.structural_lens_stack.require_disconfirmation), true);
});

test('non-geographic orbital-style vectors use explicit normalized parameter space instead of geography', () => {
  const result = compareDomainSpaceCoordinates({
    definition: orbitalVectorSpace,
    left: { vector: [0.1, 0.2, 0.3, 0.4] },
    right: { vector: [0.1, 0.2, 0.4, 0.4] },
  });
  assert.equal(result.space_type, 'registered_extension');
  assert.equal(result.computed.distance_unit, 'normalized_vector_units');
  assert.ok(result.computed.similarity > 0 && result.computed.similarity < 1);
});

test('cross-domain equivalence preserves invariant vector math while source semantics remain distinct', () => {
  const orbitDefinition = {
    ...orbitalVectorSpace,
    coordinate_schema: 'adapter.orbit_normalized.v1',
  };
  const skillDefinition = {
    ...orbitalVectorSpace,
    coordinate_schema: 'adapter.skill_rank_normalized.v1',
  };
  const left = { vector: [0.2, 0.4, 0.6, 0.8] };
  const right = { vector: [0.3, 0.4, 0.5, 0.8] };
  const orbital = compareDomainSpaceCoordinates({ definition: orbitDefinition, left, right });
  const esports = compareDomainSpaceCoordinates({ definition: skillDefinition, left, right });

  assert.equal(orbital.computed.distance, esports.computed.distance);
  assert.equal(orbital.computed.similarity, esports.computed.similarity);
  assert.notEqual(orbital.space_definition_hash, esports.space_definition_hash);
  assert.notEqual(orbital.receipt_identity, esports.receipt_identity);
});

test('vector-space dimensions are explicit and malformed coordinates fail closed', () => {
  assert.throws(() => compareDomainSpaceCoordinates({
    definition: orbitalVectorSpace,
    left: { vector: [0.1, 0.2] },
    right: { vector: [0.1, 0.2, 0.3, 0.4] },
  }), /vector_length/);
});

test('domain-specific semantic labels do not enter the invariant vector coordinate object', () => {
  assert.throws(() => compareDomainSpaceCoordinates({
    definition: orbitalVectorSpace,
    left: { vector: [0.1, 0.2, 0.3, Number.NaN] },
    right: { vector: [0.1, 0.2, 0.3, 0.4] },
  }), /coordinate_invalid/);
});
