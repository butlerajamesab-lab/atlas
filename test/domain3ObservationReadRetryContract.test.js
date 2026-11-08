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
  return {
    attempts,
    from() {
      const query = {
        _range: null,
        select() { return query; },
        not() { return query; },
        order() { return query; },
        range(from, to) { query._range = [from, to]; return query; },
        then(resolve) {
          const [from, to] = query._range;
          const key = `${from}-${to}`;
          const attempt = (attempts.get(key) || 0) + 1;
          attempts.set(key, attempt);
          const failure = (failures.get(key) || [])[attempt - 1];
          if (failure) {
            resolve({ data: null, error: failure });
            return;
          }
          resolve({ data: rows.slice(from, to + 1), error: null });
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
  assert.equal(isTransientObservationReadError(new Error('fetch failed')), true);
  assert.equal(isTransientObservationReadError(new Error('permission denied for table signal_events')), false);
  assert.equal(isTransientObservationReadError(new Error('relation "signal_events" does not exist')), false);
});

test('a page that truncates twice then recovers returns its rows', async () => {
  const rows = [{ offset: 1 }, { offset: 2 }];
  const client = fakeClient({ rows, failures: new Map([['0-999', [truncated(), truncated()]]]) });
  const data = await readObservationPage(client, 0, 999, { sleepFn: noSleep, baseDelayMs: 1 });
  assert.deepEqual(data, rows);
  assert.equal(client.attempts.get('0-999'), 3);
});

test('a page that never recovers throws the standard error after bounded attempts', async () => {
  const client = fakeClient({ failures: new Map([['0-999', [truncated(), truncated(), truncated()]]]) });
  await assert.rejects(
    readObservationPage(client, 0, 999, { attempts: 3, sleepFn: noSleep, baseDelayMs: 1 }),
    /^Error: Domain 3 full replay observation read failed: SyntaxError: Unterminated string/,
  );
  assert.equal(client.attempts.get('0-999'), 3);
});

test('a non-transient error fails on the first attempt', async () => {
  const client = fakeClient({
    failures: new Map([['0-999', [new Error('permission denied for table signal_events')]]]),
  });
  await assert.rejects(
    readObservationPage(client, 0, 999, { sleepFn: noSleep, baseDelayMs: 1 }),
    /Domain 3 full replay observation read failed: permission denied/,
  );
  assert.equal(client.attempts.get('0-999'), 1);
});

test('the full-set stream survives a mid-stream truncated page', async () => {
  const rows = Array.from({ length: 1500 }, (_, i) => ({ offset: i + 1 }));
  const client = fakeClient({ rows, failures: new Map([['1000-1999', [truncated()]]]) });
  const seen = [];
  const total = await streamCanonicalObservations(client, (row) => seen.push(row.offset));
  assert.equal(total, 1500);
  assert.equal(seen.length, 1500);
  assert.equal(seen[1499], 1500);
  assert.equal(client.attempts.get('1000-1999'), 2);
});
