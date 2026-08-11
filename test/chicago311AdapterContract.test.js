import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const adapter = readFileSync(new URL('../src/adapters/chicago311ServiceRequestsAdapter.js', import.meta.url), 'utf8');

test('Chicago 311 uses the current SODA v3 dataset query contract', () => {
  assert.match(adapter, /api\/v3\/views\/v6vf-nfxy\/query\.json/);
  assert.match(adapter, /query: 'SELECT \*'/);
  assert.match(adapter, /page: \{ pageNumber, pageSize: requested \}/);
  assert.match(adapter, /includeSynthetic: false/);
  assert.match(adapter, /socrataHeaders\(\)/);
  assert.doesNotMatch(adapter, /data\.cityofchicago\.org\/resource\/v6vf-nfxy/);
});

test('Chicago 311 preserves source identity and request lineage fields', () => {
  assert.match(adapter, /sourceId: 'chicago_311'/);
  assert.match(adapter, /jurisdictionId: 'us_city_chicago'/);
  assert.match(adapter, /request_id: firstValue\(record, \['sr_number'\]\)/);
  assert.match(adapter, /parent_request_id/);
  assert.match(adapter, /legacy_record/);
});
