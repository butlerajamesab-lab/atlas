import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const replay = readFileSync(new URL('../src/services/domain3PopulationReplayService.js', import.meta.url), 'utf8');
const bridge = readFileSync(new URL('../src/services/liveDataSignalBridgeService.js', import.meta.url), 'utf8');
const ingestClient = readFileSync(new URL('../src/adapters/ingestClient.js', import.meta.url), 'utf8');
const signalSchema = JSON.parse(readFileSync(new URL('../src/schema/json/signal_event.json', import.meta.url), 'utf8'));

test('Domain 3 full replay scans the current bounded observation substrate and persists per-rule runs', () => {
  assert.match(replay, /DEFAULT_OBSERVATION_LIMIT = 100000/);
  assert.match(replay, /complete_identity_bound_observation_population/);
  assert.match(replay, /candidate_limit_per_rule/);
  assert.match(replay, /atlas\.domain3\.cross_jurisdiction_recurrence/);
  assert.match(replay, /minimum_jurisdictions: 2/);
  assert.match(replay, /not misconduct, causation, or legal finding/);
  assert.match(replay, /live_data_signal_rule/);
  assert.match(replay, /live_data_signal_run/);
  assert.match(replay, /live_data_signal_candidate/);
});

test('narrow ProPublica seed cannot gate full population replay', () => {
  const seedIndex = bridge.indexOf('const seed = await runSeedDetector');
  const populationIndex = bridge.indexOf('const populationDetection = await populationDetector');
  assert.ok(seedIndex >= 0 && populationIndex > seedIndex);
  assert.match(bridge, /seed detector unavailable/);
  assert.doesNotMatch(bridge, /throw new Error\(`Atlas Domain 3 detection returned no completed run receipt/);
});

test('adapter ingress is batched and emits upstream Atlas validation detail', () => {
  assert.match(ingestClient, /DEFAULT_INGEST_BATCH_SIZE = 200/);
  assert.match(ingestClient, /MAX_INGEST_BATCH_SIZE = 500/);
  assert.match(ingestClient, /atlas_ingest_failed batch=/);
  assert.match(ingestClient, /records_failed/);
  assert.match(ingestClient, /partial_completion/);
});

test('provenance channel accepts governed source-native channel identities', () => {
  const channel = signalSchema.properties.provenance.properties.channel;
  assert.equal(channel.type, 'string');
  assert.equal(channel.minLength, 1);
  assert.equal(Object.hasOwn(channel, 'enum'), false);
});
