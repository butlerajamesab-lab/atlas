import { createHmac, timingSafeEqual } from 'node:crypto';
import { sha256 } from '../substrate/canonical.js';

export const CIVIC_GENOME_SOURCE_SCHEMA_ID = 'https://luminari.org/civic-genome/contracts/external-snapshot.v1.schema.json';
export const CIVIC_GENOME_SOURCE_CONTRACT_ID = 'civic_genome.external_snapshot.v1';
export const CIVIC_GENOME_SOURCE_CONTRACT_VERSION = '1.0.0';
export const ATLAS_CIVIC_GENOME_DELIVERY_CONTRACT_ID = 'atlas.civic_genome_snapshot_delivery.v1';
export const ATLAS_CIVIC_GENOME_DELIVERY_CONTRACT_VERSION = '1.0.0';
export const ATLAS_CIVIC_GENOME_DELIVERY_PATH = '/v1/civic-genome/snapshots';

const HEX64 = /^[0-9a-f]{64}$/;
const COMPONENT_TYPES = new Set([
  'family','bill','trait','relationship','lineage_edge','event','momentum_component',
  'momentum_snapshot','comparison_matrix','comparison_state_cell','unresolved_family_candidate',
]);

function fail(code, detail = '') { throw new Error(`invalid_civic_genome_snapshot:${code}${detail ? `:${detail}` : ''}`); }
function record(value, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail('object_required', label); return value; }
function string(value, label) { if (typeof value !== 'string' || value.length === 0) fail('string_required', label); return value; }
function hex64(value, label) { const text = string(value, label); if (!HEX64.test(text)) fail('sha256_required', label); return text; }
function array(value, label) { if (!Array.isArray(value)) fail('array_required', label); return value; }
function uniqueStrings(value, label) { const rows = array(value, label).map((v,i)=>string(v,`${label}[${i}]`)); if (new Set(rows).size!==rows.length) fail('unique_values_required', label); return rows; }
function iso(value, label) { const text=string(value,label); if (!Number.isFinite(Date.parse(text))) fail('iso_required',label); return new Date(text).toISOString(); }

function sortBindings(rows) { return [...rows].sort((a,b)=>[a.owner_service,a.record_type,a.record_id,a.receipt_id??''].join('\0').localeCompare([b.owner_service,b.record_type,b.record_id,b.receipt_id??''].join('\0'))); }
function sortVerification(rows) { return [...rows].sort((a,b)=>[a.owner_service,a.state,a.receipt_id??''].join('\0').localeCompare([b.owner_service,b.state,b.receipt_id??''].join('\0'))); }

export function civicGenomeComponentHashBasis(component) {
  const row=record(component,'component');
  return {
    component_id:string(row.component_id,'component.component_id'),
    component_type:string(row.component_type,'component.component_type'),
    canonical_record_id:string(row.canonical_record_id,'component.canonical_record_id'),
    inclusion_state:string(row.inclusion_state,'component.inclusion_state'),
    jurisdiction_code:row.jurisdiction_code===null?null:string(row.jurisdiction_code,'component.jurisdiction_code'),
    temporal_scope:row.temporal_scope===null?null:string(row.temporal_scope,'component.temporal_scope'),
    value:row.value,
    source_bindings:sortBindings(array(row.source_bindings,'component.source_bindings')),
    source_verification:sortVerification(array(row.source_verification,'component.source_verification')),
    unresolved_conditions:uniqueStrings(row.unresolved_conditions,'component.unresolved_conditions').sort(),
  };
}

export function civicGenomeSnapshotHashBasis(snapshot) {
  const row=record(snapshot,'snapshot'); const scope=record(row.scope,'snapshot.scope');
  const components=array(row.components,'snapshot.components').map((c)=>({...civicGenomeComponentHashBasis(c),component_hash:hex64(c.component_hash,'component.component_hash')})).sort((a,b)=>a.component_id.localeCompare(b.component_id));
  return {
    contract_id:string(row.contract_id,'snapshot.contract_id'), contract_version:string(row.contract_version,'snapshot.contract_version'),
    canonical_owner:string(row.canonical_owner,'snapshot.canonical_owner'), snapshot_id:string(row.snapshot_id,'snapshot.snapshot_id'),
    snapshot_kind:string(row.snapshot_kind,'snapshot.snapshot_kind'), immutable:row.immutable,
    scope:{scope_type:string(scope.scope_type,'scope.scope_type'),scope_ids:uniqueStrings(scope.scope_ids,'scope.scope_ids').sort(),jurisdiction_codes:uniqueStrings(scope.jurisdiction_codes,'scope.jurisdiction_codes').sort()},
    as_of:iso(row.as_of,'snapshot.as_of'), methodology_version:string(row.methodology_version,'snapshot.methodology_version'), components,
    component_count:row.component_count, unresolved_conditions:uniqueStrings(row.unresolved_conditions,'snapshot.unresolved_conditions').sort(),
    excluded_component_types:uniqueStrings(row.excluded_component_types,'snapshot.excluded_component_types').sort(), completeness_state:string(row.completeness_state,'snapshot.completeness_state'),
  };
}

export function assertCivicGenomeSnapshot(snapshot) {
  const row=record(snapshot,'snapshot');
  if (row.contract_id!==CIVIC_GENOME_SOURCE_CONTRACT_ID) fail('contract_id_mismatch');
  if (row.contract_version!==CIVIC_GENOME_SOURCE_CONTRACT_VERSION) fail('contract_version_mismatch');
  if (row.canonical_owner!=='lighthouse/civic_genome' || row.snapshot_kind!=='baseline_export' || row.immutable!==true) fail('source_boundary_mismatch');
  const components=array(row.components,'snapshot.components');
  if (!Number.isInteger(row.component_count)||row.component_count!==components.length) fail('component_count_mismatch');
  const ids=[];
  for (const component of components) {
    const c=record(component,'component'); const id=string(c.component_id,'component.component_id');
    if (!id.startsWith('civic_genome:')) fail('component_namespace_mismatch',id);
    if (!COMPONENT_TYPES.has(string(c.component_type,'component.component_type'))) fail('component_type_not_governed',id);
    if (array(c.source_bindings,'component.source_bindings').length===0 || array(c.source_verification,'component.source_verification').length===0) fail('source_trace_required',id);
    if (hex64(c.component_hash,'component.component_hash')!==sha256(civicGenomeComponentHashBasis(c))) fail('component_hash_mismatch',id);
    ids.push(id);
  }
  if (new Set(ids).size!==ids.length) fail('duplicate_component_id');
  const snapshotHash=hex64(row.snapshot_hash,'snapshot.snapshot_hash');
  if (snapshotHash!==sha256(civicGenomeSnapshotHashBasis(row))) fail('snapshot_hash_mismatch');
  const receipt=record(row.export_receipt,'snapshot.export_receipt');
  if (hex64(receipt.snapshot_hash,'export_receipt.snapshot_hash')!==snapshotHash) fail('receipt_snapshot_hash_mismatch');
  const replayKey=sha256({contract_id:row.contract_id,contract_version:row.contract_version,snapshot_id:row.snapshot_id,snapshot_hash:snapshotHash,methodology_version:row.methodology_version});
  if (hex64(receipt.deterministic_replay_key,'export_receipt.deterministic_replay_key')!==replayKey) fail('replay_key_mismatch');
  const receiptBasis={export_receipt_id:string(receipt.export_receipt_id,'export_receipt.export_receipt_id'),snapshot_hash:snapshotHash,deterministic_replay_key:replayKey,source_commit_sha:receipt.source_commit_sha===null?null:string(receipt.source_commit_sha,'export_receipt.source_commit_sha')};
  if (hex64(receipt.export_receipt_hash,'export_receipt.export_receipt_hash')!==sha256(receiptBasis)) fail('export_receipt_hash_mismatch');
  iso(receipt.generated_at,'export_receipt.generated_at');
  return row;
}

function signatureBasis(body,keyId){return{delivery_contract_id:ATLAS_CIVIC_GENOME_DELIVERY_CONTRACT_ID,delivery_contract_version:ATLAS_CIVIC_GENOME_DELIVERY_CONTRACT_VERSION,method:'POST',path:ATLAS_CIVIC_GENOME_DELIVERY_PATH,key_id:keyId,source_schema_id:body.source_schema_id,source_contract_id:body.source_contract_id,source_contract_version:body.source_contract_version,snapshot:body.snapshot};}
export function signAtlasCivicGenomeDelivery(body,keyId,secret){if(Buffer.byteLength(secret,'utf8')<32) fail('secret_too_short'); return createHmac('sha256',secret).update(JSON.stringify(JSON.parse(JSON.stringify(signatureBasis(body,keyId),Object.keys(signatureBasis(body,keyId)).sort())))).digest('hex');}

// Use Atlas canonical hashing semantics for HMAC basis so nested objects are sorted identically.
import { canonicalJson } from '../substrate/canonical.js';
export function computeAtlasCivicGenomeSignature(body,keyId,secret){if(Buffer.byteLength(secret,'utf8')<32) fail('secret_too_short');return createHmac('sha256',secret).update(canonicalJson(signatureBasis(body,keyId)),'utf8').digest('hex');}

export function verifyAtlasCivicGenomeDelivery({body,keyId,signature,expectedKeyId,secret}){
  if(keyId!==expectedKeyId) throw new Error('unauthorized_civic_genome_delivery:key_id_mismatch');
  if(typeof signature!=='string'||!HEX64.test(signature)) throw new Error('unauthorized_civic_genome_delivery:signature_format_invalid');
  const expected=computeAtlasCivicGenomeSignature(body,keyId,secret); const a=Buffer.from(signature,'hex'), b=Buffer.from(expected,'hex');
  if(a.length!==b.length||!timingSafeEqual(a,b)) throw new Error('unauthorized_civic_genome_delivery:signature_mismatch');
  const row=record(body,'delivery');
  if(row.delivery_contract_id!==ATLAS_CIVIC_GENOME_DELIVERY_CONTRACT_ID||row.delivery_contract_version!==ATLAS_CIVIC_GENOME_DELIVERY_CONTRACT_VERSION||row.source_schema_id!==CIVIC_GENOME_SOURCE_SCHEMA_ID) fail('delivery_contract_mismatch');
  const snapshot=assertCivicGenomeSnapshot(row.snapshot);
  if(row.source_contract_id!==snapshot.contract_id||row.source_contract_version!==snapshot.contract_version) fail('source_contract_mismatch');
  return snapshot;
}
