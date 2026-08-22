import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const scheduler = readFileSync(new URL('../src/services/scheduler.js', import.meta.url), 'utf8');
const projection = readFileSync(new URL('../src/services/streamRuntimeProjectionService.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../src/schema/20260811_atlas_stream_runtime_projection_bridge.sql', import.meta.url), 'utf8');

test('Atlas periodically projects authoritative stream/runtime state downstream', () => {
  assert.match(scheduler, /stream runtime projection scheduled every 15m/);
  assert.match(scheduler, /projectStreamRuntimeSnapshot/);
  assert.match(scheduler, /stream_runtime_projection: streamProjectionState/);
  assert.match(projection, /v_atlas_stream_runtime_summary_v1/);
  assert.match(projection, /atlas_action_receipt/);
  assert.match(projection, /bridge_atlas_stream_runtime_snapshot_v1/);
  assert.match(projection, /READ_RETRY_DELAYS_MS = Object\.freeze\(\[0, 1_000, 3_000\]\)/);
  assert.match(projection, /readWithRetry\('Atlas stream runtime read'/);
  assert.match(projection, /readWithRetry\('Atlas adapter receipt read'/);
  assert.match(projection, /failed after \$\{READ_RETRY_DELAYS_MS\.length\} attempts/);
});

test('stream projection includes runtime, observation, identity, schedule, and latest receipt state', () => {
  for (const token of [
    'observation_count',
    'identity_bound_observation_count',
    'observation_classification_count',
    'runnable',
    'adapter_name',
    'schedule_priority',
    'interval_hours',
    'last_run_status',
    'last_run_outcome',
    'last_error',
    'governance_contract_id',
  ]) assert.match(projection, new RegExp(token));
});

test('bridge credential stays database-side and function is service-role-only', () => {
  assert.match(migration, /config_json->>'domain3_receipt_token'/);
  assert.match(migration, /\/api\/atlas-domain3\/streams/);
  assert.match(migration, /revoke all on function public\.bridge_atlas_stream_runtime_snapshot_v1\(jsonb\)/);
  assert.match(migration, /grant execute on function public\.bridge_atlas_stream_runtime_snapshot_v1\(jsonb\)\s+to service_role/);
  assert.doesNotMatch(projection, /domain3_receipt_token/);
});
