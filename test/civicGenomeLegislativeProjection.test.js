import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { sha256 } from '../src/substrate/canonical.js';
import {
  CIVIC_GENOME_LEGISLATIVE_MAPPING_RULE_HASH,
  buildLegislativeVersionObservations,
} from '../src/civic-genome/legislativeObservationMapper.js';

function snapshot() {
  const versions = [
    { bill_version_id:'v1', genome_bill_id:'g1', source_document_key:'text:1', source_bill_id:1, document_family:'text', version_type:'introduced', provider_sequence:1, stage_rank:100, chamber:null, predecessor_bill_version_id:null, base_bill_version_id:null, version_fingerprint:'a'.repeat(64), rosetta_source_document_id:10, rosetta_extraction_run_id:'10', assembly_run_id:'a1', prism_verification_run_id:'p1', processing_state:'verified', failure_code:null },
    { bill_version_id:'v2', genome_bill_id:'g1', source_document_key:'amendment:2', source_bill_id:1, document_family:'amendment', version_type:'house_amendment', provider_sequence:1, stage_rank:250, chamber:'H', predecessor_bill_version_id:null, base_bill_version_id:'v1', version_fingerprint:'b'.repeat(64), rosetta_source_document_id:11, rosetta_extraction_run_id:null, assembly_run_id:null, prism_verification_run_id:null, processing_state:'failed', failure_code:'rosetta_v22_amendment_operation_not_found' },
  ];
  const billValue = { bill_versions: versions, bill_version_manifest:{ manifest_version:'1.0.0', ordering_rule:'stage_rank_then_provider_sequence_then_source_document_key', version_count:2, manifest_hash:sha256(versions) } };
  return {
    contract_id:'civic_genome.external_snapshot.v1', canonical_owner:'lighthouse/civic_genome', immutable:true,
    methodology_version:'civic_genome_external_family_snapshot.1.1.0', snapshot_id:'s1', snapshot_hash:'c'.repeat(64), as_of:'2026-08-06T22:15:00.000Z',
    scope:{scope_ids:['f1'],jurisdiction_codes:['WA']},
    components:[
      {component_id:'civic_genome:bill:g1',component_type:'bill',canonical_record_id:'g1',component_hash:'d'.repeat(64),value:billValue,source_verification:[],unresolved_conditions:[]},
      {component_id:'civic_genome:trait:t1',component_type:'trait',canonical_record_id:'t1',component_hash:'e'.repeat(64),value:{extraction_run_id:'10',trait_class:'workflow',trait_fingerprint:'f'.repeat(64),source_object_id:'obj1',source_trace:[{source_url:'https://example.test/v1',source_version:'introduced'}]},source_verification:[{owner_service:'prism',state:'supported_by_one_source',receipt_id:'r1'},{owner_service:'rosetta',state:'confirmed',receipt_id:'10'}],unresolved_conditions:[]},
    ],
  };
}

test('maps one observation per governed version rather than per trait', () => {
  const bundle = buildLegislativeVersionObservations(snapshot());
  assert.equal(bundle.source_version_count, 2);
  assert.equal(bundle.observation_count, 2);
  assert.equal(bundle.observations[0].payload.structural_traits.trait_count, 1);
  assert.equal(bundle.observations[1].payload.structural_traits.trait_count, 0);
});

test('failed version survives explicitly as unresolved observation', () => {
  const bundle = buildLegislativeVersionObservations(snapshot());
  const failed = bundle.observations.find((row) => row.payload.version.bill_version_id === 'v2');
  assert.equal(failed.payload.version.processing_state, 'failed');
  assert.ok(failed.payload.unresolved_conditions.some((value) => value.includes('rosetta_v22_amendment_operation_not_found')));
});

test('Prism states remain a distribution and are not collapsed into one conclusion', () => {
  const bundle = buildLegislativeVersionObservations(snapshot());
  assert.deepEqual(bundle.observations[0].payload.structural_traits.prism_state_counts, { supported_by_one_source: 1 });
  assert.equal(bundle.observations[0].payload.source_native_verification_preserved, true);
});

test('version event timestamp is snapshot as-of, not an inferred legislative date', () => {
  const bundle = buildLegislativeVersionObservations(snapshot());
  assert.equal(bundle.observations[0].timestamp, '2026-08-06T22:15:00.000Z');
  assert.equal(bundle.observations[0].provenance.confidence_basis, 'immutable_snapshot_integrity_only');
});

test('old snapshot methodology fails closed because chronology is absent', () => {
  const old = snapshot(); old.methodology_version='civic_genome_external_family_snapshot.1.0.0';
  assert.throws(() => buildLegislativeVersionObservations(old), /source_methodology_missing_version_manifest/);
});

test('mapping identity is deterministic', () => {
  const first = buildLegislativeVersionObservations(snapshot());
  const second = buildLegislativeVersionObservations(structuredClone(snapshot()));
  assert.equal(first.mapping_rule_hash, CIVIC_GENOME_LEGISLATIVE_MAPPING_RULE_HASH);
  assert.equal(first.projection_key, second.projection_key);
  assert.equal(first.observation_hash, second.observation_hash);
});

test('persistence contract is atomic, immutable, and binds the exact source snapshot', () => {
  const sql = readFileSync(new URL('../src/schema/20260806_civic_genome_legislative_projection.sql', import.meta.url),'utf8');
  assert.match(sql,/persist_signal_event_batch_v2/);
  assert.match(sql,/source_snapshot_hash/);
  assert.match(sql,/prevent_civic_genome_legislative_projection_mutation/);
  assert.match(sql,/projection_identity_collision/);
  assert.match(sql,/source_methodology_invalid/);
});
