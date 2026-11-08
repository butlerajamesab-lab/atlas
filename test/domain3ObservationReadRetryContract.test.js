// Observation page-read retry contract (2026-11-08): a truncated
// page body (JSON SyntaxError) or a Cloudflare 5xx on one page must
// be retried per page, not kill the derivation; non-transient
// errors fail fast; a page that never recovers throws the standard
// read-failed error after the bounded attempts.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isTransientObservationReadError,
  readObservationPage,
  streamCanonicalObservations,
} from '../src/services/domain3PopulationReplayService.js';

function fakeClient({ rows = [], failures = new Map() } = {}) {
  const attempts = new Map();
  const sorted = [...rows].sort(
    (a, b) => String(a.stream_id).localeCompare(String(b.stream_id)) || a.offset - b.offset,
  );
  return {
    attempts,
    from() {
      const query = {
        _limit: null,
        _or: null,
        select() { return query; },
        not() { return query; },
        order() { return query; },
        limit(n) { query._limit = n; return query; },
        or(filter) { query._or = filter; return query; },
        then(resolve) {
          let key = 'start';
          let startIndex = 0;
          if (query._or) {
            const match = /stream_id\.eq\.([^,]+),offset\.gt\.(\d+)/.exec(query._or);
            const sid = match[1];
            const off = Number(match[2]);
            key = `${sid}:${off}`;
            startIndex = sorted.findIndex(
              (row) => row.stream_id > sid || (row.stream_id === sid && row.offset > off),
            );
            if (startIndex === -1) startIndex = sorted.length;
          }
          const attempt = (attempts.get(key) || 0) + 1;
          attempts.set(key, attempt);
          const failure = (failures.get(key) || [])[attempt - 1];
          if (failure) {
            resolve({ data: null, error: failure });
            return;
          }
          resolve({ data: sorted.slice(startIndex, startIndex + (query._limit || sorted.length)), error: null });
        },
      };
      return query;
    },
  };
}

const noSleep = async () => {};
const truncated = () => new Error('SyntaxError: Unterminated string in JSON at position 1957377 (line 852 column 233)');

test('transience classification covers truncation and 5xx, not permission errors', () => {
  assert.equal(isTransientObservationReadError(truncated()), true);
  assert.equal(isTransientObservationReadError(new Error('Cloudflare 520')), true);
  // The 2026-11-08 production shape: PostgREST surfaces the edge's
  // HTML error page as the error message — a 521 with no JSON at all.
  assert.equal(isTransientObservationReadError(new Error('<!DOCTYPE html>\n<html><head><title>supabase.co | 521: Web server is down</title>')), true);
  assert.equal(isTransientObservationReadError(new Error('522')), true);
  assert.equal(isTransientObservationReadError(new Error('fetch failed')), true);
  assert.equal(isTransientObservationReadError(new Error('permission denied for table signal_events')), false);
  assert.equal(isTransientObservationReadError(new Error('relation "signal_events" does not exist')), false);
});

test('a page that truncates twice then recovers returns its rows', async () => {
  const rows = [{ offset: 1 }, { offset: 2 }];
  const client = fakeClient({ rows, failures: new Map([['start', [truncated(), truncated()]]]) });
  const data = await readObservationPage(client, null, 1000, { sleepFn: noSleep, baseDelayMs: 1 });
  assert.deepEqual(data, rows);
  assert.equal(client.attempts.get('start'), 3);
});

test('a page that never recovers throws the standard error after bounded attempts', async () => {
  const client = fakeClient({ failures: new Map([['start', [truncated(), truncated(), truncated()]]]) });
  await assert.rejects(
    readObservationPage(client, null, 1000, { attempts: 3, sleepFn: noSleep, baseDelayMs: 1 }),
    /^Error: Domain 3 full replay observation read failed: SyntaxError: Unterminated string/,
  );
  assert.equal(client.attempts.get('start'), 3);
});

test('a non-transient error fails on the first attempt', async () => {
  const client = fakeClient({
    failures: new Map([['start', [new Error('permission denied for table signal_events')]]]),
  });
  await assert.rejects(
    readObservationPage(client, null, 1000, { sleepFn: noSleep, baseDelayMs: 1 }),
    /Domain 3 full replay observation read failed: permission denied/,
  );
  assert.equal(client.attempts.get('start'), 1);
});

test('the full-set stream survives a mid-stream truncated page', async () => {
  const rows = Array.from({ length: 1500 }, (_, i) => ({ stream_id: 's', offset: i + 1 }));
  const client = fakeClient({ rows, failures: new Map([['s:1000', [truncated()]]]) });
  const seen = [];
  const total = await streamCanonicalObservations(client, (row) => seen.push(row.offset));
  assert.equal(total, 1500);
  assert.equal(seen.length, 1500);
  assert.equal(seen[1499], 1500);
  assert.equal(client.attempts.get('s:1000'), 2);
});
