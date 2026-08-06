import { sha256 } from '../substrate/canonical.js';

export const STRUCTURAL_LENS_CONTRACT_VERSION = '1.0.0';
export const STRUCTURAL_LENS_REGISTRY_VERSION = 'atlas-structural-lenses-1.0.0';

const LENS_DEFINITIONS = Object.freeze([
  ['recurrence', 'Repeated structural occurrence across declared observations or generations.'],
  ['contradiction', 'Structurally incompatible observations or governed assertions are present.'],
  ['suppression', 'A declared relationship or pathway reduces, blocks, or removes another structure.'],
  ['amplification', 'A declared relationship or pathway increases or reinforces another structure.'],
  ['dependency', 'One structure requires another structure or state to operate.'],
  ['authority_concentration', 'Declared authority or control relationships converge on a constrained actor or node set.'],
  ['burden_shift', 'Declared duties, costs, risks, or process burden move between identified actors or groups.'],
  ['temporal_acceleration', 'Comparable structural events occur at a deterministically increasing temporal rate.'],
  ['geographic_diffusion', 'Comparable structural signals spread across governed geographic partitions.'],
  ['cross_jurisdiction_recurrence', 'Comparable structural signals recur across distinct governed jurisdictions.'],
  ['weak_joint', 'A pathway contains a declared structural dependency with low redundancy or unresolved continuity.'],
  ['orphaned_pathway', 'A declared workflow or relationship path terminates without a governed continuation.'],
  ['disconfirmation', 'Evidence exists that reduces, contradicts, or limits another structural interpretation.'],
].map(([lens_id, description]) => Object.freeze({
  lens_id,
  lens_version: '1.0.0',
  description,
  engine_semantics: 'structural_only',
})));

const LENS_BY_ID = Object.freeze(Object.fromEntries(LENS_DEFINITIONS.map((lens) => [lens.lens_id, lens])));
const STATUS_VALUES = new Set(['observed', 'not_observed', 'unresolved']);

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}_must_be_object`);
}

function normalizeEvidenceIds(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label}_must_be_array`);
  return Object.freeze([...new Set(value.map((entry) => {
    if (typeof entry !== 'string' || entry.trim() === '') throw new Error(`${label}_invalid_entry`);
    return entry.trim();
  }))].sort());
}

function normalizeWeight(value, lensId) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`structural_lens_weight_out_of_range:${lensId}`);
  }
  return value;
}

function normalizeActivation(entry) {
  assertPlainObject(entry, 'structural_lens_activation');
  const lens_id = typeof entry.lens_id === 'string' ? entry.lens_id.trim() : '';
  const definition = LENS_BY_ID[lens_id];
  if (!definition) throw new Error(`structural_lens_not_registered:${lens_id || 'missing'}`);
  const status = typeof entry.status === 'string' ? entry.status.trim() : '';
  if (!STATUS_VALUES.has(status)) throw new Error(`structural_lens_status_invalid:${lens_id}`);
  const evidence_ids = normalizeEvidenceIds(entry.evidence_ids ?? [], `structural_lens_${lens_id}_evidence_ids`);
  let score = null;
  if (status === 'observed') {
    if (!Number.isFinite(entry.score) || entry.score < 0 || entry.score > 1) {
      throw new Error(`structural_lens_score_out_of_range:${lens_id}`);
    }
    if (evidence_ids.length === 0) throw new Error(`structural_lens_observed_requires_evidence:${lens_id}`);
    score = entry.score;
  } else if (status === 'not_observed') {
    if (entry.score !== undefined && entry.score !== null && entry.score !== 0) {
      throw new Error(`structural_lens_not_observed_score_must_be_zero:${lens_id}`);
    }
    score = 0;
  } else if (entry.score !== undefined && entry.score !== null) {
    throw new Error(`structural_lens_unresolved_score_must_be_null:${lens_id}`);
  }
  return Object.freeze({
    lens_id,
    lens_version: definition.lens_version,
    status,
    score,
    evidence_ids,
    evidence_hash: sha256(evidence_ids),
  });
}

function normalizeStackEntry(entry) {
  assertPlainObject(entry, 'structural_lens_stack_entry');
  const lens_id = typeof entry.lens_id === 'string' ? entry.lens_id.trim() : '';
  const definition = LENS_BY_ID[lens_id];
  if (!definition) throw new Error(`structural_lens_not_registered:${lens_id || 'missing'}`);
  return Object.freeze({
    lens_id,
    lens_version: definition.lens_version,
    weight: normalizeWeight(entry.weight, lens_id),
  });
}

export function listStructuralLenses() {
  return LENS_DEFINITIONS;
}

export function resolveStructuralLensStack({
  stack_id,
  lenses,
  activations,
  require_disconfirmation = false,
} = {}) {
  if (typeof stack_id !== 'string' || stack_id.trim() === '') throw new Error('structural_lens_stack_id_required');
  if (!Array.isArray(lenses) || lenses.length === 0) throw new Error('structural_lens_stack_requires_lenses');
  if (!Array.isArray(activations)) throw new Error('structural_lens_activations_must_be_array');
  if (typeof require_disconfirmation !== 'boolean') throw new Error('structural_lens_require_disconfirmation_must_be_boolean');

  const stack = lenses.map(normalizeStackEntry).sort((a, b) => a.lens_id.localeCompare(b.lens_id));
  const duplicateStackIds = stack.filter((entry, index) => index > 0 && stack[index - 1].lens_id === entry.lens_id);
  if (duplicateStackIds.length > 0) throw new Error(`structural_lens_stack_duplicate:${duplicateStackIds[0].lens_id}`);

  const weight_sum = stack.reduce((total, entry) => total + entry.weight, 0);
  if (Math.abs(weight_sum - 1) > 1e-12) throw new Error(`structural_lens_weight_sum_invalid:${weight_sum}`);
  if (require_disconfirmation && !stack.some((entry) => entry.lens_id === 'disconfirmation')) {
    throw new Error('structural_lens_disconfirmation_required');
  }

  const normalizedActivations = activations.map(normalizeActivation).sort((a, b) => a.lens_id.localeCompare(b.lens_id));
  const activationMap = new Map();
  for (const activation of normalizedActivations) {
    if (activationMap.has(activation.lens_id)) throw new Error(`structural_lens_activation_duplicate:${activation.lens_id}`);
    activationMap.set(activation.lens_id, activation);
  }

  const resolved = stack.map((entry) => {
    const activation = activationMap.get(entry.lens_id);
    if (!activation) {
      return Object.freeze({
        ...entry,
        status: 'unresolved',
        score: null,
        evidence_ids: Object.freeze([]),
        evidence_hash: sha256([]),
        unresolved_reason: 'activation_not_supplied',
      });
    }
    return Object.freeze({ ...entry, ...activation, unresolved_reason: null });
  });

  const unusedActivations = normalizedActivations.filter((activation) => !stack.some((entry) => entry.lens_id === activation.lens_id));
  if (unusedActivations.length > 0) {
    throw new Error(`structural_lens_activation_not_in_stack:${unusedActivations[0].lens_id}`);
  }

  const unresolved = resolved.filter((entry) => entry.status === 'unresolved');
  const observed = resolved.filter((entry) => entry.status === 'observed');
  const notObserved = resolved.filter((entry) => entry.status === 'not_observed');
  const stack_status = unresolved.length > 0 ? 'incomplete' : 'complete';
  const blended_score = stack_status === 'complete'
    ? resolved.reduce((total, entry) => total + (entry.weight * entry.score), 0)
    : null;
  if (blended_score !== null && (blended_score < 0 || blended_score > 1)) {
    throw new Error('structural_lens_blended_score_out_of_range');
  }

  const receiptPayload = {
    contract_version: STRUCTURAL_LENS_CONTRACT_VERSION,
    registry_version: STRUCTURAL_LENS_REGISTRY_VERSION,
    stack_id: stack_id.trim(),
    require_disconfirmation,
    stack,
    stack_hash: sha256(stack),
    resolved,
    resolved_hash: sha256(resolved),
    stack_status,
    blended_score,
    counts: Object.freeze({
      total: resolved.length,
      observed: observed.length,
      not_observed: notObserved.length,
      unresolved: unresolved.length,
    }),
  };

  return Object.freeze({
    ...receiptPayload,
    receipt_identity: sha256(receiptPayload),
  });
}
