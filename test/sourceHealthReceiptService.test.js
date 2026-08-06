import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSourceHealthInsert,
  deriveSourceHealthFromIngestJob,
  recordSourceHealthReceipt,
} from '../src/services/sourceHealthReceiptService.js';

const completedJob = Object.freeze({
  id: '11111111-1111-4111-8111-111111111111',
  connector_id: '22222222-2222-4222-8222-222222222222',
  schema_id: '33333333-3333-4333-8333-333333333333',
  status: 'completed',
  started_at: '2026-04-29T22:44:42.449Z',
  completed_at: '2026-04-29T22:44:46.907Z',
  records_fetched: 20,
  records_inserted: 20,
  records_updated: 20,
  records_failed: 0,
  records_deduplicated: 20,
  next_cursor: null,
  error_log: {},
  metadata: { source: 'fixture' },
});

test('completed canonical ingest job produces deterministic healthy receipt', () => {
  const left = deriveSourceHealthFromIngestJob(completedJob);
  const right = deriveSourceHealthFromIngestJob({ ...completedJob });
  assert.deepEqual(left, right);
  assert.equal(left.health_status, 'healthy');
  assert.equal(left.freshness_status, 'unknown');
  assert.equal(left.schema_status, 'unknown');
  assert.equal(left.error_rate, 0);
  assert.equal(left.duplicate_rate, 1);
  assert.equal(left.latency_ms, 4458);
  assert.match(left.source_state_hash, /^[0-9a-f]{64}$/);
});

test('failed canonical ingest job produces failing receipt without inventing freshness or schema state', () => {
  const receipt = deriveSourceHealthFromIngestJob({
    ...completedJob,
    status: 'failed',
    records_inserted: 0,
    records_updated: 0,
    records_failed: 20,
    error_log: { fatal: 'HTTP 403' },
  });
  assert.equal(receipt.health_status, 'failing');
  assert.equal(receipt.error_rate, 1);
  assert.equal(receipt.freshness_status, 'unknown');
  assert.equal(receipt.schema_status, 'unknown');
});

test('completed run with partial record failures is degraded', () => {
  const receipt = deriveSourceHealthFromIngestJob({
    ...completedJob,
    records_failed: 2,
  });
  assert.equal(receipt.health_status, 'degraded');
  assert.equal(receipt.error_rate, 0.1);
});

test('zero fetched records preserve unknown rates instead of neutral defaults', () => {
  const receipt = deriveSourceHealthFromIngestJob({
    ...completedJob,
    records_fetched: 0,
    records_failed: 0,
    records_deduplicated: 0,
  });
  assert.equal(receipt.error_rate, null);
  assert.equal(receipt.duplicate_rate, null);
});

test('receipt insert preserves canonical identity fields and full details', () => {
  const receipt = deriveSourceHealthFromIngestJob(completedJob);
  const row = buildSourceHealthInsert(receipt);
  assert.equal(row.connector_id, receipt.connector_id);
  assert.equal(row.schema_id, receipt.schema_id);
  assert.equal(row.source_state_hash, receipt.source_state_hash);
  assert.deepEqual(row.details, receipt);
});

test('persistence uses exact source-health identity and is idempotent', async () => {
  const receipt = deriveSourceHealthFromIngestJob(completedJob);
  const calls = [];
  const client = {
    from(table) {
      calls.push(['from', table]);
      return {
        upsert(row, options) {
          calls.push(['upsert', row, options]);
          return {
            select(columns) {
              calls.push(['select', columns]);
              return {
                async maybeSingle() {
                  return {
                    data: {
                      health_event_id: '44444444-4444-4444-8444-444444444444',
                      connector_id: receipt.connector_id,
                      observed_at: receipt.observed_at,
                      source_state_hash: receipt.source_state_hash,
                    },
                    error: null,
                  };
                },
              };
            },
          };
        },
      };
    },
  };

  const result = await recordSourceHealthReceipt(receipt, client);
  assert.equal(result.persisted, true);
  assert.deepEqual(calls[0], ['from', 'atlas_source_health_event']);
  assert.equal(calls[1][2].onConflict, 'connector_id,observed_at,source_state_hash');
  assert.equal(calls[1][2].ignoreDuplicates, true);
});

test('missing canonical connector identity fails closed', () => {
  assert.throws(() => deriveSourceHealthFromIngestJob({
    ...completedJob,
    connector_id: null,
  }), /source_health_connector_id_required/);
});
