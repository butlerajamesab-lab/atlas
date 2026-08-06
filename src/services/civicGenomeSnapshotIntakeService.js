import { sha256 } from '../substrate/canonical.js';
import {
  CIVIC_GENOME_SOURCE_SCHEMA_ID,
  ATLAS_CIVIC_GENOME_DELIVERY_CONTRACT_ID,
  ATLAS_CIVIC_GENOME_DELIVERY_CONTRACT_VERSION,
  verifyAtlasCivicGenomeDelivery,
} from '../civic-genome/civicGenomeSnapshot.js';

function requiredEnv(name, environment = process.env) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
}

async function defaultClient() {
  const { supabase } = await import('../lib/supabaseClient.js');
  return supabase;
}

export function buildAtlasCivicGenomeBinding(snapshot) {
  const component_manifest = snapshot.components.map((component) => ({
    source_component_id: component.component_id,
    source_component_type: component.component_type,
    source_component_hash: component.component_hash,
    source_canonical_record_id: component.canonical_record_id,
    source_inclusion_state: component.inclusion_state,
    source_verification: component.source_verification,
    source_unresolved_conditions: [...component.unresolved_conditions].sort(),
    atlas_signal_ids: [],
    component_mapping_state: 'source_native_unmapped',
  })).sort((a,b)=>a.source_component_id.localeCompare(b.source_component_id));

  const basis = {
    binding_contract_id: 'atlas.civic_genome_source_binding.v1',
    binding_contract_version: '1.0.0',
    source_owner: 'lighthouse/civic_genome',
    source_schema_id: CIVIC_GENOME_SOURCE_SCHEMA_ID,
    source_contract_id: snapshot.contract_id,
    source_contract_version: snapshot.contract_version,
    source_snapshot_id: snapshot.snapshot_id,
    source_snapshot_hash: snapshot.snapshot_hash,
    source_export_receipt_id: snapshot.export_receipt.export_receipt_id,
    source_export_receipt_hash: snapshot.export_receipt.export_receipt_hash,
    source_as_of: new Date(snapshot.as_of).toISOString(),
    source_scope: snapshot.scope,
    source_completeness_state: snapshot.completeness_state,
    source_component_count: snapshot.component_count,
    component_manifest,
    verification_mapping_state: 'source_native_preserved_unmapped',
    atlas_projection_state: 'not_executed',
    no_mutation: true,
  };
  return Object.freeze({ ...basis, atlas_binding_hash: sha256(basis) });
}

export function buildAtlasCivicGenomeDeliveryReceipt({ snapshot, binding, key_id }) {
  const basis = {
    delivery_contract_id: ATLAS_CIVIC_GENOME_DELIVERY_CONTRACT_ID,
    delivery_contract_version: ATLAS_CIVIC_GENOME_DELIVERY_CONTRACT_VERSION,
    validation_state: 'validated_source_native',
    authenticated: true,
    auth_scheme: 'hmac-sha256',
    key_id,
    source_schema_id: CIVIC_GENOME_SOURCE_SCHEMA_ID,
    source_contract_id: snapshot.contract_id,
    source_contract_version: snapshot.contract_version,
    source_snapshot_id: snapshot.snapshot_id,
    source_snapshot_hash: snapshot.snapshot_hash,
    source_export_receipt_id: snapshot.export_receipt.export_receipt_id,
    source_export_receipt_hash: snapshot.export_receipt.export_receipt_hash,
    source_component_count: snapshot.component_count,
    source_completeness_state: snapshot.completeness_state,
    atlas_binding_hash: binding.atlas_binding_hash,
    verification_mapping_state: binding.verification_mapping_state,
    persistence_requested: true,
    projection_executed: false,
    no_mutation: true,
  };
  return Object.freeze({
    ...basis,
    delivery_receipt_id: `acg-delivery-${sha256(basis).slice(0,32)}`,
    delivery_receipt_hash: sha256(basis),
  });
}

export async function acceptAtlasCivicGenomeSnapshot({
  body,
  key_id,
  signature,
  environment = process.env,
  client = null,
}) {
  const expectedKeyId = requiredEnv('ATLAS_CIVIC_GENOME_HANDSHAKE_KEY_ID', environment);
  const secret = requiredEnv('ATLAS_CIVIC_GENOME_HANDSHAKE_SECRET', environment);
  const snapshot = verifyAtlasCivicGenomeDelivery({
    body,
    keyId: key_id,
    signature,
    expectedKeyId,
    secret,
  });
  const binding = buildAtlasCivicGenomeBinding(snapshot);
  const receipt = buildAtlasCivicGenomeDeliveryReceipt({ snapshot, binding, key_id });
  const db = client ?? await defaultClient();
  const { data, error } = await db.rpc('atlas_civic_genome_snapshot_persist_v1', {
    p_record: {
      source_schema_id: CIVIC_GENOME_SOURCE_SCHEMA_ID,
      snapshot,
      atlas_binding_hash: binding.atlas_binding_hash,
      delivery_key_id: key_id,
      delivery_receipt_hash: receipt.delivery_receipt_hash,
    },
  });
  if (error) throw new Error(`atlas_civic_genome_snapshot_persist_failed:${error.message}`);
  return Object.freeze({
    ...receipt,
    persistence_status: data?.status ?? null,
    persisted: data?.status === 'inserted' || data?.status === 'idempotent',
    source_snapshot_id: snapshot.snapshot_id,
    source_snapshot_hash: snapshot.snapshot_hash,
    atlas_binding_hash: binding.atlas_binding_hash,
  });
}
