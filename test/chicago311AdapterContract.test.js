import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { selectPublicStreamCatalogRows } from '../src/services/publicStreamSelection.js';

const adapter = readFileSync(new URL('../src/adapters/chicago311ServiceRequestsAdapter.js', import.meta.url), 'utf8');
const catalogSource = readFileSync(new URL('../src/services/publicStreamCatalog.js', import.meta.url), 'utf8');

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

test('the public catalog advertises the same current Chicago 311 endpoint as the adapter', () => {
  assert.match(catalogSource, /api_url:'https:\/\/data\.cityofchicago\.org\/api\/v3\/views\/v6vf-nfxy\/query\.json'/);
  assert.doesNotMatch(catalogSource, /api_url:'https:\/\/data\.cityofchicago\.org\/resource\/v6vf-nfxy\.json'/);
});

test('public stream registration leaves an explicitly empty selection empty', () => {
  const catalog = [{ stream_id: 'one' }, { stream_id: 'two' }];
  assert.deepEqual(selectPublicStreamCatalogRows(catalog, []), []);
  assert.deepEqual(selectPublicStreamCatalogRows(catalog, ['two']), [{ stream_id: 'two' }]);
  assert.deepEqual(selectPublicStreamCatalogRows(catalog, ['absent']), []);
  assert.deepEqual(selectPublicStreamCatalogRows(catalog, undefined), catalog);
  assert.deepEqual(selectPublicStreamCatalogRows(catalog, null), catalog);
});
