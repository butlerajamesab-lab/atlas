import { sha256 } from '../substrate/canonical.js';
import { normalizeDomainSpaceDefinition } from '../domain-space/domainSpace.js';
import { resolveAtlasFilterStack } from '../filters/filterStack.js';
import { listStructuralLenses } from '../lenses/structuralLenses.js';

export const ATLAS_MODULE_CONTRACT_VERSION = '1.0.0';

const LENS_IDS = new Set(listStructuralLenses().map((lens) => lens.lens_id));
const RECEIPT_REQUIREMENTS = new Set([
  'source_population_hash',
  'deduplicated_population_hash',
  'domain_space_receipt',
  'filter_stack_receipt',
  'structural_lens_receipt',
  'complete_output_hash',
  'replay_receipt',
]);

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}_must_be_object`);
}

function nonEmpty(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label}_required`);
  return value.trim();
}

function semver(value, label) {
  const normalized = nonEmpty(value, label);
  if (!/^\d+\.\d+\.\d+$/.test(normalized)) throw new Error(`${label}_invalid_semver`);
  return normalized;
}

function normalizeBindings(bindings) {
  if (!Array.isArray(bindings) || bindings.length === 0) throw new Error('atlas_module_adapter_bindings_required');
  const normalized = bindings.map((binding) => {
    assertPlainObject(binding, 'atlas_module_adapter_binding');
    const connector_id = nonEmpty(binding.connector_id, 'atlas_module_connector_id');
    const schema_id = nonEmpty(binding.schema_id, 'atlas_module_schema_id');
    const adapter_class = nonEmpty(binding.adapter_class, 'atlas_module_adapter_class');
    const role = nonEmpty(binding.role, 'atlas_module_adapter_role');
    if (typeof binding.required !== 'boolean') throw new Error('atlas_module_adapter_required_boolean');
    return Object.freeze({ connector_id, schema_id, adapter_class, role, required: binding.required });
  }).sort((a, b) => `${a.role}:${a.connector_id}:${a.schema_id}`.localeCompare(`${b.role}:${b.connector_id}:${b.schema_id}`));
  const identities = new Set();
  for (const binding of normalized) {
    const identity = `${binding.role}:${binding.connector_id}:${binding.schema_id}`;
    if (identities.has(identity)) throw new Error(`atlas_module_adapter_binding_duplicate:${identity}`);
    identities.add(identity);
  }
  return Object.freeze(normalized);
}

function normalizeSignalTaxonomy(taxonomy) {
  if (!Array.isArray(taxonomy) || taxonomy.length === 0) throw new Error('atlas_module_signal_taxonomy_required');
  const normalized = taxonomy.map((signal) => {
    assertPlainObject(signal, 'atlas_module_signal_taxonomy_entry');
    return Object.freeze({
      signal_type: nonEmpty(signal.signal_type, 'atlas_module_signal_type'),
      universal_role: nonEmpty(signal.universal_role, 'atlas_module_universal_role'),
    });
  }).sort((a, b) => a.signal_type.localeCompare(b.signal_type));
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1].signal_type === normalized[index].signal_type) {
      throw new Error(`atlas_module_signal_type_duplicate:${normalized[index].signal_type}`);
    }
  }
  return Object.freeze(normalized);
}

function normalizeLensDefinition(definition) {
  assertPlainObject(definition, 'atlas_module_structural_lens_stack');
  const stack_id = nonEmpty(definition.stack_id, 'atlas_module_lens_stack_id');
  if (!Array.isArray(definition.lenses) || definition.lenses.length === 0) {
    throw new Error('atlas_module_lens_stack_lenses_required');
  }
  const lenses = definition.lenses.map((lens) => {
    assertPlainObject(lens, 'atlas_module_lens_entry');
    const lens_id = nonEmpty(lens.lens_id, 'atlas_module_lens_id');
    if (!LENS_IDS.has(lens_id)) throw new Error(`atlas_module_lens_not_registered:${lens_id}`);
    if (!Number.isFinite(lens.weight) || lens.weight < 0 || lens.weight > 1) {
      throw new Error(`atlas_module_lens_weight_invalid:${lens_id}`);
    }
    return Object.freeze({ lens_id, weight: lens.weight });
  }).sort((a, b) => a.lens_id.localeCompare(b.lens_id));
  for (let index = 1; index < lenses.length; index += 1) {
    if (lenses[index - 1].lens_id === lenses[index].lens_id) {
      throw new Error(`atlas_module_lens_duplicate:${lenses[index].lens_id}`);
    }
  }
  const sum = lenses.reduce((total, lens) => total + lens.weight, 0);
  if (Math.abs(sum - 1) > 1e-12) throw new Error(`atlas_module_lens_weight_sum_invalid:${sum}`);
  const require_disconfirmation = definition.require_disconfirmation === true;
  if (require_disconfirmation && !lenses.some((lens) => lens.lens_id === 'disconfirmation')) {
    throw new Error('atlas_module_lens_disconfirmation_required');
  }
  return Object.freeze({ stack_id, lenses: Object.freeze(lenses), require_disconfirmation });
}

function normalizeConvergenceConfig(configuration) {
  assertPlainObject(configuration, 'atlas_module_convergence_configuration');
  const allowed = new Set([
    'convergence_rule_id',
    'minimum_signal_count',
    'time_window_ms',
    'similarity_threshold',
    'deduplication_rule_id',
  ]);
  for (const key of Object.keys(configuration)) {
    if (!allowed.has(key)) throw new Error(`atlas_module_convergence_configuration_key_not_allowed:${key}`);
  }
  const normalized = {
    convergence_rule_id: nonEmpty(configuration.convergence_rule_id, 'atlas_module_convergence_rule_id'),
    minimum_signal_count: configuration.minimum_signal_count,
    time_window_ms: configuration.time_window_ms,
    similarity_threshold: configuration.similarity_threshold,
    deduplication_rule_id: nonEmpty(configuration.deduplication_rule_id, 'atlas_module_deduplication_rule_id'),
  };
  if (!Number.isSafeInteger(normalized.minimum_signal_count) || normalized.minimum_signal_count < 2) {
    throw new Error('atlas_module_minimum_signal_count_invalid');
  }
  if (!Number.isSafeInteger(normalized.time_window_ms) || normalized.time_window_ms <= 0) {
    throw new Error('atlas_module_time_window_invalid');
  }
  if (!Number.isFinite(normalized.similarity_threshold)
    || normalized.similarity_threshold < 0 || normalized.similarity_threshold > 1) {
    throw new Error('atlas_module_similarity_threshold_invalid');
  }
  return Object.freeze(normalized);
}

function normalizeReceiptRequirements(requirements) {
  if (!Array.isArray(requirements) || requirements.length === 0) {
    throw new Error('atlas_module_receipt_requirements_required');
  }
  const normalized = [...new Set(requirements.map((requirement) => nonEmpty(requirement, 'atlas_module_receipt_requirement')))].sort();
  for (const requirement of normalized) {
    if (!RECEIPT_REQUIREMENTS.has(requirement)) throw new Error(`atlas_module_receipt_requirement_unknown:${requirement}`);
  }
  return Object.freeze(normalized);
}

export function compileAtlasModuleDefinition(definition) {
  assertPlainObject(definition, 'atlas_module_definition');
  const module_id = nonEmpty(definition.module_id, 'atlas_module_id');
  const module_version = semver(definition.module_version, 'atlas_module_version');
  const core_question = nonEmpty(definition.core_question, 'atlas_module_core_question');
  const domain_space = normalizeDomainSpaceDefinition(definition.domain_space_definition);
  const adapter_bindings = normalizeBindings(definition.adapter_bindings);
  const signal_taxonomy = normalizeSignalTaxonomy(definition.signal_taxonomy);
  assertPlainObject(definition.filter_requirements ?? {}, 'atlas_module_filter_requirements');
  const filter_binding = resolveAtlasFilterStack({
    requested_filters: [],
    module_required_filters: definition.filter_requirements?.module_required_filters ?? [],
    domain_required_filters: definition.filter_requirements?.domain_required_filters ?? [],
  });
  const structural_lens_stack = normalizeLensDefinition(definition.structural_lens_stack);
  const convergence_configuration = normalizeConvergenceConfig(definition.convergence_configuration);
  const receipt_requirements = normalizeReceiptRequirements(definition.receipt_requirements);

  const compiled = {
    contract_version: ATLAS_MODULE_CONTRACT_VERSION,
    module_id,
    module_version,
    core_question,
    domain_space,
    adapter_bindings,
    adapter_binding_hash: sha256(adapter_bindings),
    signal_taxonomy,
    signal_taxonomy_hash: sha256(signal_taxonomy),
    filter_binding: Object.freeze({
      registry_version: filter_binding.registry_version,
      effective_filter_hash: filter_binding.effective_filter_hash,
      receipt_identity: filter_binding.receipt_identity,
    }),
    structural_lens_stack,
    structural_lens_stack_hash: sha256(structural_lens_stack),
    convergence_configuration,
    convergence_configuration_hash: sha256(convergence_configuration),
    receipt_requirements,
  };
  return Object.freeze({
    ...compiled,
    module_definition_hash: sha256(compiled),
  });
}

export function validateAtlasModuleOperationalBindings(compiled, registry_snapshot) {
  assertPlainObject(compiled, 'compiled_atlas_module');
  assertPlainObject(registry_snapshot, 'atlas_module_registry_snapshot');
  if (!Array.isArray(registry_snapshot.connectors)) throw new Error('atlas_module_registry_connectors_required');
  if (!Array.isArray(registry_snapshot.schemas)) throw new Error('atlas_module_registry_schemas_required');
  const connectorMap = new Map(registry_snapshot.connectors.map((connector) => [String(connector.id), connector]));
  const schemaMap = new Map(registry_snapshot.schemas.map((schema) => [String(schema.id), schema]));
  const bindings = compiled.adapter_bindings.map((binding) => {
    const connector = connectorMap.get(binding.connector_id);
    const schema = schemaMap.get(binding.schema_id);
    const reasons = [];
    if (!connector) reasons.push('connector_not_found');
    else {
      if (connector.adapter_class !== binding.adapter_class) reasons.push('adapter_class_mismatch');
      if (connector.schema_id !== binding.schema_id) reasons.push('connector_schema_mismatch');
      if (connector.active !== true) reasons.push('connector_inactive');
    }
    if (!schema) reasons.push('schema_not_found');
    else if (schema.active !== true) reasons.push('schema_inactive');
    return Object.freeze({
      ...binding,
      operational_state: reasons.length === 0 ? 'ready' : binding.required ? 'blocked' : 'degraded',
      reasons: Object.freeze(reasons.sort()),
    });
  });
  const requiredBlocked = bindings.filter((binding) => binding.required && binding.operational_state === 'blocked');
  const result = {
    module_id: compiled.module_id,
    module_definition_hash: compiled.module_definition_hash,
    operational_state: requiredBlocked.length > 0 ? 'blocked' : bindings.some((binding) => binding.operational_state === 'degraded') ? 'degraded' : 'ready',
    bindings: Object.freeze(bindings),
  };
  return Object.freeze({ ...result, receipt_identity: sha256(result) });
}
