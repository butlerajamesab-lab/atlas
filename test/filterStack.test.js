import assert from 'node:assert/strict';
import test from 'node:test';

import { sha256 } from '../src/substrate/canonical.js';
import { createInputManifest } from '../src/substrate/manifest.js';
import {
  DEFAULT_HARDENED_FILTERS,
  FILTER_REGISTRY_VERSION,
  listAtlasFilters,
  resolveAtlasFilterStack,
} from '../src/filters/filterStack.js';

const manifestBase = Object.freeze({
  computation_type: 'filter_stack_fixture',
  rule_manifest_hash: 'a'.repeat(64),
  as_of: 1_785_542_400_000,
  configuration: { fixture: true },
  source_population_hash: 'b'.repeat(64),
  signal_count: 2,
});

test('registry is deterministic and Atlas-owned hardened filters are explicit', () => {
  assert.deepEqual(listAtlasFilters(), listAtlasFilters());
  assert.deepEqual(DEFAULT_HARDENED_FILTERS, [
    'canonical_source_identity_required',
    'unresolved_state_preservation',
    'contradiction_state_preservation',
    'provenance_trace_preservation',
  ]);
  assert.equal(listAtlasFilters().filter((filter) => filter.permission_level === 'hardened').length, 4);
});

test('resolver inserts hardened filters even when user requests only exploratory scope', () => {
  const result = resolveAtlasFilterStack({
    requested_filters: [{
      filter_id: 'jurisdiction_scope',
      parameters: { jurisdiction_ids: ['WA', 'OR'] },
    }],
  });
  const ids = result.trace.effective_filters.map((filter) => filter.filter_id);
  for (const hardened of DEFAULT_HARDENED_FILTERS) assert.ok(ids.includes(hardened));
  assert.ok(ids.includes('jurisdiction_scope'));
  assert.equal(result.trace.execution_allowed, true);
  assert.match(result.receipt_identity, /^[0-9a-f]{64}$/);
});

test('hardened filter disable attempt is blocked but protection remains effective', () => {
  const result = resolveAtlasFilterStack({
    requested_filters: [{ filter_id: 'unresolved_state_preservation', enabled: false }],
  });
  assert.deepEqual(result.trace.blocked_user_filters, [{
    filter_id: 'unresolved_state_preservation',
    reason: 'hardened_filter_cannot_be_disabled',
  }]);
  assert.ok(result.trace.effective_filters.some((filter) => filter.filter_id === 'unresolved_state_preservation'));
});

test('requested, module, domain, and hardened filters compose deterministically', () => {
  const input = {
    requested_filters: [{ filter_id: 'signal_type_scope', parameters: { signal_types: ['override', 'workflow'] } }],
    module_required_filters: [{ filter_id: 'convergence_window', parameters: { minimum_signal_count: 3, window_ms: 86400000 } }],
    domain_required_filters: [{ filter_id: 'domain_space_scope', parameters: { space_types: ['document_lineage'] } }],
  };
  const first = resolveAtlasFilterStack(input);
  const second = resolveAtlasFilterStack({
    ...input,
    requested_filters: [{ filter_id: 'signal_type_scope', parameters: { signal_types: ['workflow', 'override'] } }],
  });
  assert.equal(first.registry_version, FILTER_REGISTRY_VERSION);
  assert.equal(first.effective_filter_hash, second.effective_filter_hash);
  assert.equal(first.receipt_identity, second.receipt_identity);
});

test('unknown filters fail closed instead of being ignored', () => {
  assert.throws(() => resolveAtlasFilterStack({
    requested_filters: ['not_a_real_filter'],
  }), /filter_not_registered/);
});

test('parameter keys and bounded parameters fail closed', () => {
  assert.throws(() => resolveAtlasFilterStack({
    requested_filters: [{ filter_id: 'source_scope', parameters: { magic_guess: true } }],
  }), /filter_parameter_not_allowed/);

  assert.throws(() => resolveAtlasFilterStack({
    requested_filters: [{ filter_id: 'provenance_threshold', parameters: { minimum_confidence: 1.1 } }],
  }), /filter_parameter_out_of_range/);

  assert.throws(() => resolveAtlasFilterStack({
    requested_filters: [{ filter_id: 'convergence_window', parameters: { minimum_signal_count: 1 } }],
  }), /filter_parameter_out_of_range/);
});

test('conflicting parameterizations of the same required filter fail closed', () => {
  assert.throws(() => resolveAtlasFilterStack({
    module_required_filters: [{
      filter_id: 'provenance_threshold',
      parameters: { minimum_confidence: 0.7 },
    }],
    domain_required_filters: [{
      filter_id: 'provenance_threshold',
      parameters: { minimum_confidence: 0.8 },
    }],
  }), /filter_stack_conflicting_parameters/);
});

test('filter receipt preserves requested and effective context separately', () => {
  const result = resolveAtlasFilterStack({
    requested_filters: [{ filter_id: 'source_scope', parameters: { source_ids: ['source-b', 'source-a'] } }],
  });
  assert.deepEqual(result.trace.requested_filters[0].parameters.source_ids, ['source-a', 'source-b']);
  assert.equal(result.trace.requested_filters.length, 1);
  assert.ok(result.trace.effective_filters.length > result.trace.requested_filters.length);
  assert.notEqual(result.effective_filter_hash, result.receipt_identity);
});

test('filter stack receipt identity is bound into governed manifest hash only when supplied', () => {
  const stack = resolveAtlasFilterStack({ requested_filters: ['signal_type_scope'] });
  const legacy = createInputManifest(manifestBase);
  const governed = createInputManifest({
    ...manifestBase,
    filter_stack_receipt_identity: stack.receipt_identity,
  });
  assert.equal(Object.hasOwn(legacy, 'filter_stack_receipt_identity'), false);
  assert.equal(governed.filter_stack_receipt_identity, stack.receipt_identity);
  assert.notEqual(sha256(legacy), sha256(governed));
});

test('invalid filter stack manifest identity fails closed', () => {
  assert.throws(() => createInputManifest({
    ...manifestBase,
    filter_stack_receipt_identity: 'not-a-hash',
  }), /filter_stack_receipt_identity/);
});

test('exported filter registry cannot be extended through nested permission arrays', () => {
  const definition = listAtlasFilters().find((filter) => filter.filter_id === 'source_scope');
  const originalAllow = [...definition.parameter_contract.allow];
  assert.equal(Object.isFrozen(definition.parameter_contract.allow), true);
  assert.throws(() => definition.parameter_contract.allow.push('undeclared_parameter'), TypeError);
  assert.deepEqual(definition.parameter_contract.allow, originalAllow);
  assert.throws(() => resolveAtlasFilterStack({
    requested_filters: [{ filter_id: 'source_scope', parameters: { undeclared_parameter: 'x' } }],
  }), /filter_parameter_not_allowed/);
});

test('receipt parameter arrays are immutable across requested trace and effective filters', () => {
  const receipt = resolveAtlasFilterStack({
    requested_filters: [{
      filter_id: 'source_scope',
      parameters: { source_ids: ['source-b', 'source-a'] },
    }],
  });
  const requested = receipt.trace.requested_filters[0].parameters.source_ids;
  const effective = receipt.trace.effective_filters.find((entry) => entry.filter_id === 'source_scope').parameters.source_ids;
  assert.equal(Object.isFrozen(requested), true);
  assert.equal(Object.isFrozen(effective), true);
  assert.throws(() => requested.push('unbound'), TypeError);
  assert.throws(() => effective.push('unbound'), TypeError);
  assert.deepEqual(requested, ['source-a', 'source-b']);
  assert.equal(sha256(receipt.trace.effective_filters), receipt.effective_filter_hash);
  assert.equal(sha256({
    contract_version: receipt.contract_version,
    registry_version: receipt.registry_version,
    trace: receipt.trace,
    effective_filter_hash: receipt.effective_filter_hash,
  }), receipt.receipt_identity);
});

test('permuting filter groups cannot change the deterministic complete receipt identity', () => {
  const original = resolveAtlasFilterStack({
    requested_filters: [
      { filter_id: 'source_scope', parameters: { source_ids: ['a', 'b'] } },
      { filter_id: 'jurisdiction_scope', parameters: { jurisdiction_ids: ['WA'] } },
    ],
    module_required_filters: ['provenance_threshold', 'convergence_window'],
    domain_required_filters: ['relationship_scope', 'actor_entity_scope'],
    system_required_hardened_filters: [
      'canonical_source_identity_required',
      'unresolved_state_preservation',
    ],
  });
  const reordered = resolveAtlasFilterStack({
    requested_filters: [
      { filter_id: 'jurisdiction_scope', parameters: { jurisdiction_ids: ['WA'] } },
      { filter_id: 'source_scope', parameters: { source_ids: ['b', 'a'] } },
    ],
    module_required_filters: ['convergence_window', 'provenance_threshold'],
    domain_required_filters: ['actor_entity_scope', 'relationship_scope'],
    system_required_hardened_filters: [
      'unresolved_state_preservation',
      'canonical_source_identity_required',
    ],
  });
  assert.deepEqual(original.trace, reordered.trace);
  assert.equal(original.effective_filter_hash, reordered.effective_filter_hash);
  assert.equal(original.receipt_identity, reordered.receipt_identity);
});
