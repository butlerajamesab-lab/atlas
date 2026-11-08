import assert from 'node:assert/strict';
import test from 'node:test';
import { executeDomain3FullReplay } from '../src/services/domain3PopulationReplayService.js';
import { executeLiveDataSignalCycle } from '../src/services/liveDataSignalBridgeService.js';

// Fake Atlas client covering exactly the surface the full-set replay and
// the bridge drains use: streams registry, signal_events paging + counts,
// the derivation-state table, and the Domain 3 RPCs.

function hash(n) {
  return String(n).padStart(64, '0').slice(-64);
}

function buildReservoir() {
  // Stream A (WA): five cities x 30 events. Stream B (NY): the same five
  // cities x 10 plus 230 other cities x 10. Geographic concentration in A
  // fires exactly five geographic_cluster candidates; nothing else fires
  // (unique categories, no entities, single year, no declarations).
  const rows = [];
  const cities = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'];
  let n = 0;
  const push = (stream, jurisdiction, city) => {
    n += 1;
    rows.push({
      stream_id: stream,
      offset: rows.filter((row) => row.stream_id === stream).length + 1,
      timestamp: '2025-06-01T00:00:00.000Z',
      ingested_at: '2025-06-02T00:00:00.000Z',
      signal_type: 'request',
      spacetime: { jurisdiction, city },
      provenance: { channel: 'test' },
      payload: { category: `unique_${n}` },
      source_id: stream,
      jurisdiction_id: jurisdiction,
      module_hint: 'test',
      event_identity_hash: hash(n),
    });
  };
  for (const city of cities) for (let i = 0; i < 30; i += 1) push('stream_a', 'WA', city);
  for (const city of cities) for (let i = 0; i < 10; i += 1) push('stream_b', 'NY', city);
  for (let c = 0; c < 230; c += 1) for (let i = 0; i < 10; i += 1) push('stream_b', 'NY', `Other ${c}`);
  return rows; // 150 + 50 + 2300 = 2500
}

class FakeQuery {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this.filters = {};
    this.countMode = false;
    this.rangeSpec = null;
    this.limitVal = null;
    this.single = false;
  }

  select(_cols, opts) {
    if (opts?.count === 'exact') this.countMode = true;
    return this;
  }

  eq(key, value) { this.filters[key] = value; return this; }
  not() { return this; }
  order() { return this; }
  limit(value) { this.limitVal = value; return this; }
  range(from, to) { this.rangeSpec = [from, to]; return this; }
  maybeSingle() { this.single = true; return this; }

  upsert(row) {
    this.db.stateRow = { ...row };
    this.db.stateUpserts.push(row);
    return Promise.resolve({ error: null });
  }

  then(resolve, reject) {
    return Promise.resolve().then(() => this.execute()).then(resolve, reject);
  }

  execute() {
    const { db } = this;
    if (this.table === 'streams') {
      return { data: db.streamIds.map((stream_id) => ({ stream_id })), error: null };
    }
    if (this.table === 'atlas_derivation_state') {
      return { data: db.stateRow, error: null };
    }
    if (this.table === 'signal_events') {
      const filtered = db.rows.filter((row) => !this.filters.stream_id || row.stream_id === this.filters.stream_id);
      if (this.countMode) return { data: null, count: filtered.length, error: null };
      if (this.single && this.limitVal === 1) {
        const max = filtered.reduce((acc, row) => Math.max(acc, row.offset), null);
        return { data: max === null ? null : { offset: max }, error: null };
      }
      if (this.rangeSpec) {
        db.rangeReads += 1;
        const [from, to] = this.rangeSpec;
        const sorted = [...db.rows].sort((a, b) => String(a.stream_id).localeCompare(String(b.stream_id)) || a.offset - b.offset);
        return { data: sorted.slice(from, to + 1), error: null };
      }
    }
    throw new Error(`FakeQuery: unhandled table ${this.table}`);
  }
}

function makeDb() {
  const rows = buildReservoir();
  const db = {
    rows,
    streamIds: ['stream_a', 'stream_b'],
    stateRow: null,
    stateUpserts: [],
    rangeReads: 0,
    persistCalls: [],
    reconcileCalls: [],
    failPersistOnCall: null,
    client: null,
  };
  db.client = {
    from: (table) => new FakeQuery(db, table),
    async rpc(name, args) {
      if (name === 'register_domain3_population_rules_v1') {
        return { data: { rules_registered: args.p_rules.length }, error: null };
      }
      if (name === 'persist_domain3_population_run_v1') {
        db.persistCalls.push(args);
        if (db.failPersistOnCall === db.persistCalls.length) {
          return { data: null, error: { message: 'injected persist failure' } };
        }
        return {
          data: {
            status: 'completed',
            run_id: args.p_run_id,
            candidates_produced: args.p_candidates.length,
            candidates_inserted: args.p_candidates.length,
            candidates_replayed: 0,
          },
          error: null,
        };
      }
      if (name === 'reconcile_domain3_population_currentness_v1') {
        db.reconcileCalls.push(args);
        return { data: { status: 'completed', retired: 0 }, error: null };
      }
      throw new Error(`FakeDb: unexpected RPC ${name}`);
    },
  };
  return db;
}

test('full-set replay pages the whole reservoir, persists all candidates, reconciles, and records the watermark', async () => {
  const db = makeDb();
  const result = await executeDomain3FullReplay({ atlasClient: db.client, candidateChunkSize: 250 });

  assert.equal(result.status, 'completed');
  assert.equal(result.observations_scanned, 2500);
  assert.equal(result.observation_scan_complete, true);
  assert.equal(db.rangeReads, 3); // 1000 + 1000 + 500
  const geoRun = result.runs.find((run) => run.rule_id === 'atlas.domain3.geographic_cluster');
  assert.equal(geoRun.candidates_derived, 5);
  assert.equal(geoRun.replay_complete, true);
  const geoPersist = db.persistCalls.filter((call) => call.p_rule.rule_id === 'atlas.domain3.geographic_cluster');
  assert.equal(geoPersist.length, 1);
  assert.equal(geoPersist[0].p_candidates.length, 5);
  const geoReconcile = db.reconcileCalls.filter((call) => call.p_rule_id === 'atlas.domain3.geographic_cluster');
  assert.equal(geoReconcile.length, 1);
  assert.equal(geoReconcile[0].p_replay_complete, true);
  assert.equal(geoReconcile[0].p_current_candidate_hashes.length, 5);
  assert.equal(db.stateUpserts.length, 1);
  assert.equal(db.stateUpserts[0].watermark.__total, 2500);
  assert.equal(result.runs.length, 12);
});

test('persist chunks share one run id and reconciliation waits for every chunk', async () => {
  const db = makeDb();
  const result = await executeDomain3FullReplay({ atlasClient: db.client, candidateChunkSize: 2 });
  const geoPersist = db.persistCalls.filter((call) => call.p_rule.rule_id === 'atlas.domain3.geographic_cluster');
  assert.equal(geoPersist.length, 3); // 2 + 2 + 1
  assert.ok(geoPersist.every((call) => call.p_run_id === geoPersist[0].p_run_id));
  const geoRun = result.runs.find((run) => run.rule_id === 'atlas.domain3.geographic_cluster');
  assert.equal(geoRun.candidates_produced, 5);
  assert.equal(db.reconcileCalls.filter((call) => call.p_rule_id === 'atlas.domain3.geographic_cluster').length, 1);
});

test('a failed persist chunk blocks reconciliation for that rule and blocks the watermark', async () => {
  const db = makeDb();
  // Geographic is persisted in rule order after frequency_spike; aim the
  // failure at the geographic persist by counting calls at runtime.
  const originalRpc = db.client.rpc.bind(db.client);
  let persistSeen = 0;
  db.client.rpc = async (name, args) => {
    if (name === 'persist_domain3_population_run_v1') {
      persistSeen += 1;
      if (args.p_rule.rule_id === 'atlas.domain3.geographic_cluster' && persistSeen > 0) {
        db.failPersistOnCall = db.persistCalls.length + 1;
      }
    }
    return originalRpc(name, args);
  };
  const result = await executeDomain3FullReplay({ atlasClient: db.client, candidateChunkSize: 2 });
  assert.ok(result.rule_errors.some((entry) => entry.rule_id === 'atlas.domain3.geographic_cluster' && entry.phase === 'persistence'));
  assert.equal(db.reconcileCalls.filter((call) => call.p_rule_id === 'atlas.domain3.geographic_cluster').length, 0);
  assert.equal(db.stateUpserts.length, 0);
  assert.equal(result.status, 'partial');
});

test('an unchanged reservoir skips derivation entirely on the next cycle', async () => {
  const db = makeDb();
  const first = await executeDomain3FullReplay({ atlasClient: db.client, candidateChunkSize: 250 });
  assert.equal(first.status, 'completed');
  const readsBefore = db.rangeReads;
  const second = await executeDomain3FullReplay({ atlasClient: db.client, candidateChunkSize: 250 });
  assert.equal(second.status, 'skipped_no_change');
  assert.equal(db.rangeReads, readsBefore); // no observation pages read
  assert.equal(second.last_run_ids.length, 12);
});

test('bridge drains repeat until a run is exhausted, and a skipped cycle still drains recorded runs', async () => {
  const candidateCalls = new Map();
  const retirementCalls = new Map();
  const atlasClient = {
    async rpc(name, args) {
      if (name === 'detect_propublica_unresolved_metadata_v1') {
        return { data: { run_id: 'seed-run', status: 'completed' }, error: null };
      }
      if (name === 'bridge_live_data_signal_candidates_v1') {
        const seen = (candidateCalls.get(args.p_run_id) || 0) + 1;
        candidateCalls.set(args.p_run_id, seen);
        if (args.p_run_id === 'seed-run') return { data: { candidates_seen: 0, bridged: 0, idempotent: 0, failed: 0 }, error: null };
        const sequence = [250, 250, 40];
        const value = sequence[Math.min(seen - 1, sequence.length - 1)];
        return { data: { candidates_seen: value, bridged: value, idempotent: 0, failed: 0, receipts: [] }, error: null };
      }
      if (name === 'bridge_live_data_signal_retirements_v1') {
        const seen = (retirementCalls.get(args.p_run_id) || 0) + 1;
        retirementCalls.set(args.p_run_id, seen);
        if (args.p_run_id === 'run-1' && seen === 1) {
          return { data: { retirements_seen: 250, bridged: 250, idempotent: 0, failed: 0, receipts: [] }, error: null };
        }
        return { data: { retirements_seen: 0, bridged: 0, idempotent: 0, failed: 0, receipts: [] }, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
  };

  const drained = await executeLiveDataSignalCycle({
    atlasClient,
    candidateLimit: 250,
    populationDetector: async () => ({ status: 'completed', runs: [{ run_id: 'run-1', rule_id: 'atlas.domain3.geographic_cluster' }] }),
  });
  assert.equal(drained.status, 'completed');
  assert.equal(candidateCalls.get('run-1'), 3); // 250 + 250 + 40
  assert.equal(drained.bridge.candidates_seen, 540);
  assert.equal(drained.bridge.bridged, 540);
  assert.equal(retirementCalls.get('run-1'), 2); // 250 + 0

  candidateCalls.clear();
  const skipped = await executeLiveDataSignalCycle({
    atlasClient,
    candidateLimit: 250,
    populationDetector: async () => ({ status: 'skipped_no_change', last_run_ids: ['run-1'], runs: [] }),
  });
  assert.equal(skipped.status, 'skipped_no_change');
  assert.equal(candidateCalls.get('run-1'), 3); // recorded runs still drain
});
