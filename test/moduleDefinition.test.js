import assert from 'node:assert/strict';
import test from 'node:test';

import { sha256 } from '../src/substrate/canonical.js';
import { STRUCTURAL_LENS_REGISTRY_VERSION } from '../src/lenses/structuralLenses.js';

import {
  ATLAS_MODULE_CONTRACT_VERSION,
  compileAtlasModuleDefinition,
  validateAtlasModuleOperationalBindings,
} from '../src/modules/moduleDefinition.js';

const connectorId = '11111111-1111-4111-8111-111111111111';
const schemaId = '22222222-2222-4222-8222-222222222222';

function baseDefinition() {
  return {
    module_id: 'legislative_history_structure',
    module_version: '1.0.0',
    core_question: 'Which governed structural patterns recur across immutable legislative generations?',
    domain_space_definition: {
      space_type: 'document_lineage',
      coordinate_schema: 'atlas.document_node.v1',
      distance_or_similarity_rule: 'atlas.graph.shortest_path_gaussian',
      normalization_rule: null,
      transform_rule: null,
      rule_version: '1.0.0',
      configuration: { sigma_hops: 2, directed: true },
    },
    adapter_bindings: [{
      connector_id: connectorId,
      schema_id: schemaId,
      adapter_class: 'civicGenomeVersionBindingAdapter',
      role: 'legislative_version_source',
      required: true,
    }],
    signal_taxonomy: [
      { signal_type: 'structural_trait', universal_role: 'primary_evidence' },
      { signal_type: 'amendment_event', universal_role: 'spacetime_anchor' },
    ],
    filter_requirements: {
      module_required_filters: [{
        filter_id: 'deterministic_deduplication',
        parameters: { fingerprint_rule_id: 'atlas.signal_fingerprint.v2.1' },
      }],
      domain_required_filters: [{
        filter_id: 'domain_space_scope',
        parameters: { space_types: ['document_lineage'] },
      }],
    },
    structural_lens_stack: {
      stack_id: 'legislative_structural_history',
      lenses: [
        { lens_id: 'recurrence', weight: 0.45 },
        { lens_id: 'burden_shift', weight: 0.35 },
        { lens_id: 'disconfirmation', weight: 0.20 },
      ],
      require_disconfirmation: true,
    },
    convergence_configuration: {
      convergence_rule_id: 'atlas.convergence.v2.1',
      minimum_signal_count: 2,
      time_window_ms: 31536000000,
      similarity_threshold: 0.7,
      deduplication_rule_id: 'atlas.signal_fingerprint.v2.1',
    },
    receipt_requirements: [
      'source_population_hash',
      'deduplicated_population_hash',
      'domain_space_receipt',
      'filter_stack_receipt',
      'structural_lens_receipt',
      'complete_output_hash',
      'replay_receipt',
    ],
  };
}

test('module compiler produces deterministic complete definition identity', () => {
  const first = compileAtlasModuleDefinition(baseDefinition());
  const second = compileAtlasModuleDefinition({
    ...baseDefinition(),
    signal_taxonomy: [...baseDefinition().signal_taxonomy].reverse(),
    receipt_requirements: [...baseDefinition().receipt_requirements].reverse(),
  });
  assert.equal(first.contract_version, ATLAS_MODULE_CONTRACT_VERSION);
  assert.equal(first.module_definition_hash, second.module_definition_hash);
  assert.match(first.module_definition_hash, /^[0-9a-f]{64}$/);
  assert.match(first.filter_binding.receipt_identity, /^[0-9a-f]{64}$/);
  assert.equal(first.structural_lens_stack.require_disconfirmation, true);
});

test('module is blocked when required canonical adapter binding is unavailable', () => {
  const compiled = compileAtlasModuleDefinition(baseDefinition());
  const receipt = validateAtlasModuleOperationalBindings(compiled, {
    connectors: [],
    schemas: [],
  });
  assert.equal(receipt.operational_state, 'blocked');
  assert.deepEqual(receipt.bindings[0].reasons, ['connector_not_found', 'schema_not_found']);
  assert.match(receipt.receipt_identity, /^[0-9a-f]{64}$/);
});

test('module is ready only when explicit connector/schema/adapter identities match', () => {
  const compiled = compileAtlasModuleDefinition(baseDefinition());
  const receipt = validateAtlasModuleOperationalBindings(compiled, {
    connectors: [{
      id: connectorId,
      schema_id: schemaId,
      adapter_class: 'civicGenomeVersionBindingAdapter',
      active: true,
    }],
    schemas: [{ id: schemaId, active: true }],
  });
  assert.equal(receipt.operational_state, 'ready');
  assert.equal(receipt.bindings[0].operational_state, 'ready');
  assert.deepEqual(receipt.bindings[0].reasons, []);
});

test('adapter class mismatch fails the required binding instead of fuzzy matching', () => {
  const compiled = compileAtlasModuleDefinition(baseDefinition());
  const receipt = validateAtlasModuleOperationalBindings(compiled, {
    connectors: [{
      id: connectorId,
      schema_id: schemaId,
      adapter_class: 'similarButWrongAdapter',
      active: true,
    }],
    schemas: [{ id: schemaId, active: true }],
  });
  assert.equal(receipt.operational_state, 'blocked');
  assert.deepEqual(receipt.bindings[0].reasons, ['adapter_class_mismatch']);
});

test('module compiler rejects unknown receipt authority and unknown lens', () => {
  assert.throws(() => compileAtlasModuleDefinition({
    ...baseDefinition(),
    receipt_requirements: ['make_a_legal_conclusion'],
  }), /receipt_requirement_unknown/);

  assert.throws(() => compileAtlasModuleDefinition({
    ...baseDefinition(),
    structural_lens_stack: {
      stack_id: 'bad',
      lenses: [{ lens_id: 'predict_who_wins', weight: 1 }],
    },
  }), /lens_not_registered/);
});

test('module compiler rejects hidden convergence configuration fields', () => {
  assert.throws(() => compileAtlasModuleDefinition({
    ...baseDefinition(),
    convergence_configuration: {
      ...baseDefinition().convergence_configuration,
      secret_adjustment: 0.3,
    },
  }), /configuration_key_not_allowed/);
});

test('module compiler rejects a high-impact lens contract that requires but omits disconfirmation', () => {
  assert.throws(() => compileAtlasModuleDefinition({
    ...baseDefinition(),
    structural_lens_stack: {
      stack_id: 'missing_disconfirmation',
      lenses: [{ lens_id: 'recurrence', weight: 1 }],
      require_disconfirmation: true,
    },
  }), /lens_disconfirmation_required/);
});

test('compiled module identity includes registered lens versions and its registry generation', () => {
  const compiled = compileAtlasModuleDefinition(baseDefinition());
  assert.equal(compiled.structural_lens_stack.lens_registry_version, STRUCTURAL_LENS_REGISTRY_VERSION);
  assert.equal(compiled.structural_lens_stack.lenses.every((lens) => lens.lens_version === '1.0.0'), true);
  const { module_definition_hash, ...payload } = compiled;
  assert.equal(module_definition_hash, sha256(payload));

  const modified = JSON.parse(JSON.stringify(compiled));
  modified.structural_lens_stack.lenses[0].lens_version = '2.0.0';
  assert.throws(() => validateAtlasModuleOperationalBindings(modified, {
    connectors: [],
    schemas: [],
  }), /atlas_module_definition_hash_mismatch/);
});

test('non-boolean disconfirmation requirements fail closed instead of silently disabling the guard', () => {
  for (const value of ['true', 1, null]) {
    const definition = baseDefinition();
    definition.structural_lens_stack.require_disconfirmation = value;
    assert.throws(() => compileAtlasModuleDefinition(definition),
      /atlas_module_lens_require_disconfirmation_must_be_boolean/);
  }
});

test('operational readiness rejects mutated compiled adapter identities with stale hashes', () => {
  const compiled = compileAtlasModuleDefinition(baseDefinition());
  const untrusted = JSON.parse(JSON.stringify(compiled));
  untrusted.adapter_bindings[0].connector_id = 'malicious-connector';
  const matchingRegistry = {
    connectors: [{
      id: 'malicious-connector',
      schema_id: schemaId,
      adapter_class: 'civicGenomeVersionBindingAdapter',
      active: true,
    }],
    schemas: [{ id: schemaId, active: true }],
  };
  assert.throws(() => validateAtlasModuleOperationalBindings(untrusted, matchingRegistry),
    /atlas_module_definition_hash_mismatch/);

  const serialized = JSON.parse(JSON.stringify(compiled));
  assert.equal(validateAtlasModuleOperationalBindings(serialized, {
    connectors: [{
      id: connectorId,
      schema_id: schemaId,
      adapter_class: 'civicGenomeVersionBindingAdapter',
      active: true,
    }],
    schemas: [{ id: schemaId, active: true }],
  }).operational_state, 'ready');
});
