import { sha256 } from '../substrate/canonical.js';

export const CIVIC_GENOME_LEGISLATIVE_MAPPING_RULE = Object.freeze({
  rule_id: 'atlas.civic_genome_legislative_version_observation',
  rule_version: '1.0.0',
  source_contract_id: 'civic_genome.external_snapshot.v1',
  minimum_source_methodology: 'civic_genome_external_family_snapshot.1.1.0',
  aggregation_unit: 'one_observation_per_canonical_bill_version',
  version_ordering: 'stage_rank_then_provider_sequence_then_source_document_key',
  trait_binding: 'exact_rosetta_extraction_run_id',
  unresolved_policy: 'preserve_failed_and_unresolved_versions',
  prism_policy: 'preserve_all_source_native_states_without_collapsing_to_one_status',
  timestamp_policy: 'snapshot_as_of_only_no_inferred_version_timestamp',
});
export const CIVIC_GENOME_LEGISLATIVE_MAPPING_RULE_HASH = sha256(CIVIC_GENOME_LEGISLATIVE_MAPPING_RULE);

function fail(code) { throw new Error(`civic_genome_legislative_mapping:${code}`); }
function object(value, code) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code); return value; }
function text(value, code) { if (typeof value !== 'string' || value.trim() === '') fail(code); return value.trim(); }
function array(value, code) { if (!Array.isArray(value)) fail(code); return value; }
function integer(value, code) { if (!Number.isSafeInteger(value)) fail(code); return value; }
function optionalText(value) { return value === null || value === undefined || value === '' ? null : String(value); }

function sortedUnique(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))].sort();
}

function versionSort(left, right) {
  const stage = Number(left.stage_rank) - Number(right.stage_rank);
  if (stage !== 0) return stage;
  const sequence = Number(left.provider_sequence) - Number(right.provider_sequence);
  if (sequence !== 0) return sequence;
  return String(left.source_document_key).localeCompare(String(right.source_document_key));
}

function countBy(values) {
  const result = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return Object.freeze(Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b))));
}

function traitSummary(traits) {
  const traitRefs = traits.map((component) => ({
    component_id: component.component_id,
    component_hash: component.component_hash,
    trait_id: component.canonical_record_id,
    trait_class: optionalText(component.value?.trait_class),
    trait_fingerprint: optionalText(component.value?.trait_fingerprint),
    source_object_id: optionalText(component.value?.source_object_id),
  })).sort((a, b) => a.component_id.localeCompare(b.component_id));

  const prismStates = [];
  const prismReceiptIds = [];
  const rosettaStates = [];
  const civicStates = [];
  const sourceUrls = [];
  const sourceVersions = [];
  const unresolved = [];

  for (const component of traits) {
    for (const state of component.source_verification ?? []) {
      if (state.owner_service === 'prism') {
        prismStates.push(String(state.state));
        if (state.receipt_id) prismReceiptIds.push(String(state.receipt_id));
      } else if (state.owner_service === 'rosetta') rosettaStates.push(String(state.state));
      else if (state.owner_service === 'civic_genome') civicStates.push(String(state.state));
    }
    for (const trace of component.value?.source_trace ?? []) {
      if (trace?.source_url) sourceUrls.push(String(trace.source_url));
      if (trace?.source_version) sourceVersions.push(String(trace.source_version));
    }
    for (const condition of component.unresolved_conditions ?? []) unresolved.push(String(condition));
  }

  return Object.freeze({
    trait_count: traitRefs.length,
    trait_class_counts: countBy(traitRefs.map((ref) => ref.trait_class ?? 'unclassified')),
    contributing_traits: Object.freeze(traitRefs),
    contributing_trait_hash: sha256(traitRefs),
    prism_state_counts: countBy(prismStates),
    prism_receipt_ids: Object.freeze(sortedUnique(prismReceiptIds)),
    rosetta_state_counts: countBy(rosettaStates),
    civic_genome_state_counts: countBy(civicStates),
    source_urls: Object.freeze(sortedUnique(sourceUrls)),
    source_versions: Object.freeze(sortedUnique(sourceVersions)),
    unresolved_conditions: Object.freeze(sortedUnique(unresolved)),
  });
}

export function buildLegislativeVersionObservations(snapshot) {
  object(snapshot, 'snapshot_required');
  if (snapshot.contract_id !== 'civic_genome.external_snapshot.v1') fail('source_contract_mismatch');
  if (snapshot.canonical_owner !== 'lighthouse/civic_genome' || snapshot.immutable !== true) fail('source_boundary_mismatch');
  if (snapshot.methodology_version !== CIVIC_GENOME_LEGISLATIVE_MAPPING_RULE.minimum_source_methodology) {
    fail('source_methodology_missing_version_manifest');
  }
  const asOf = text(snapshot.as_of, 'snapshot_as_of_required');
  if (!Number.isFinite(Date.parse(asOf))) fail('snapshot_as_of_invalid');
  const components = array(snapshot.components, 'snapshot_components_required');
  const bills = components.filter((component) => component.component_type === 'bill');
  if (bills.length !== 1) fail('exactly_one_bill_component_required');
  const bill = bills[0];
  const billValue = object(bill.value, 'bill_value_required');
  const versions = array(billValue.bill_versions, 'bill_version_manifest_required').map((version) => object(version, 'bill_version_invalid')).sort(versionSort);
  const manifest = object(billValue.bill_version_manifest, 'bill_version_manifest_metadata_required');
  if (manifest.ordering_rule !== CIVIC_GENOME_LEGISLATIVE_MAPPING_RULE.version_ordering) fail('version_ordering_rule_mismatch');
  if (manifest.version_count !== versions.length || manifest.manifest_hash !== sha256(versions)) fail('version_manifest_hash_mismatch');

  const traits = components.filter((component) => component.component_type === 'trait');
  const traitsByExtraction = new Map();
  for (const trait of traits) {
    const extractionRunId = optionalText(trait.value?.extraction_run_id);
    if (!extractionRunId) continue;
    const bucket = traitsByExtraction.get(extractionRunId) ?? [];
    bucket.push(trait);
    traitsByExtraction.set(extractionRunId, bucket);
  }

  const familyId = text(snapshot.scope?.scope_ids?.[0], 'family_scope_required');
  const jurisdiction = snapshot.scope?.jurisdiction_codes?.length === 1
    ? text(snapshot.scope.jurisdiction_codes[0], 'jurisdiction_required')
    : fail('single_jurisdiction_required');

  const observations = versions.map((version) => {
    const billVersionId = text(version.bill_version_id, 'bill_version_id_required');
    const extractionRunId = optionalText(version.rosetta_extraction_run_id);
    const versionTraits = extractionRunId ? (traitsByExtraction.get(extractionRunId) ?? []) : [];
    const summary = traitSummary(versionTraits);
    const processingState = text(version.processing_state, 'processing_state_required');
    const failureCode = optionalText(version.failure_code);
    const unresolvedConditions = sortedUnique([
      ...summary.unresolved_conditions,
      ...(processingState === 'failed' ? [`version_processing_failed:${failureCode ?? 'unspecified'}`] : []),
      ...(!extractionRunId && processingState !== 'failed' ? ['rosetta_extraction_run_unresolved'] : []),
    ]);

    const versionIdentity = {
      bill_version_id: billVersionId,
      genome_bill_id: text(version.genome_bill_id, 'genome_bill_id_required'),
      source_document_key: text(version.source_document_key, 'source_document_key_required'),
      source_bill_id: integer(version.source_bill_id, 'source_bill_id_required'),
      document_family: text(version.document_family, 'document_family_required'),
      version_type: text(version.version_type, 'version_type_required'),
      provider_sequence: integer(version.provider_sequence, 'provider_sequence_required'),
      stage_rank: integer(version.stage_rank, 'stage_rank_required'),
      chamber: optionalText(version.chamber),
      predecessor_bill_version_id: optionalText(version.predecessor_bill_version_id),
      base_bill_version_id: optionalText(version.base_bill_version_id),
      version_fingerprint: text(version.version_fingerprint, 'version_fingerprint_required'),
      rosetta_source_document_id: version.rosetta_source_document_id === null ? null : Number(version.rosetta_source_document_id),
      rosetta_extraction_run_id: extractionRunId,
      assembly_run_id: optionalText(version.assembly_run_id),
      prism_verification_run_id: optionalText(version.prism_verification_run_id),
      processing_state: processingState,
      failure_code: failureCode,
    };

    const payload = {
      external_id: `civic_genome_bill_version:${billVersionId}`,
      source_snapshot_id: snapshot.snapshot_id,
      source_snapshot_hash: snapshot.snapshot_hash,
      source_snapshot_methodology: snapshot.methodology_version,
      family_id: familyId,
      bill_component_id: bill.component_id,
      bill_component_hash: bill.component_hash,
      version: versionIdentity,
      version_identity_hash: sha256(versionIdentity),
      structural_traits: summary,
      unresolved_conditions: unresolvedConditions,
      mapping_rule_id: CIVIC_GENOME_LEGISLATIVE_MAPPING_RULE.rule_id,
      mapping_rule_version: CIVIC_GENOME_LEGISLATIVE_MAPPING_RULE.rule_version,
      mapping_rule_hash: CIVIC_GENOME_LEGISLATIVE_MAPPING_RULE_HASH,
      source_native_verification_preserved: true,
      no_consequence_interpretation: true,
    };

    return Object.freeze({
      stream_id: 'civic_genome_legislative_versions',
      offset: 0,
      timestamp: new Date(asOf).toISOString(),
      signal_type: 'legislative_version_structure',
      spacetime: Object.freeze({
        region: jurisdiction,
        jurisdiction,
        domain_space: 'document_lineage',
        node_id: billVersionId,
        stage_rank: versionIdentity.stage_rank,
        provider_sequence: versionIdentity.provider_sequence,
      }),
      provenance: Object.freeze({
        channel: 'civic_genome_external_snapshot',
        confidence: 1,
        confidence_basis: 'immutable_snapshot_integrity_only',
        source_system: 'lighthouse/civic_genome',
        source_snapshot_id: snapshot.snapshot_id,
        source_snapshot_hash: snapshot.snapshot_hash,
        source_component_hash: bill.component_hash,
      }),
      payload: Object.freeze(payload),
      source_id: 'lighthouse_civic_genome_snapshot',
      jurisdiction_id: jurisdiction,
      module_hint: 'legislative_history',
    });
  });

  const observationHash = sha256(observations);
  const projectionBasis = {
    mapping_rule_hash: CIVIC_GENOME_LEGISLATIVE_MAPPING_RULE_HASH,
    source_snapshot_id: snapshot.snapshot_id,
    source_snapshot_hash: snapshot.snapshot_hash,
    bill_component_hash: bill.component_hash,
    version_manifest_hash: manifest.manifest_hash,
    observation_count: observations.length,
    observation_hash: observationHash,
  };

  return Object.freeze({
    bundle_version: 'atlas_civic_genome_legislative_projection.v1',
    mapping_rule: CIVIC_GENOME_LEGISLATIVE_MAPPING_RULE,
    mapping_rule_hash: CIVIC_GENOME_LEGISLATIVE_MAPPING_RULE_HASH,
    source_snapshot_id: snapshot.snapshot_id,
    source_snapshot_hash: snapshot.snapshot_hash,
    version_manifest_hash: manifest.manifest_hash,
    source_version_count: versions.length,
    observation_count: observations.length,
    observation_hash: observationHash,
    projection_key: sha256(projectionBasis),
    observations: Object.freeze(observations),
  });
}
