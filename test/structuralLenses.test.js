import assert from 'node:assert/strict';
import test from 'node:test';

import { sha256 } from '../src/substrate/canonical.js';
import { createInputManifest } from '../src/substrate/manifest.js';
import {
  listStructuralLenses,
  resolveStructuralLensStack,
} from '../src/lenses/structuralLenses.js';

const stack = Object.freeze([
  { lens_id: 'recurrence', weight: 0.4 },
  { lens_id: 'contradiction', weight: 0.3 },
  { lens_id: 'disconfirmation', weight: 0.3 },
]);

const completeActivations = Object.freeze([
  { lens_id: 'recurrence', status: 'observed', score: 0.8, evidence_ids: ['e2', 'e1'] },
  { lens_id: 'contradiction', status: 'not_observed', score: 0, evidence_ids: [] },
  { lens_id: 'disconfirmation', status: 'observed', score: 0.2, evidence_ids: ['d1'] },
]);

const manifestBase = Object.freeze({
  computation_type: 'structural_lens_fixture',
  rule_manifest_hash: 'a'.repeat(64),
  as_of: 1_785_542_400_000,
  configuration: { fixture: true },
  source_population_hash: 'b'.repeat(64),
  signal_count: 3,
});

test('structural lens registry is deterministic and contains structural-only lenses', () => {
  assert.deepEqual(listStructuralLenses(), listStructuralLenses());
  assert.ok(listStructuralLenses().some((lens) => lens.lens_id === 'burden_shift'));
  assert.ok(listStructuralLenses().some((lens) => lens.lens_id === 'orphaned_pathway'));
  assert.equal(listStructuralLenses().every((lens) => lens.engine_semantics === 'structural_only'), true);
});

test('complete lens stack produces deterministic blended receipt', () => {
  const left = resolveStructuralLensStack({
    stack_id: 'fixture',
    lenses: stack,
    activations: completeActivations,
    require_disconfirmation: true,
  });
  const right = resolveStructuralLensStack({
    stack_id: 'fixture',
    lenses: [...stack].reverse(),
    activations: [...completeActivations].reverse(),
    require_disconfirmation: true,
  });
  assert.equal(left.stack_status, 'complete');
  assert.equal(left.blended_score, 0.38);
  assert.equal(left.receipt_identity, right.receipt_identity);
  assert.deepEqual(left.resolved.find((item) => item.lens_id === 'recurrence').evidence_ids, ['e1', 'e2']);
});

test('missing activation remains unresolved and blocks blended score', () => {
  const result = resolveStructuralLensStack({
    stack_id: 'incomplete_fixture',
    lenses: stack,
    activations: completeActivations.filter((entry) => entry.lens_id !== 'contradiction'),
  });
  assert.equal(result.stack_status, 'incomplete');
  assert.equal(result.blended_score, null);
  assert.equal(result.counts.unresolved, 1);
  const unresolved = result.resolved.find((entry) => entry.lens_id === 'contradiction');
  assert.equal(unresolved.unresolved_reason, 'activation_not_supplied');
});

test('observed lenses require evidence and bounded score', () => {
  assert.throws(() => resolveStructuralLensStack({
    stack_id: 'bad',
    lenses: [{ lens_id: 'recurrence', weight: 1 }],
    activations: [{ lens_id: 'recurrence', status: 'observed', score: 0.8, evidence_ids: [] }],
  }), /observed_requires_evidence/);

  assert.throws(() => resolveStructuralLensStack({
    stack_id: 'bad',
    lenses: [{ lens_id: 'recurrence', weight: 1 }],
    activations: [{ lens_id: 'recurrence', status: 'observed', score: 2, evidence_ids: ['e1'] }],
  }), /score_out_of_range/);
});

test('unresolved lens cannot carry a fabricated numeric score', () => {
  assert.throws(() => resolveStructuralLensStack({
    stack_id: 'bad',
    lenses: [{ lens_id: 'weak_joint', weight: 1 }],
    activations: [{ lens_id: 'weak_joint', status: 'unresolved', score: 0.5, evidence_ids: ['e1'] }],
  }), /unresolved_score_must_be_null/);
});

test('weights must be explicit, bounded, unique, and sum to one', () => {
  assert.throws(() => resolveStructuralLensStack({
    stack_id: 'bad_sum',
    lenses: [{ lens_id: 'recurrence', weight: 0.8 }],
    activations: [],
  }), /weight_sum_invalid/);

  assert.throws(() => resolveStructuralLensStack({
    stack_id: 'duplicate',
    lenses: [{ lens_id: 'recurrence', weight: 0.5 }, { lens_id: 'recurrence', weight: 0.5 }],
    activations: [],
  }), /stack_duplicate/);
});

test('disconfirmation requirement is explicit and fail closed', () => {
  assert.throws(() => resolveStructuralLensStack({
    stack_id: 'requires_disconfirmation',
    lenses: [{ lens_id: 'recurrence', weight: 1 }],
    activations: [],
    require_disconfirmation: true,
  }), /disconfirmation_required/);
});

test('activation not declared in stack is rejected rather than silently ignored', () => {
  assert.throws(() => resolveStructuralLensStack({
    stack_id: 'unused_activation',
    lenses: [{ lens_id: 'recurrence', weight: 1 }],
    activations: [{ lens_id: 'contradiction', status: 'not_observed', evidence_ids: [] }],
  }), /activation_not_in_stack/);
});

test('structural lens receipt identity binds governed manifest only when supplied', () => {
  const lensReceipt = resolveStructuralLensStack({
    stack_id: 'manifest_fixture',
    lenses: stack,
    activations: completeActivations,
  });
  const legacy = createInputManifest(manifestBase);
  const governed = createInputManifest({
    ...manifestBase,
    structural_lens_receipt_identity: lensReceipt.receipt_identity,
  });
  assert.equal(Object.hasOwn(legacy, 'structural_lens_receipt_identity'), false);
  assert.equal(governed.structural_lens_receipt_identity, lensReceipt.receipt_identity);
  assert.notEqual(sha256(legacy), sha256(governed));
});

test('invalid structural lens manifest identity fails closed', () => {
  assert.throws(() => createInputManifest({
    ...manifestBase,
    structural_lens_receipt_identity: 'bad',
  }), /structural_lens_receipt_identity/);
});
