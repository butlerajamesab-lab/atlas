// Contract tests for the CMS bulk loader
// (scripts/loadCmsNationalBulk.mjs), built 2026-11-09.
//
// The loader replaces ~1,900 paged API fetches with the four flat
// release files CMS publishes monthly, then posts through the same
// governed door. These tests pin the parts that can silently rot:
//   1. the CSV parser (quoted commas, escaped quotes, embedded
//      newlines, CRLF, unterminated quotes fail loudly);
//   2. the header maps against the REAL Oct2026 release headers
//      (fixtures in test/fixtures/cms-bulk-headers/, captured from
//      the live files 2026-11-09) — a CMS header rename breaks
//      here, not in production;
//   3. bulk/API equivalence: Kline Galland's real F0610 row, fed
//      through the header map + normalizer, produces the same
//      signal (payload minus raw) as the API-shaped fixture in the
//      adapter contract suite;
//   4. argument discipline (WA is refused — it lives in the
//      us_state_WA family);
//   5. the concurrent poster: slices are disjoint and complete,
//      and per-slice receipts aggregate.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  mapBulkRow,
  parseBulkArgs,
  parseCsvRows,
  postStateSignals,
  requiredHeadersPresent,
} from '../scripts/loadCmsNationalBulk.mjs';
import { normalizeCmsHealthDeficiency } from '../src/adapters/cmsNursingHomeAdapter.js';

async function collect(chunks) {
  const rows = [];
  for await (const row of parseCsvRows(chunks)) rows.push(row);
  return rows;
}

function realHeaders(kind) {
  const line = readFileSync(new URL(`./fixtures/cms-bulk-headers/${kind}.txt`, import.meta.url), 'utf8').trim();
  // The fixture is a single RFC4180 header line; splitting on
  // '","' after trimming the outer quotes is exact for this shape.
  return line.replace(/^"|"$/g, '').split('","');
}

test('csv parser handles quoted commas, escaped quotes, CRLF, embedded newlines', async () => {
  const text = '"a","b, with comma","c ""quoted"" d"\r\n"line1\nline2",plain,last';
  const rows = await collect([text]);
  assert.deepEqual(rows, [
    ['a', 'b, with comma', 'c "quoted" d'],
    ['line1\nline2', 'plain', 'last'],
  ]);
});

test('csv parser refuses an unterminated quote instead of guessing', async () => {
  await assert.rejects(() => collect(['"never closed,field']), /unterminated_quote/);
});

test('header maps cover the real Oct2026 release headers for every kind', () => {
  for (const kind of ['providers', 'health', 'fire', 'penalties']) {
    assert.equal(requiredHeadersPresent(kind, realHeaders(kind)), true, `${kind} header coverage`);
  }
});

test('a renamed source header fails the coverage check loudly', () => {
  const headers = realHeaders('health').map((h) => (h === 'Scope Severity Code' ? 'Severity' : h));
  assert.equal(requiredHeadersPresent('health', headers), false);
});

const KG_HEALTH_VALUES = [
  '505442', 'CAROLINE KLINE GALLAND HOME', '7500 SEWARD PARK AVENUE SOUTH', 'SEATTLE', 'WA', '98118',
  '2026-03-04', '', 'Health', 'F', 'Freedom from Abuse, Neglect, and Exploitation Deficiencies', '0610',
  'Respond appropriately to all alleged violations.', 'D', 'Deficient, Provider has date of correction',
  '2026-04-08', '1', 'Y', 'N', 'N', 'N', 'N', '7500 SEWARD PARK AVENUE SOUTH,SEATTLE,WA,98118', '2026-10-01',
];

const KG_API_RECORD = {
  cms_certification_number_ccn: '505442',
  provider_name: 'CAROLINE KLINE GALLAND HOME',
  provider_address: '7500 SEWARD PARK AVENUE SOUTH',
  citytown: 'SEATTLE',
  state: 'WA',
  zip_code: '98118',
  survey_date: '2026-03-04',
  survey_type: 'Health',
  survey_footnote: '',
  deficiency_prefix: 'F',
  deficiency_tag_number: '0610',
  deficiency_category: 'Freedom from Abuse, Neglect, and Exploitation Deficiencies',
  deficiency_description: 'Respond appropriately to all alleged violations.',
  scope_severity_code: 'D',
  deficiency_corrected: 'Deficient, Provider has date of correction',
  correction_date: '2026-04-08',
  inspection_cycle: '1',
  standard_deficiency: 'Y',
  complaint_deficiency: 'N',
  infection_control_inspection_deficiency: 'N',
  citation_under_idr: 'N',
  citation_under_iidr: 'N',
  processing_date: '2026-10-01',
};

test('bulk-mapped F0610 row produces the API-path signal (payload minus raw)', () => {
  const record = mapBulkRow('health', realHeaders('health'), KG_HEALTH_VALUES);
  const bulkSignal = normalizeCmsHealthDeficiency(record);
  const apiSignal = normalizeCmsHealthDeficiency(KG_API_RECORD);
  const { raw: _bulkRaw, ...bulkPayload } = bulkSignal.payload;
  const { raw: _apiRaw, ...apiPayload } = apiSignal.payload;
  assert.deepEqual(bulkPayload, apiPayload);
  assert.equal(bulkSignal.signal_type, apiSignal.signal_type);
  assert.equal(bulkSignal.timestamp, apiSignal.timestamp);
  assert.deepEqual(bulkSignal.spacetime, apiSignal.spacetime);
});

test('bulk args refuse WA and unknown datasets', () => {
  assert.throws(() => parseBulkArgs(['--states', 'WA,OR']), /wa_excluded/);
  assert.throws(() => parseBulkArgs(['--dataset', 'bogus']), /unknown_dataset/);
  assert.deepEqual(parseBulkArgs(['--dataset', 'health']).datasets, ['health']);
  assert.deepEqual(parseBulkArgs([]).datasets, ['providers', 'health', 'fire', 'penalties']);
});

test('concurrent poster slices are disjoint and complete, receipts aggregate', async () => {
  const seen = [];
  const post = async (_moduleHint, slice) => {
    seen.push(...slice.map((s) => s.n));
    return { ingested_count: slice.length, replayed_count: 0, records_failed: 0 };
  };
  const signals = Array.from({ length: 103 }, (_, n) => ({ n }));
  const totals = await postStateSignals({ moduleHint: 'nursing_home_deficiency', signals, apiBaseUrl: 'x', concurrency: 4, post });
  assert.equal(totals.ingested_count, 103);
  assert.deepEqual([...seen].sort((a, b) => a - b), Array.from({ length: 103 }, (_, n) => n));
});
