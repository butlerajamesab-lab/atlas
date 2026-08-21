import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { sha256 } from '../src/substrate/canonical.js';
import {
  CIVIC_GENOME_SOURCE_SCHEMA_ID,
  CIVIC_GENOME_SOURCE_CONTRACT_ID,
  CIVIC_GENOME_SOURCE_CONTRACT_VERSION,
  ATLAS_CIVIC_GENOME_DELIVERY_CONTRACT_ID,
  ATLAS_CIVIC_GENOME_DELIVERY_CONTRACT_VERSION,
  civicGenomeComponentHashBasis,
  civicGenomeSnapshotHashBasis,
  computeAtlasCivicGenomeSignature,
  assertCivicGenomeSnapshot,
} from '../src/civic-genome/civicGenomeSnapshot.js';
import {
  acceptAtlasCivicGenomeSnapshot,
  buildAtlasCivicGenomeBinding,
} from '../src/services/civicGenomeSnapshotIntakeService.js';

const KEY_ID='lighthouse-atlas-civic-genome-v1';
const SECRET='0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const HASH='1'.repeat(64);
const SNAPSHOT_INTAKE_SQL = readFileSync(
  new URL('../src/schema/20260806_civic_genome_external_snapshot_intake.sql', import.meta.url),
  'utf8',
);

function validSnapshot(){
  const component={
    component_id:'civic_genome:family:a9620a24-9ae4-487d-a55b-5e646c729432',
    component_type:'family',
    canonical_record_id:'a9620a24-9ae4-487d-a55b-5e646c729432',
    inclusion_state:'current',
    jurisdiction_code:null,
    temporal_scope:'2026-08-06T18:00:00.000Z',
    value:{family_status:'active'},
    source_bindings:[{owner_service:'civic_genome',record_type:'civic_genome_family',record_id:'a9620a24-9ae4-487d-a55b-5e646c729432',receipt_id:null,content_hash:HASH,engine_id:'fixture',engine_version:'1.0.0',rule_id:'fixture',rule_version:'1.0.0'}],
    source_verification:[{owner_service:'civic_genome',state:'active',receipt_id:null,evidence_hash:HASH,mapping_state:'source_native_preserved'}],
    unresolved_conditions:[],
  };
  component.component_hash=sha256(civicGenomeComponentHashBasis(component));
  const snapshot={
    contract_id:CIVIC_GENOME_SOURCE_CONTRACT_ID,
    contract_version:CIVIC_GENOME_SOURCE_CONTRACT_VERSION,
    canonical_owner:'lighthouse/civic_genome',
    snapshot_id:'cg-family-snapshot-atlas-proof',
    snapshot_kind:'baseline_export',
    immutable:true,
    scope:{scope_type:'family',scope_ids:['a9620a24-9ae4-487d-a55b-5e646c729432'],jurisdiction_codes:['WA']},
    as_of:'2026-08-06T18:00:00.000Z',
    methodology_version:'civic_genome_external_family_snapshot.1.0.0',
    components:[component],component_count:1,unresolved_conditions:[],excluded_component_types:[],completeness_state:'bounded_complete',
  };
  snapshot.snapshot_hash=sha256(civicGenomeSnapshotHashBasis(snapshot));
  const replay=sha256({contract_id:snapshot.contract_id,contract_version:snapshot.contract_version,snapshot_id:snapshot.snapshot_id,snapshot_hash:snapshot.snapshot_hash,methodology_version:snapshot.methodology_version});
  const receiptBasis={export_receipt_id:'cg-export-atlas-proof',snapshot_hash:snapshot.snapshot_hash,deterministic_replay_key:replay,source_commit_sha:'abc123'};
  snapshot.export_receipt={...receiptBasis,export_receipt_hash:sha256(receiptBasis),replay_state:'original',generated_at:'2026-08-06T18:00:01.000Z'};
  return snapshot;
}
function body(snapshot){return{delivery_contract_id:ATLAS_CIVIC_GENOME_DELIVERY_CONTRACT_ID,delivery_contract_version:ATLAS_CIVIC_GENOME_DELIVERY_CONTRACT_VERSION,source_schema_id:CIVIC_GENOME_SOURCE_SCHEMA_ID,source_contract_id:snapshot.contract_id,source_contract_version:snapshot.contract_version,snapshot};}

test('Atlas independently validates Civic Genome component, snapshot and export receipt hashes',()=>{
  const snapshot=validSnapshot(); assert.equal(assertCivicGenomeSnapshot(snapshot),snapshot);
  const mutated=structuredClone(snapshot); mutated.components[0].value.family_status='changed';
  assert.throws(()=>assertCivicGenomeSnapshot(mutated),/component_hash_mismatch/);
});

test('Atlas binding preserves source-native state without projection',()=>{
  const binding=buildAtlasCivicGenomeBinding(validSnapshot());
  assert.equal(binding.verification_mapping_state,'source_native_preserved_unmapped');
  assert.equal(binding.atlas_projection_state,'not_executed');
  assert.equal(binding.no_mutation,true);
  assert.equal(binding.component_manifest[0].atlas_signal_ids.length,0);
  assert.match(binding.atlas_binding_hash,/^[0-9a-f]{64}$/);
});

test('authenticated intake persists through bounded RPC and is idempotency-aware',async()=>{
  const snapshot=validSnapshot(); const requestBody=body(snapshot);
  const signature=computeAtlasCivicGenomeSignature(requestBody,KEY_ID,SECRET);
  let observed=null;
  const client={rpc:async(name,args)=>{observed={name,args};return{data:{status:'inserted'},error:null};}};
  const receipt=await acceptAtlasCivicGenomeSnapshot({body:requestBody,key_id:KEY_ID,signature,environment:{ATLAS_CIVIC_GENOME_HANDSHAKE_KEY_ID:KEY_ID,ATLAS_CIVIC_GENOME_HANDSHAKE_SECRET:SECRET},client});
  assert.equal(observed.name,'atlas_civic_genome_snapshot_persist_v1');
  assert.equal(receipt.persisted,true); assert.equal(receipt.projection_executed,false);
  assert.equal(observed.args.p_record.snapshot.snapshot_hash,snapshot.snapshot_hash);
});

test('authenticated intake accepts durable idempotent replay receipts',async()=>{
  const snapshot=validSnapshot(); const requestBody=body(snapshot);
  const signature=computeAtlasCivicGenomeSignature(requestBody,KEY_ID,SECRET);
  const client={rpc:async()=>({data:{status:'idempotent'},error:null})};
  const receipt=await acceptAtlasCivicGenomeSnapshot({body:requestBody,key_id:KEY_ID,signature,environment:{ATLAS_CIVIC_GENOME_HANDSHAKE_KEY_ID:KEY_ID,ATLAS_CIVIC_GENOME_HANDSHAKE_SECRET:SECRET},client});
  assert.equal(receipt.persistence_status,'idempotent');
  assert.equal(receipt.persisted,true);
  assert.equal(receipt.projection_executed,false);
});

test('database replay guard treats same source snapshot hash as idempotent',()=>{
  const foundBlock = SNAPSHOT_INTAKE_SQL.slice(
    SNAPSHOT_INTAKE_SQL.indexOf('if found then'),
    SNAPSHOT_INTAKE_SQL.indexOf('insert into atlas.civic_genome_external_snapshot'),
  );
  assert.match(foundBlock,/v_existing\.source_snapshot_hash is distinct from v_snapshot_hash/);
  assert.match(foundBlock,/'status','idempotent'/);
  assert.doesNotMatch(foundBlock,/source_export_receipt_hash is distinct/);
  assert.doesNotMatch(foundBlock,/atlas_binding_hash is distinct/);
  assert.doesNotMatch(foundBlock,/snapshot_json is distinct/);
});

test('wrong HMAC fails before persistence',async()=>{
  const snapshot=validSnapshot(); const requestBody=body(snapshot); let calls=0;
  await assert.rejects(()=>acceptAtlasCivicGenomeSnapshot({body:requestBody,key_id:KEY_ID,signature:'0'.repeat(64),environment:{ATLAS_CIVIC_GENOME_HANDSHAKE_KEY_ID:KEY_ID,ATLAS_CIVIC_GENOME_HANDSHAKE_SECRET:SECRET},client:{rpc:async()=>{calls+=1;return{data:null,error:null};}}}),/signature_mismatch/);
  assert.equal(calls,0);
});
