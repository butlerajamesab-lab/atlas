import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { sha256 } from '../src/substrate/canonical.js';
import { buildLegislativeTraitBindingAccounting } from '../src/civic-genome/legislativeTraitAccounting.js';

const projectionKey='a'.repeat(64);
function trait(id,run,hash){return{component_id:`civic_genome:trait:${id}`,component_type:'trait',canonical_record_id:id,component_hash:sha256(id),value:{extraction_run_id:run,trait_class:'workflow',source_trace:[{rosetta_source_content_hash:hash,rosetta_source_identity_hash:sha256(`${run}:${hash}`)}]}};}
function fixture(){const sourceHash='b'.repeat(64);return{methodology_version:'civic_genome_external_family_snapshot.1.1.0',snapshot_id:'s1',snapshot_hash:'c'.repeat(64),components:[{component_id:'civic_genome:bill:g1',component_type:'bill',canonical_record_id:'g1',component_hash:'d'.repeat(64),value:{bill_versions:[{bill_version_id:'v1',version_type:'chaptered',rosetta_extraction_run_id:'525'}]}},trait('t1','525',sourceHash),trait('t2','18',sourceHash)]};}

test('exact and historical same-source generations account for the whole trait population',()=>{const result=buildLegislativeTraitBindingAccounting(fixture(),projectionKey);assert.equal(result.total_trait_count,2);assert.equal(result.exact_version_bound_trait_count,1);assert.equal(result.historical_same_source_trait_count,1);assert.equal(result.unresolved_trait_count,0);assert.equal(result.completeness_state,'complete');assert.deepEqual(result.version_accounting[0].historical_extraction_run_ids,['18']);});

test('historical generation is not collapsed into exact-run traits',()=>{const result=buildLegislativeTraitBindingAccounting(fixture(),projectionKey);assert.deepEqual(result.version_accounting[0].exact_trait_ids,['t1']);assert.deepEqual(result.version_accounting[0].historical_trait_ids,['t2']);});

test('ambiguous same-source match remains unresolved',()=>{const value=fixture();value.components[0].value.bill_versions.push({bill_version_id:'v2',version_type:'enrolled',rosetta_extraction_run_id:'526'});value.components.push(trait('t3','526','b'.repeat(64)));const result=buildLegislativeTraitBindingAccounting(value,projectionKey);assert.equal(result.unresolved_trait_count,1);assert.equal(result.completeness_state,'incomplete');assert.equal(result.unresolved_traits[0].unresolved_reason,'ambiguous_source_content_version_match');});

test('accounting persistence is immutable and count constrained',()=>{const sql=readFileSync(new URL('../src/schema/20260806_civic_genome_trait_binding_accounting.sql',import.meta.url),'utf8');assert.match(sql,/prevent_civic_genome_trait_accounting_mutation/);assert.match(sql,/civic_genome_trait_accounting_counts_match/);assert.match(sql,/accounting_identity_collision/);assert.match(sql,/projection_mismatch/);});
