import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const replay = readFileSync(new URL('../src/services/domain3PopulationReplayService.js', import.meta.url), 'utf8');
const integrityDetector = readFileSync(new URL('../src/services/integrityPatternDetectorService.js', import.meta.url), 'utf8');
const bridge = readFileSync(new URL('../src/services/liveDataSignalBridgeService.js', import.meta.url), 'utf8');
const ingestClient = readFileSync(new URL('../src/adapters/ingestClient.js', import.meta.url), 'utf8');
const streamStore = readFileSync(new URL('../src/services/streamStore.js', import.meta.url), 'utf8');
const persistenceMigration = readFileSync(new URL('../src/schema/20260811_domain3_population_persistence_rpc.sql', import.meta.url), 'utf8');
const lighthouseProjectionMigration = readFileSync(new URL('../src/schema/20260811_domain3_lighthouse_state_projection.sql', import.meta.url), 'utf8');
const entityIdentityMigration = readFileSync(new URL('../src/schema/20260815090032_domain3_entity_aware_candidate_semantic_identity.sql', import.meta.url), 'utf8');
const sequentialSeedMigration = readFileSync(new URL('../src/schema/20260815090211_domain3_propublica_sequential_candidate_upsert.sql', import.meta.url), 'utf8');
const currentnessGuardMigration = readFileSync(new URL('../src/schema/20260815090334_domain3_currentness_upsert_self_conflict_guard.sql', import.meta.url), 'utf8');
const retirementMigration = readFileSync(new URL('../src/schema/20260815092738_domain3_negative_currentness_retirement.sql', import.meta.url), 'utf8');
const signalSchema = JSON.parse(readFileSync(new URL('../src/schema/json/signal_event.json', import.meta.url), 'utf8'));

test('Domain 3 full replay scans the current bounded observation substrate and persists per-rule runs', () => {
  assert.match(replay, /DEFAULT_OBSERVATION_LIMIT = 100000/);
  assert.match(replay, /complete_identity_bound_observation_population/);
  assert.match(replay, /candidate_limit_per_rule/);
  assert.match(replay, /atlas\.domain3\.cross_jurisdiction_recurrence/);
  assert.match(replay, /minimum_jurisdictions: 2/);
  assert.match(replay, /not misconduct, causation, or legal finding/);
  assert.match(replay, /register_domain3_population_rules_v1/);
  assert.match(replay, /persist_domain3_population_run_v1/);
  assert.match(replay, /\.order\('stream_id', \{ ascending: true \}\)[\s\S]*\.order\('offset', \{ ascending: true \}\)/);
  assert.doesNotMatch(replay, /\.order\('ingested_at'/);
  assert.doesNotMatch(replay, /\.schema\('atlas'\)/);
});

test('integrity patterns are derived inside Atlas and use the existing candidate receipt path', () => {
  assert.match(replay, /deriveIntegrityPatternCandidates\(observations\)/);
  assert.match(replay, /summarizeIntegrityPatternReadiness\(observations\)/);
  assert.match(replay, /INTEGRITY_PATTERN_RULES/);
  assert.match(integrityDetector, /atlas\.domain3\.integrity\.financial_conduit/);
  assert.match(integrityDetector, /atlas\.domain3\.integrity\.legislative_financial_convergence/);
  assert.match(integrityDetector, /no fuzzy name matching/);
  assert.match(integrityDetector, /not proof of corruption/);
  assert.doesNotMatch(integrityDetector, /\.insert\(|\.upsert\(|\.rpc\(/);
});

test('Domain 3 internal tables stay behind service-role RPC boundaries', () => {
  assert.match(persistenceMigration, /security definer/);
  assert.match(persistenceMigration, /revoke all on function public\.register_domain3_population_rules_v1\(jsonb\) from public, anon, authenticated/);
  assert.match(persistenceMigration, /grant execute on function public\.register_domain3_population_rules_v1\(jsonb\) to service_role/);
  assert.match(persistenceMigration, /revoke all on function public\.persist_domain3_population_run_v1\(jsonb,uuid,bigint,jsonb\) from public, anon, authenticated/);
  assert.match(persistenceMigration, /atlas\.live_data_signal_candidate/);
});

test('canonical stream registry resolves transport aliases without inventing duplicate identity', () => {
  assert.match(streamStore, /recognizes source_id when it is actually the registered stream_id/);
  assert.match(streamStore, /No uniquely registered stream found/);
  assert.match(streamStore, /stream_contract_id: stream\.stream_id/);
  assert.match(streamStore, /source_id: stream\.source_id/);
  assert.match(streamStore, /jurisdiction_id: stream\.jurisdiction_id/);
  assert.match(streamStore, /module_hint: stream\.module_hint/);
});

test('narrow ProPublica seed cannot gate full population replay', () => {
  const seedIndex = bridge.indexOf('const seed = await runSeedDetector');
  const populationIndex = bridge.indexOf('const populationDetection = await populationDetector');
  assert.ok(seedIndex >= 0 && populationIndex > seedIndex);
  assert.match(bridge, /seed detector unavailable/);
  assert.doesNotMatch(bridge, /throw new Error\(`Atlas Domain 3 detection returned no completed run receipt/);
});

test('one Domain 3 rule failure cannot silence later detector rules', () => {
  assert.match(replay, /const ruleErrors = \[\]/);
  assert.match(replay, /for \(const rule of rules\.values\(\)\)/);
  assert.match(replay, /try \{[\s\S]*persistRuleRun/);
  assert.match(replay, /ruleErrors\.push/);
  assert.match(replay, /status: ruleErrors\.length \|\| ruleWarnings\.length \? 'partial' : 'completed'/);
  assert.match(replay, /rule_errors: ruleErrors/);
  assert.match(bridge, /populationDetection\?\.status === 'partial'/);
  assert.match(bridge, /population_rule_errors: populationRuleErrors/);
  assert.match(bridge, /map\(\(run\) => run\.run_id\)\.filter\(Boolean\)/);
});

test('complete non-truncated replay retires absent candidates but truncated replay fails closed', () => {
  assert.match(replay, /reconcile_domain3_population_currentness_v1/);
  assert.match(replay, /const replayComplete = completeRuleCandidates\.length <= boundedPerRule/);
  assert.match(replay, /candidate_limit_truncated_replay_currentness_not_reconciled/);
  assert.match(retirementMigration, /p_replay_complete boolean/);
  assert.match(retirementMigration, /replay_not_complete_or_truncated/);
  assert.match(retirementMigration, /run_superseded_by_newer_completed_replay/);
  assert.match(retirementMigration, /set is_current=false, retired_at=v_retired_at/);
  assert.match(retirementMigration, /not_observed_in_complete_replay/);
  assert.doesNotMatch(retirementMigration, /delete\s+from\s+atlas\.live_data_signal_candidate/i);
});

test('Atlas bridges retirement receipts separately from positive signal receipts', () => {
  assert.match(retirementMigration, /bridge_live_data_signal_retirements_v1/);
  assert.match(retirementMigration, /\/api\/atlas-domain3\/retirement/);
  assert.match(bridge, /bridgeRetirements/);
  assert.match(bridge, /retirement_bridge: retirementBridge/);
  assert.match(bridge, /retirementBridgeErrors/);
});

test('ProPublica entity-specific candidates cannot retire independent entities', () => {
  assert.match(entityIdentityMigration, /live_data_signal_candidate_semantic_key_v2/);
  assert.match(entityIdentityMigration, /p_entity_ids text\[\]/);
  assert.match(entityIdentityMigration, /atlas\.propublica_unresolved_filing_metadata_rate/);
  assert.match(entityIdentityMigration, /string_agg\(value, chr\(30\) order by value\)/);
  assert.match(sequentialSeedMigration, /for v_row in/);
  assert.match(sequentialSeedMigration, /persistence_mode', 'sequential_idempotent_upsert/);
});

test('candidate replay cannot self-conflict with its ON CONFLICT target', () => {
  assert.match(currentnessGuardMigration, /candidate_hash <> new\.candidate_hash/);
  assert.match(currentnessGuardMigration, /BEFORE INSERT trigger must never mutate/);
  assert.match(currentnessGuardMigration, /INSERT ON CONFLICT may safely replay an already-current candidate/);
});

test('adapter ingress uses bounded replay-friendly batches and emits upstream Atlas validation detail', () => {
  assert.match(ingestClient, /DEFAULT_INGEST_BATCH_SIZE = 100/);
  assert.match(ingestClient, /MAX_INGEST_BATCH_SIZE = 500/);
  assert.match(ingestClient, /DEFAULT_INGEST_TIMEOUT_MS = 60_000/);
  assert.match(ingestClient, /MAX_INGEST_TIMEOUT_MS = 180_000/);
  assert.match(ingestClient, /ATLAS_INGEST_TIMEOUT_MS/);
  assert.match(ingestClient, /atlas_ingest_failed batch=/);
  assert.match(ingestClient, /records_failed/);
  assert.match(ingestClient, /partial_completion/);
});

test('Lighthouse projection preserves uncertainty rather than promoting unverified candidates', () => {
  assert.match(lighthouseProjectionMigration, /else 'unresolved'/);
  assert.match(lighthouseProjectionMigration, /atlas_candidate_verification_state/);
  assert.match(lighthouseProjectionMigration, /atlas_candidate_entity_resolution_status/);
  assert.match(lighthouseProjectionMigration, /'governance_status', 'observation_candidate'/);
  assert.match(lighthouseProjectionMigration, /state_projection/);
  assert.match(lighthouseProjectionMigration, /atlas_candidate_to_lighthouse_governed_state_v1/);
});

test('provenance channel accepts governed source-native channel identities', () => {
  const channel = signalSchema.properties.provenance.properties.channel;
  assert.equal(channel.type, 'string');
  assert.equal(channel.minLength, 1);
  assert.equal(Object.hasOwn(channel, 'enum'), false);
});
