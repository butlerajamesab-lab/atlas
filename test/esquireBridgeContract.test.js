import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchEsquireView } from '../src/routes/esquireBridge.js';

test('Esquire bridge preserves successful upstream JSON without reshaping', async () => {
  const upstream = {
    case_id: 'case-123',
    case_type: 'landlord_tenant',
    availability: { esquire: 'available', errors: [] },
    nested: { untouched: ['a', 'b'] },
  };

  const result = await fetchEsquireView('case-123', {
    baseUrl: 'https://esquire.example',
    fetchImpl: async (url) => {
      assert.equal(url, 'https://esquire.example/cases/case-123/esquire-view');
      return new Response(JSON.stringify(upstream), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.deepEqual(result.data, upstream);
});

test('Esquire bridge returns locked unavailable fallback only on transport failure', async () => {
  const result = await fetchEsquireView('case-outage', {
    baseUrl: 'https://esquire.example',
    fetchImpl: async () => { throw new Error('fetch failed'); },
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 502);
  assert.deepEqual(result.data, {
    case_id: 'case-outage',
    case_type: null,
    availability: {
      esquire: 'unavailable',
      errors: ['fetch failed'],
    },
  });
});
