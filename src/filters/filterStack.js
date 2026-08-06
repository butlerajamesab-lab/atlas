import { sha256 } from '../substrate/canonical.js';

export const FILTER_STACK_CONTRACT_VERSION = '1.0.0';
export const FILTER_REGISTRY_VERSION = 'atlas-filter-registry-1.0.0';

export const FILTER_PERMISSION_LEVELS = Object.freeze([
  'user_swappable',
  'governed',
  'hardened',
]);

export const FILTER_CATEGORIES = Object.freeze([
  'source',
  'signal_type',
  'domain_space',
  'jurisdiction',
  'time_window',
  'actor_entity',
  'relationship',
  'provenance',
  'convergence',
  'deduplication_exclusion',
  'integrity',
]);

const CATEGORY_ORDER = new Map(FILTER_CATEGORIES.map((category, index) => [category, index]));
const PERMISSION_RANK = Object.freeze({ user_swappable: 1, governed: 2, hardened: 3 });

function freezeFilter(definition) {
  return Object.freeze({
    filter_id: definition.filter_id,
    filter_version: definition.filter_version,
    filter_category: definition.filter_category,
    permission_level: definition.permission_level,
    description: definition.description,
    parameter_contract: Object.freeze(definition.parameter_contract ?? {}),
  });
}

const FILTERS = Object.freeze({
  source_scope: freezeFilter({
    filter_id: 'source_scope',
    filter_version: '1.0.0',
    filter_category: 'source',
    permission_level: 'user_swappable',
    description: 'Limit a computation to declared source identities or source families.',
    parameter_contract: { allow: ['source_ids', 'source_families'] },
  }),
  signal_type_scope: freezeFilter({
    filter_id: 'signal_type_scope',
    filter_version: '1.0.0',
    filter_category: 'signal_type',
    permission_level: 'user_swappable',
    description: 'Limit a computation to declared signal types.',
    parameter_contract: { allow: ['signal_types'] },
  }),
  domain_space_scope: freezeFilter({
    filter_id: 'domain_space_scope',
    filter_version: '1.0.0',
    filter_category: 'domain_space',
    permission_level: 'governed',
    description: 'Bind a computation to a declared Atlas domain-space definition.',
    parameter_contract: { allow: ['space_types', 'space_definition_hashes'] },
  }),
  jurisdiction_scope: freezeFilter({
    filter_id: 'jurisdiction_scope',
    filter_version: '1.0.0',
    filter_category: 'jurisdiction',
    permission_level: 'user_swappable',
    description: 'Limit a computation to declared jurisdiction identities.',
    parameter_contract: { allow: ['jurisdiction_ids'] },
  }),
  time_window_scope: freezeFilter({
    filter_id: 'time_window_scope',
    filter_version: '1.0.0',
    filter_category: 'time_window',
    permission_level: 'governed',
    description: 'Apply an explicit bounded temporal window.',
    parameter_contract: { allow: ['start', 'end', 'as_of'] },
  }),
  actor_entity_scope: freezeFilter({
    filter_id: 'actor_entity_scope',
    filter_version: '1.0.0',
    filter_category: 'actor_entity',
    permission_level: 'user_swappable',
    description: 'Limit a computation to declared canonical entity identities.',
    parameter_contract: { allow: ['entity_ids', 'entity_types'] },
  }),
  relationship_scope: freezeFilter({
    filter_id: 'relationship_scope',
    filter_version: '1.0.0',
    filter_category: 'relationship',
    permission_level: 'user_swappable',
    description: 'Limit a computation to declared structural relationship types.',
    parameter_contract: { allow: ['relationship_types'] },
  }),
  provenance_threshold: freezeFilter({
    filter_id: 'provenance_threshold',
    filter_version: '1.0.0',
    filter_category: 'provenance',
    permission_level: 'governed',
    description: 'Require a declared minimum provenance confidence for included signals.',
    parameter_contract: { allow: ['minimum_confidence'] },
  }),
  convergence_window: freezeFilter({
    filter_id: 'convergence_window',
    filter_version: '1.0.0',
    filter_category: 'convergence',
    permission_level: 'governed',
    description: 'Bind convergence to explicit minimum evidence and time-window conditions.',
    parameter_contract: { allow: ['minimum_signal_count', 'window_ms'] },
  }),
  deterministic_deduplication: freezeFilter({
    filter_id: 'deterministic_deduplication',
    filter_version: '1.0.0',
    filter_category: 'deduplication_exclusion',
    permission_level: 'governed',
    description: 'Apply a declared deterministic deduplication identity.',
    parameter_contract: { allow: ['fingerprint_rule_id'] },
  }),
  canonical_source_identity_required: freezeFilter({
    filter_id: 'canonical_source_identity_required',
    filter_version: '1.0.0',
    filter_category: 'integrity',
    permission_level: 'hardened',
    description: 'Prevent a governed Atlas computation from treating unbound source identity as canonical evidence.',
    parameter_contract: { allow: [] },
  }),
  unresolved_state_preservation: freezeFilter({
    filter_id: 'unresolved_state_preservation',
    filter_version: '1.0.0',
    filter_category: 'integrity',
    permission_level: 'hardened',
    description: 'Preserve unresolved states in computation receipts instead of filtering them away silently.',
    parameter_contract: { allow: [] },
  }),
  contradiction_state_preservation: freezeFilter({
    filter_id: 'contradiction_state_preservation',
    filter_version: '1.0.0',
    filter_category: 'integrity',
    permission_level: 'hardened',
    description: 'Preserve contradiction/disconfirmation evidence in Atlas-owned receipts.',
    parameter_contract: { allow: [] },
  }),
  provenance_trace_preservation: freezeFilter({
    filter_id: 'provenance_trace_preservation',
    filter_version: '1.0.0',
    filter_category: 'integrity',
    permission_level: 'hardened',
    description: 'Require source and transformation provenance to remain attached to governed results.',
    parameter_contract: { allow: [] },
  }),
});

export const DEFAULT_HARDENED_FILTERS = Object.freeze([
  'canonical_source_identity_required',
  'unresolved_state_preservation',
  'contradiction_state_preservation',
  'provenance_trace_preservation',
]);

function asPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}_must_be_object`);
  }
  return value;
}

function normalizeStringArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label}_must_be_array`);
  return [...new Set(value.map((entry) => {
    if (typeof entry !== 'string' || entry.trim() === '') throw new Error(`${label}_invalid_entry`);
    return entry.trim();
  }))].sort();
}

function normalizeScalar(value, label) {
  if (value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new Error(`${label}_invalid_scalar`);
}

function normalizeParameters(definition, parameters = {}) {
  asPlainObject(parameters, `filter_${definition.filter_id}_parameters`);
  const allowed = new Set(definition.parameter_contract.allow ?? []);
  const keys = Object.keys(parameters).sort();
  for (const key of keys) {
    if (!allowed.has(key)) throw new Error(`filter_parameter_not_allowed:${definition.filter_id}:${key}`);
  }
  const normalized = {};
  for (const key of keys) {
    const value = parameters[key];
    normalized[key] = Array.isArray(value)
      ? normalizeStringArray(value, `filter_${definition.filter_id}_${key}`)
      : normalizeScalar(value, `filter_${definition.filter_id}_${key}`);
  }

  if (definition.filter_id === 'provenance_threshold' && normalized.minimum_confidence !== undefined) {
    const value = normalized.minimum_confidence;
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error('filter_parameter_out_of_range:provenance_threshold:minimum_confidence');
    }
  }
  if (definition.filter_id === 'convergence_window') {
    if (normalized.minimum_signal_count !== undefined
      && (!Number.isSafeInteger(normalized.minimum_signal_count) || normalized.minimum_signal_count < 2)) {
      throw new Error('filter_parameter_out_of_range:convergence_window:minimum_signal_count');
    }
    if (normalized.window_ms !== undefined
      && (!Number.isSafeInteger(normalized.window_ms) || normalized.window_ms <= 0)) {
      throw new Error('filter_parameter_out_of_range:convergence_window:window_ms');
    }
  }
  if (definition.filter_id === 'time_window_scope') {
    if (normalized.as_of !== undefined && !Number.isFinite(normalized.as_of)) {
      throw new Error('filter_parameter_out_of_range:time_window_scope:as_of');
    }
    for (const key of ['start', 'end']) {
      if (normalized[key] !== undefined && normalized[key] !== null
        && !Number.isFinite(Date.parse(String(normalized[key])))) {
        throw new Error(`filter_parameter_invalid_time:time_window_scope:${key}`);
      }
    }
  }
  return Object.freeze(normalized);
}

function normalizeRequest(entry, source) {
  if (typeof entry === 'string') entry = { filter_id: entry };
  asPlainObject(entry, 'filter_request');
  const filter_id = typeof entry.filter_id === 'string' ? entry.filter_id.trim() : '';
  if (!filter_id) throw new Error('filter_request_id_required');
  const definition = FILTERS[filter_id];
  if (!definition) throw new Error(`filter_not_registered:${filter_id}`);
  const enabled = entry.enabled !== false;
  const parameters = normalizeParameters(definition, entry.parameters ?? {});
  return Object.freeze({
    filter_id,
    enabled,
    parameters,
    source,
    filter_version: definition.filter_version,
    filter_category: definition.filter_category,
    permission_level: definition.permission_level,
  });
}

function filterSort(left, right) {
  const category = (CATEGORY_ORDER.get(left.filter_category) ?? 999) - (CATEGORY_ORDER.get(right.filter_category) ?? 999);
  if (category !== 0) return category;
  const permission = PERMISSION_RANK[right.permission_level] - PERMISSION_RANK[left.permission_level];
  if (permission !== 0) return permission;
  return left.filter_id.localeCompare(right.filter_id);
}

function requestIdentity(entry) {
  return `${entry.filter_id}:${sha256(entry.parameters)}`;
}

export function listAtlasFilters() {
  return Object.freeze(Object.values(FILTERS).sort(filterSort));
}

export function resolveAtlasFilterStack({
  requested_filters = [],
  module_required_filters = [],
  domain_required_filters = [],
  system_required_hardened_filters = DEFAULT_HARDENED_FILTERS,
} = {}) {
  const groups = [
    ['requested', requested_filters],
    ['module_required', module_required_filters],
    ['domain_required', domain_required_filters],
    ['system_required_hardened', system_required_hardened_filters],
  ];
  for (const [label, values] of groups) {
    if (!Array.isArray(values)) throw new Error(`filter_stack_${label}_must_be_array`);
  }

  const normalizedGroups = Object.fromEntries(groups.map(([label, values]) => [
    label,
    values.map((entry) => normalizeRequest(entry, label)),
  ]));

  for (const entry of normalizedGroups.system_required_hardened) {
    if (entry.permission_level !== 'hardened') {
      throw new Error(`filter_stack_system_required_not_hardened:${entry.filter_id}`);
    }
    if (!entry.enabled) throw new Error(`filter_stack_hardened_cannot_be_disabled:${entry.filter_id}`);
  }

  const blocked_user_filters = [];
  const candidates = new Map();

  for (const entry of normalizedGroups.system_required_hardened) {
    candidates.set(requestIdentity(entry), entry);
  }
  for (const groupName of ['module_required', 'domain_required']) {
    for (const entry of normalizedGroups[groupName]) {
      if (!entry.enabled) throw new Error(`filter_stack_required_filter_disabled:${entry.filter_id}`);
      candidates.set(requestIdentity(entry), entry);
    }
  }

  for (const entry of normalizedGroups.requested) {
    if (!entry.enabled && entry.permission_level === 'hardened') {
      blocked_user_filters.push(Object.freeze({
        filter_id: entry.filter_id,
        reason: 'hardened_filter_cannot_be_disabled',
      }));
      continue;
    }
    if (!entry.enabled) continue;
    candidates.set(requestIdentity(entry), entry);
  }

  const byFilterId = new Map();
  for (const entry of candidates.values()) {
    const existing = byFilterId.get(entry.filter_id);
    if (!existing) {
      byFilterId.set(entry.filter_id, entry);
      continue;
    }
    const sameParameters = sha256(existing.parameters) === sha256(entry.parameters);
    if (!sameParameters) {
      throw new Error(`filter_stack_conflicting_parameters:${entry.filter_id}`);
    }
    if (PERMISSION_RANK[entry.permission_level] > PERMISSION_RANK[existing.permission_level]) {
      byFilterId.set(entry.filter_id, entry);
    }
  }

  const effective_filters = [...byFilterId.values()].sort(filterSort).map((entry) => Object.freeze({
    filter_id: entry.filter_id,
    filter_version: entry.filter_version,
    filter_category: entry.filter_category,
    permission_level: entry.permission_level,
    parameters: entry.parameters,
  }));

  const trace = Object.freeze({
    contract_version: FILTER_STACK_CONTRACT_VERSION,
    registry_version: FILTER_REGISTRY_VERSION,
    requested_filters: Object.freeze(normalizedGroups.requested),
    module_required_filters: Object.freeze(normalizedGroups.module_required),
    domain_required_filters: Object.freeze(normalizedGroups.domain_required),
    system_required_hardened_filters: Object.freeze(normalizedGroups.system_required_hardened),
    blocked_user_filters: Object.freeze(blocked_user_filters.sort((a, b) => a.filter_id.localeCompare(b.filter_id))),
    effective_filters: Object.freeze(effective_filters),
    execution_allowed: true,
    blocked_reasons: Object.freeze([]),
  });

  const effective_filter_hash = sha256(effective_filters);
  const receiptPayload = {
    contract_version: FILTER_STACK_CONTRACT_VERSION,
    registry_version: FILTER_REGISTRY_VERSION,
    trace,
    effective_filter_hash,
  };

  return Object.freeze({
    ...receiptPayload,
    receipt_identity: sha256(receiptPayload),
  });
}
