import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadSourcePopulation,
  transformSignalEventDetailed,
  buildConvergenceComputation,
  executeConvergenceRun,
} from '../src/services/convergenceRunner.js';
import { sha256 } from '../src/substrate/canonical.js';
import { loadWashingtonGeography } from '../src/substrate/geographyLoader.js';

function canonicalRow(stream, offset, jurisdiction = 'WA') {
  return {
    stream_id: stream,
    offset: String(offset),
    timestamp: '2026-07-01T00:00:00Z',
    signal_type: 'test_signal',
    spacetime: {},
    provenance: { source: 'test' },
    payload: { value: offset },
    source_id: 'test',
    jurisdiction_id: jurisdiction,
    module_hint: 'test',
    ingested_at: '2026-07-01T00:00:01Z',
    event_identity_hash: sha256({ stream, offset }),
    canonical_identity: { canonical_offset: String(offset), replay_count: '0' },
  };
}

test('source population loader paginates canonical identity rows without truncation', async () => {
  const rows = [canonicalRow('a', 1), canonicalRow('a', 2), canonicalRow('b', 1)];
  const calls = [];
  const supabase = {
    async rpc(name, args) {
      assert.equal(name, 'atlas_convergence_source_population_page_v1');
      calls.push(args);
      let start = 0;
      if (args.p_after_stream_id !== null) {
        start = rows.findIndex((row) => row.stream_id === args.p_after_stream_id
          && row.offset === String(args.p_after_offset)) + 1;
      }
      const page = rows.slice(start, start + args.p_limit).map((row) => ({ row_json: row }));
      return { data: page, error: null };
    },
  };
  const loaded = await loadSourcePopulation(supabase, {
    as_of: Date.parse('2026-08-01T00:00:00Z'),
    time_window_ms: 60 * 86400000,
    page_size: 2,
  });
  assert.equal(loaded.total_count, 3);
  assert.equal(calls.length, 2);
  assert.deepEqual(loaded.rows.map((row) => `${row.stream_id}:${row.offset}`), ['a:1', 'a:2', 'b:1']);
});

test('signal transformation resolves the postal alias mechanically and rejects invalid confidence', () => {
  const geography = loadWashingtonGeography();
  const valid = transformSignalEventDetailed(canonicalRow('a', 1, 'WA'), geography.records, 'state');
  assert.equal(valid.reason, null);
  assert.equal(valid.signal.spatial_coordinate, 'US_WA');

  const invalid = canonicalRow('a', 2, 'WA');
  invalid.payload.confidence = 4;
  const rejected = transformSignalEventDetailed(invalid, geography.records, 'state');
  assert.equal(rejected.signal, null);
  assert.equal(rejected.reason, 'invalid_confidence');
});

test('complete registry evaluation emits zero-outcome receipts', () => {
  const geography = loadWashingtonGeography();
  const computation = buildConvergenceComputation({
    source_population: [],
    geography_package: geography,
    configuration: {
      as_of: Date.parse('2026-08-01T00:00:00Z'),
      time_window_ms: 30 * 86400000,
      temporal_bucket_ms: 86400000,
      geography_registry_version: geography.registry_hash,
      analysis_level: 'county',
      min_signals_for_analysis: 0,
      z_score_threshold: 2,
      persist: false,
    },
    target_geographies: null,
  });
  assert.equal(computation.receipts.length, 39);
  assert.ok(computation.receipts.every((receipt) => receipt.status === 'unresolved'));
  assert.ok(computation.receipts.every((receipt) => /^[a-f0-9]{64}$/.test(receipt.receipt_identity)));
});

test('executeConvergenceRun performs one atomic persistence RPC', async () => {
  const geography = loadWashingtonGeography();
  const sourceRows = [canonicalRow('a', 1, 'WA')];
  let persistenceBundle = null;
  const supabase = {
    async rpc(name, args) {
      if (name === 'atlas_convergence_source_population_page_v1') {
        if (args.p_after_stream_id !== null) return { data: [], error: null };
        return { data: sourceRows.map((row) => ({ row_json: row })), error: null };
      }
      if (name === 'atlas_convergence_persist_run_v1') {
        persistenceBundle = args.p_bundle;
        return {
          data: {
            status: 'created',
            run_key: args.p_bundle.manifest.run_key,
            output_hash: args.p_bundle.result.output_hash,
            receipt_count: args.p_bundle.receipts.length,
          },
          error: null,
        };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
  };
  const result = await executeConvergenceRun({
    supabase,
    as_of: Date.parse('2026-08-01T00:00:00Z'),
    time_window_ms: 60 * 86400000,
    temporal_bucket_ms: 86400000,
    geography_registry_version: geography.registry_hash,
    analysis_level: 'state',
    min_signals_for_analysis: 1,
    z_score_threshold: 2,
    target_geographies: ['US_WA'],
    persist: true,
  });
  assert.equal(result.persistence.status, 'created');
  assert.ok(persistenceBundle);
  assert.equal(persistenceBundle.snapshots.length, 3);
  assert.equal(persistenceBundle.receipts[0].receipt_identity, result.receipts[0].receipt_identity);
  assert.equal(persistenceBundle.manifest.source_population_hash, sha256(sourceRows));
});
