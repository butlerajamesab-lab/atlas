import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listReservoirStreams,
  listReservoirRecords,
  getReservoirRecord,
  clampLimit,
  parseNonNegativeInt,
} from '../src/services/reservoirViewerService.js';

// Fake supabase query builder: records the chain, resolves canned
// results keyed by table + a spec the test controls.
class FakeQuery {
  constructor(handler, table) {
    this.handler = handler;
    this.spec = { table, filters: {}, order: null, limit: null, count: null, head: false };
  }
  select(columns, options = {}) {
    this.spec.columns = columns;
    this.spec.count = options.count ?? null;
    this.spec.head = Boolean(options.head);
    return this;
  }
  eq(key, value) {
    this.spec.filters[key] = value;
    return this;
  }
  lt(key, value) {
    this.spec.lt = { key, value };
    return this;
  }
  order(key, options) {
    this.spec.order = { key, ascending: options?.ascending !== false };
    return this;
  }
  limit(n) {
    this.spec.limit = n;
    return this;
  }
  async maybeSingle() {
    const result = this.handler(this.spec);
    return { data: result.rows?.[0] ?? null, error: null };
  }
  then(resolve, reject) {
    try {
      const result = this.handler(this.spec);
      resolve({ data: result.rows ?? null, count: result.count ?? null, error: null });
    } catch (error) {
      reject(error);
    }
  }
}

function fakeClient(handler) {
  return {
    from: (table) => new FakeQuery(handler, table),
    // Mirrors the SQL functions in src/schema/20261108_reservoir_viewer_rpc.sql
    rpc: async (name, args) => {
      if (name === 'atlas_reservoir_record') {
        const rows = (EVENTS[args.p_stream_id] ?? []).filter(
          (r) => r.offset === args.p_offset,
        );
        return { data: rows, error: null };
      }
      if (name === 'atlas_reservoir_records_page') {
        let rows = [...(EVENTS[args.p_stream_id] ?? [])];
        if (args.p_before_offset !== null && args.p_before_offset !== undefined) {
          rows = rows.filter((r) => r.offset < args.p_before_offset);
        }
        rows.sort((a, b) => b.offset - a.offset);
        return { data: rows.slice(0, args.p_limit), error: null };
      }
      throw new Error(`unknown rpc ${name}`);
    },
  };
}

const STREAMS = [
  { stream_id: 'alpha_stream', source_id: 'alpha', jurisdiction_id: 'us', module_hint: 'm1', status: 'active' },
  { stream_id: 'beta_stream', source_id: 'beta', jurisdiction_id: 'us_wa', module_hint: 'm2', status: 'paused' },
];

const EVENTS = {
  alpha_stream: [
    { stream_id: 'alpha_stream', offset: 7, timestamp: '2026-11-07T00:00:07Z', signal_type: 'x', source_id: 'alpha', jurisdiction_id: 'us', ingested_at: '2026-11-07T01:00:07Z', event_identity_hash: 'hash7', payload: { a: 7 }, provenance: { channel: 'alpha' }, spacetime: {}, module_hint: 'm1' },
    { stream_id: 'alpha_stream', offset: 5, timestamp: '2026-11-07T00:00:05Z', signal_type: 'x', source_id: 'alpha', jurisdiction_id: 'us', ingested_at: '2026-11-07T01:00:05Z', event_identity_hash: 'hash5', payload: { a: 5 }, provenance: { channel: 'alpha' }, spacetime: {}, module_hint: 'm1' },
    { stream_id: 'alpha_stream', offset: 3, timestamp: '2026-11-07T00:00:03Z', signal_type: 'y', source_id: 'alpha', jurisdiction_id: 'us', ingested_at: '2026-11-07T01:00:03Z', event_identity_hash: 'hash3', payload: { a: 3 }, provenance: { channel: 'alpha' }, spacetime: {}, module_hint: 'm1' },
  ],
  beta_stream: [],
};

function handler(spec) {
  if (spec.table === 'streams') {
    if (spec.columns === 'stream_id') {
      const found = STREAMS.find((s) => s.stream_id === spec.filters.stream_id);
      return { rows: found ? [{ stream_id: found.stream_id }] : [] };
    }
    return { rows: STREAMS };
  }
  const rows = EVENTS[spec.filters.stream_id] ?? [];
  if (spec.head) return { count: rows.length };
  let out = [...rows];
  if (spec.lt) out = out.filter((r) => r[spec.lt.key] < spec.lt.value);
  if (spec.filters.offset !== undefined) out = out.filter((r) => r.offset === spec.filters.offset);
  if (spec.order) {
    out.sort((a, b) => (spec.order.ascending ? a.offset - b.offset : b.offset - a.offset));
  }
  const total = out.length;
  if (spec.limit) out = out.slice(0, spec.limit);
  return { rows: out, count: spec.count ? total : null };
}

test('census: exact per-stream counts pass through and the grand total sums them', async () => {
  const census = await listReservoirStreams(fakeClient(handler));
  assert.equal(census.stream_count, 2);
  assert.equal(census.total_records, 3);
  const alpha = census.streams.find((s) => s.stream_id === 'alpha_stream');
  assert.equal(alpha.record_count, 3);
  assert.equal(alpha.latest_offset, 7);
  assert.equal(alpha.status, 'active');
  const beta = census.streams.find((s) => s.stream_id === 'beta_stream');
  assert.equal(beta.record_count, 0);
  assert.equal(beta.latest_offset, null);
});

test('records: newest-first page with exact total and older-page cursor', async () => {
  const page = await listReservoirRecords(fakeClient(handler), 'alpha_stream', { limit: 2 });
  assert.equal(page.total_records, 3);
  assert.deepEqual(page.records.map((r) => r.offset), [7, 5]);
  assert.equal(page.next_before_offset, 5);
  assert.equal(page.has_more, true);
  // light rows carry no payload
  assert.equal('payload' in page.records[0], false);
  assert.equal(page.records[0].event_identity_hash, 'hash7');
});

test('records: before_offset pages strictly older records', async () => {
  const page = await listReservoirRecords(fakeClient(handler), 'alpha_stream', {
    limit: 50,
    beforeOffset: 5,
  });
  assert.deepEqual(page.records.map((r) => r.offset), [3]);
  assert.equal(page.has_more, false);
});

test('records: unknown stream returns null (route renders 404)', async () => {
  const page = await listReservoirRecords(fakeClient(handler), 'nope_stream', {});
  assert.equal(page, null);
});

test('record detail: full stored form preserved, reference triple carried', async () => {
  const record = await getReservoirRecord(fakeClient(handler), 'alpha_stream', 5);
  assert.equal(record.offset, 5);
  assert.deepEqual(record.payload, { a: 5 });
  assert.deepEqual(record.provenance, { channel: 'alpha' });
  assert.deepEqual(record.reference, {
    stream_id: 'alpha_stream',
    offset: 5,
    event_identity_hash: 'hash5',
  });
  const missing = await getReservoirRecord(fakeClient(handler), 'alpha_stream', 99);
  assert.equal(missing, null);
  const badOffset = await getReservoirRecord(fakeClient(handler), 'alpha_stream', 'x');
  assert.equal(badOffset, null);
});

test('limit and offset parsing are clamped and total', () => {
  assert.equal(clampLimit(undefined), 50);
  assert.equal(clampLimit(0), 1);
  assert.equal(clampLimit(5000), 100);
  assert.equal(clampLimit('25'), 25);
  assert.equal(parseNonNegativeInt('42'), 42);
  assert.equal(parseNonNegativeInt('-1'), null);
  assert.equal(parseNonNegativeInt(''), null);
  assert.equal(parseNonNegativeInt(undefined), null);
});


// --- Census resilience (2026-11-09) -------------------------------------
// The production unlock failure: the census fired every stream's
// count + latest queries at once with no retry, so one transient
// door 500 failed the whole census. These tests pin the fix:
// per-stream retry with backoff, bounded batches, exact results.

const noSleep = async () => {};

test('census: a stream whose count fails transiently is retried and the census still lands exact', async () => {
  let betaCountAttempts = 0;
  const flaky = (spec) => {
    if (spec.table === 'signal_events' && spec.head && spec.filters.stream_id === 'beta_stream') {
      betaCountAttempts += 1;
      if (betaCountAttempts < 3) throw new Error('transient door 500');
    }
    return handler(spec);
  };
  const census = await listReservoirStreams(fakeClient(flaky), { sleep: noSleep, baseDelayMs: 1 });
  assert.equal(betaCountAttempts, 3);
  assert.equal(census.stream_count, 2);
  assert.equal(census.total_records, 3);
  const beta = census.streams.find((s) => s.stream_id === 'beta_stream');
  assert.equal(beta.record_count, 0);
});

test('census: a permanently failing stream exhausts the declared attempts and the census fails loudly', async () => {
  let betaCountAttempts = 0;
  const broken = (spec) => {
    if (spec.table === 'signal_events' && spec.head && spec.filters.stream_id === 'beta_stream') {
      betaCountAttempts += 1;
      throw new Error('door down');
    }
    return handler(spec);
  };
  await assert.rejects(
    () => listReservoirStreams(fakeClient(broken), { sleep: noSleep, baseDelayMs: 1, maxAttempts: 3 }),
    /door down/,
  );
  assert.equal(betaCountAttempts, 3);
});

test('census: batching preserves order and exactness across more streams than the batch size', async () => {
  const manyStreams = Array.from({ length: 13 }, (_, i) => ({
    stream_id: `s${String(i).padStart(2, '0')}`,
    source_id: 'src',
    jurisdiction_id: 'us',
    module_hint: 'm',
    status: 'active',
  }));
  const manyEvents = {};
  for (const s of manyStreams) {
    manyEvents[s.stream_id] = [
      { stream_id: s.stream_id, offset: 2, timestamp: '2026-11-09T00:00:02Z', ingested_at: '2026-11-09T01:00:02Z' },
      { stream_id: s.stream_id, offset: 1, timestamp: '2026-11-09T00:00:01Z', ingested_at: '2026-11-09T01:00:01Z' },
    ];
  }
  const manyHandler = (spec) => {
    if (spec.table === 'streams') return { rows: manyStreams };
    const rows = manyEvents[spec.filters.stream_id] ?? [];
    if (spec.head) return { count: rows.length };
    const out = [...rows].sort((a, b) => b.offset - a.offset);
    return { rows: spec.limit ? out.slice(0, spec.limit) : out };
  };
  const census = await listReservoirStreams(fakeClient(manyHandler), { sleep: noSleep, batchSize: 5 });
  assert.equal(census.stream_count, 13);
  assert.equal(census.total_records, 26);
  assert.deepEqual(census.streams.map((s) => s.stream_id), manyStreams.map((s) => s.stream_id));
  assert.ok(census.streams.every((s) => s.record_count === 2 && s.latest_offset === 2));
});
