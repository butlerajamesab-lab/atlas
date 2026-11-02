import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { assertCompleteAdapterReceipt } from '../src/services/adapterReceiptAcceptance.js';
import { toIsoTimestamp } from '../src/adapters/ingestClient.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const scheduler = read('../src/services/scheduler.js');
const runner = read('../scripts/run-all-adapters.mjs');
const hud = read('../src/adapters/hudHousingAdapter.js');

test('completed, replay-only, and explicitly empty source receipts are eligible', () => {
  for (const receipt of [
    { accepted: true, status: 'completed', ingested_count: 5, records_failed: 0, partial_completion: false },
    { accepted: true, status: 'completed', ingested_count: 0, replayed_count: 5, records_failed: 0 },
    { accepted: true, status: 'source_empty', ingested_count: 0 },
  ]) assert.equal(assertCompleteAdapterReceipt(receipt), receipt);
});

test('partial, failed, missing and invalid receipts cannot report success', () => {
  for (const receipt of [
    null, undefined, {}, { accepted: false, status: 'completed' },
    { accepted: true, status: 'failed' },
    { accepted: true, status: 'error' },
    { accepted: true, status: 'partial' },
    { accepted: true, status: 'completed', partial_completion: true },
    { accepted: true, status: 'completed', records_failed: 1 },
    { accepted: true, status: 'completed', records_failed: 'unknown' },
  ]) assert.throws(() => assertCompleteAdapterReceipt(receipt), /atlas_adapter_(missing|incomplete|invalid)_receipt/);
});

test('scheduler and runner both enforce transport acceptance', () => {
  assert.match(scheduler, /assertCompleteAdapterReceipt\(adapterResult\)/);
  assert.match(runner, /assertCompleteAdapterReceipt\(result\)/);
  assert.match(runner, /failed > 0 \|\| \(skipped > 0 && !DRY_RUN\)/);
});

test('manual runner names match every scheduled adapter name', () => {
  const start = scheduler.indexOf('const ADAPTER_REGISTRY = [');
  const end = scheduler.indexOf('const ADAPTER_STREAM_IDS', start);
  assert.ok(start >= 0 && end > start);
  const scheduledNames = [...scheduler.slice(start, end).matchAll(/name:\s*'([^']+)'/g)].map(m => m[1]).sort();
  const manualNames = [...runner.slice(runner.indexOf('const adapters = ['), runner.indexOf('];')).matchAll(/name:\s*'([^']+)'/g)].map(m => m[1]).sort();
  assert.deepEqual(manualNames, scheduledNames);
});

test('HUD missing credentials and malformed source responses fail closed', () => {
  assert.match(hud, /throw new Error\('hud_credentials_missing:/);
  assert.match(hud, /throw new Error\('hud_unexpected_response_shape:/);
  assert.doesNotMatch(hud, /Skipping fetch/);
});

test('source event time must come from the provider, never current ingest time', () => {
  assert.equal(toIsoTimestamp('2026-10-31'), '2026-10-31T00:00:00.000Z');
  assert.throws(() => toIsoTimestamp(), /atlas_source_timestamp_missing/);
  assert.throws(() => toIsoTimestamp(null, ''), /atlas_source_timestamp_missing/);
  assert.throws(() => toIsoTimestamp('not-a-timestamp'), /atlas_source_timestamp_invalid/);
  assert.doesNotMatch(read('../src/services/streamStore.js'), /incoming\.timestamp \?\? new Date\(\)/);
  assert.match(read('../src/services/streamStore.js'), /atlas_source_timestamp_missing_or_invalid/);
});
