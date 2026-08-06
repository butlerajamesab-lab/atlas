import { sha256 } from '../substrate/canonical.js';

export const LEGISLATIVE_TRAIT_ACCOUNTING_RULE = Object.freeze({
  rule_id: 'atlas.civic_genome_legislative_trait_binding_accounting',
  rule_version: '1.0.0',
  exact_binding: 'trait.extraction_run_id == bill_version.rosetta_extraction_run_id',
  historical_generation_binding: 'unbound_trait_source_content_hash_matches_exactly_one_version_primary_source_content_hash',
  ambiguous_policy: 'remain_unresolved',
  no_trait_signal_creation: true,
});
export const LEGISLATIVE_TRAIT_ACCOUNTING_RULE_HASH = sha256(LEGISLATIVE_TRAIT_ACCOUNTING_RULE);

function fail(code) { throw new Error(`legislative_trait_accounting:${code}`); }
function array(value, code) { if (!Array.isArray(value)) fail(code); return value; }
function object(value, code) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code); return value; }
function text(value) { return value === null || value === undefined || value === '' ? null : String(value); }
function unique(values) { return [...new Set(values.filter(Boolean))].sort(); }

function traitSourceHashes(component) {
  const trace = array(component.value?.source_trace ?? [], 'source_trace_invalid');
  return unique(trace.map((row) => text(row?.rosetta_source_content_hash)));
}

function traitReference(component) {
  return Object.freeze({
    component_id: component.component_id,
    component_hash: component.component_hash,
    trait_id: component.canonical_record_id,
    extraction_run_id: text(component.value?.extraction_run_id),
    trait_class: text(component.value?.trait_class),
    source_content_hashes: Object.freeze(traitSourceHashes(component)),
    source_identity_hashes: Object.freeze(unique((component.value?.source_trace ?? []).map((row) => text(row?.rosetta_source_identity_hash)))),
  });
}

export function buildLegislativeTraitBindingAccounting(snapshot, projectionKey) {
  object(snapshot, 'snapshot_required');
  if (snapshot.methodology_version !== 'civic_genome_external_family_snapshot.1.1.0') fail('methodology_1_1_required');
  if (typeof projectionKey !== 'string' || !/^[0-9a-f]{64}$/.test(projectionKey)) fail('projection_key_invalid');

  const components = array(snapshot.components, 'components_required');
  const bills = components.filter((component) => component.component_type === 'bill');
  if (bills.length !== 1) fail('exactly_one_bill_required');
  const versions = array(bills[0].value?.bill_versions, 'bill_versions_required');
  const traits = components.filter((component) => component.component_type === 'trait');

  const versionByExtraction = new Map();
  for (const version of versions) {
    const extractionRun = text(version.rosetta_extraction_run_id);
    if (!extractionRun) continue;
    if (versionByExtraction.has(extractionRun)) fail('duplicate_version_extraction_run');
    versionByExtraction.set(extractionRun, version);
  }

  const exactByVersion = new Map();
  const residualTraits = [];
  for (const trait of traits) {
    const ref = traitReference(trait);
    const version = ref.extraction_run_id ? versionByExtraction.get(ref.extraction_run_id) : null;
    if (version) {
      const versionId = String(version.bill_version_id);
      const bucket = exactByVersion.get(versionId) ?? [];
      bucket.push(ref);
      exactByVersion.set(versionId, bucket);
    } else {
      residualTraits.push(ref);
    }
  }

  const versionSourceHashes = new Map();
  for (const version of versions) {
    const versionId = String(version.bill_version_id);
    const hashes = unique((exactByVersion.get(versionId) ?? []).flatMap((ref) => ref.source_content_hashes));
    versionSourceHashes.set(versionId, hashes);
  }

  const historicalByVersion = new Map();
  const unresolved = [];
  for (const trait of residualTraits) {
    const candidateVersionIds = versions
      .filter((version) => {
        const hashes = versionSourceHashes.get(String(version.bill_version_id)) ?? [];
        return trait.source_content_hashes.some((hash) => hashes.includes(hash));
      })
      .map((version) => String(version.bill_version_id))
      .sort();
    if (candidateVersionIds.length === 1) {
      const versionId = candidateVersionIds[0];
      const bucket = historicalByVersion.get(versionId) ?? [];
      bucket.push(trait);
      historicalByVersion.set(versionId, bucket);
    } else {
      unresolved.push(Object.freeze({
        ...trait,
        candidate_version_ids: Object.freeze(candidateVersionIds),
        unresolved_reason: candidateVersionIds.length === 0
          ? 'no_unique_source_content_version_match'
          : 'ambiguous_source_content_version_match',
      }));
    }
  }

  const versionAccounting = versions.map((version) => {
    const versionId = String(version.bill_version_id);
    const exact = [...(exactByVersion.get(versionId) ?? [])].sort((a, b) => a.component_id.localeCompare(b.component_id));
    const historical = [...(historicalByVersion.get(versionId) ?? [])].sort((a, b) => a.component_id.localeCompare(b.component_id));
    const historicalRuns = unique(historical.map((ref) => ref.extraction_run_id));
    return Object.freeze({
      bill_version_id: versionId,
      version_type: String(version.version_type),
      canonical_extraction_run_id: text(version.rosetta_extraction_run_id),
      primary_source_content_hashes: Object.freeze(versionSourceHashes.get(versionId) ?? []),
      exact_trait_count: exact.length,
      historical_same_source_trait_count: historical.length,
      historical_extraction_run_ids: Object.freeze(historicalRuns),
      exact_trait_ids: Object.freeze(exact.map((ref) => ref.trait_id).sort()),
      historical_trait_ids: Object.freeze(historical.map((ref) => ref.trait_id).sort()),
      version_accounting_hash: sha256({ exact, historical }),
    });
  }).sort((a, b) => a.bill_version_id.localeCompare(b.bill_version_id));

  const exactCount = versionAccounting.reduce((sum, row) => sum + row.exact_trait_count, 0);
  const historicalCount = versionAccounting.reduce((sum, row) => sum + row.historical_same_source_trait_count, 0);
  const unresolvedSorted = [...unresolved].sort((a, b) => a.component_id.localeCompare(b.component_id));
  if (exactCount + historicalCount + unresolvedSorted.length !== traits.length) fail('trait_population_accounting_mismatch');

  const basis = {
    accounting_rule: LEGISLATIVE_TRAIT_ACCOUNTING_RULE,
    accounting_rule_hash: LEGISLATIVE_TRAIT_ACCOUNTING_RULE_HASH,
    projection_key: projectionKey,
    source_snapshot_id: snapshot.snapshot_id,
    source_snapshot_hash: snapshot.snapshot_hash,
    total_trait_count: traits.length,
    exact_version_bound_trait_count: exactCount,
    historical_same_source_trait_count: historicalCount,
    unresolved_trait_count: unresolvedSorted.length,
    version_accounting: versionAccounting,
    unresolved_traits: unresolvedSorted,
  };
  return Object.freeze({
    ...basis,
    accounting_hash: sha256(basis),
    completeness_state: unresolvedSorted.length === 0 ? 'complete' : 'incomplete',
  });
}
