import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const schedulerSource = readFileSync(new URL('../src/services/scheduler.js', import.meta.url), 'utf8');
const childSource = readFileSync(new URL('../scripts/run-domain3-bridge-cycle.mjs', import.meta.url), 'utf8');

test('the domain 3 cycle runs in a child process, not the web service heap', () => {
  assert.match(schedulerSource, /spawn\(process\.execPath, \[scriptPath\]/);
  assert.match(schedulerSource, /run-domain3-bridge-cycle\.mjs/);
  assert.match(schedulerSource, /DOMAIN3_CHILD_TIMEOUT_MS = 30 \* 60 \* 1000/);
  // The scheduler no longer calls the bridge in-process.
  assert.doesNotMatch(schedulerSource, /await runLiveDataSignalBridge\(\)/);
  assert.doesNotMatch(schedulerSource, /from '.\/liveDataSignalBridgeService\.js'/);
});

test('the child runs the same bridge entry and speaks the receipt protocol', () => {
  assert.match(childSource, /from '..\/src\/services\/liveDataSignalBridgeService\.js'/);
  assert.match(childSource, /runLiveDataSignalBridge\(process\.env\)/);
  assert.match(childSource, /BRIDGE_CYCLE_RESULT \$\{JSON\.stringify\(\{ ok: true, result \}\)\}/);
  assert.match(childSource, /BRIDGE_CYCLE_RESULT \$\{JSON\.stringify\(\{ ok: false, error: message \}\)\}/);
});

test('receipt protocol works end to end (child without config fails closed)', () => {
  const childPath = new URL('../scripts/run-domain3-bridge-cycle.mjs', import.meta.url).pathname;
  const run = spawnSync(process.execPath, [childPath], {
    env: { PATH: process.env.PATH },
    encoding: 'utf8',
    timeout: 60_000,
  });
  const line = (run.stdout || '').split('\n').filter((l) => l.startsWith('BRIDGE_CYCLE_RESULT ')).pop();
  assert.ok(line, 'child must always emit exactly one receipt line');
  const receipt = JSON.parse(line.slice('BRIDGE_CYCLE_RESULT '.length));
  assert.equal(receipt.ok, false);
  assert.match(String(receipt.error), /SUPABASE|required|configuration/i);
  assert.equal(run.status, 1);
});
