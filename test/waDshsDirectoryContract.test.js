// Contract tests for the WA DSHS fortress directory family
// (src/adapters/waDshsAdapter.js + scripts/loadWaDshsDirectory.mjs),
// built 2026-11-09 with the family.
//
// These pin the parts that can silently rot:
//   1. the header fixtures are the REAL first-pull headers
//      (test/fixtures/wa-dshs-headers/, captured from the live
//      fortress CSVs 2026-11-09) and cover every required column;
//      the documented per-class divergence (AFH carries
//      'Disclosure of Services', ALF carries 'Check_Type') holds;
//   2. the normalizer: license number is the canonical key,
//      space-padded source values are trimmed, beds parse as
//      numbers, Yes/True flags parse as booleans, an unparseable
//      expiration stays null (never a fabricated date);
//   3. the fortress form machinery: county extraction from the
//      live form shape and the all-counties CSV request body;
//   4. the loader: within-run dedupe counts the state's own
//      byte-identical duplicate (ALF license 2160) as a source
//      duplicate — received 3, posted 2 — and the summary
//      reconciles received = posted + duplicates + blanks.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  WA_DSHS_REQUIRED_COLUMNS,
  buildFortressCsvFormBody,
  extractFortressCounties,
  fetchWaDshsDirectoryCsv,
  normalizeWaDshsDirectoryRow,
  waDshsEntityId,
} from '../src/adapters/waDshsAdapter.js';
import {
  loadWaDshsClass,
  parseWaDshsArgs,
  postDirectorySignals,
} from '../scripts/loadWaDshsDirectory.mjs';

function realHeaders(kind) {
  const line = readFileSync(new URL(`./fixtures/wa-dshs-headers/${kind}.txt`, import.meta.url), 'utf8').trim();
  return line.replace(/^"|"$/g, '').split('","');
}

// A real AFH row from the first pull (LA COUNTRY CARE, Othello —
// public directory record, license 103302).
const AFH_RECORD = {
  Speciality: 'Mental Health, Dementia, Developmental Disabilities',
  contract: 'No Contract',
  LicenseNumber: '103302',
  LocationNumber: '40001033',
  FacInstanceId: '32310',
  FacilityType: 'AF  ',
  FacilityName: 'LA COUNTRY CARE',
  FacilityStatus: 'OP    ',
  LocationAddress: '2073 W BENCH RD',
  LocationCity: 'OTHELLO',
  LocationState: 'WA',
  LocationZipCode: '99344',
  LocationCounty: 'Adams',
  MailAddress: '2073 W BENCH RD',
  MailCity: 'OTHELLO',
  MailState: 'WA',
  MailZipCode: '99344',
  TelephoneNmbr: '(509) 488-9756',
  FaxNmbr: '',
  ConfidentialFaxNmbr: '(509) 488-0684',
  RCSRegionUnit: '1C',
  SpecialityCode: 'SPMI, SPDE, SPDD',
  ContractCode: '',
  FacilityPOC: 'Quezada, Guadalupe A.',
  LicensedBedCount: '6',
  LicenseExpirationDate: '',
  CheckCompleteDate: '',
  CheckType: '',
  POCId: '1022696',
  MemoryCertFlag: 'False',
  'Disclosure of Services': 'https://fortress.wa.gov/dshs/adsaapps/lookup/AFHServices.aspx?Lic=103302',
  'Has Reports?': 'Yes',
  'Reports Location': 'https://fortress.wa.gov/dshs/adsaapps/lookup/AFHForms.aspx?Lic=103302',
  '': '',
};

const SPRING_RIDGE_ROW = '"None","Specialized Dementia Care, Enhanced Adult Residential Care, Assisted Living SOW","","2160","60008938","41821","BH  ","Spring Ridge Retirement, LLC","OP    ","6856 E Portland Ave","Tacoma","WA","98404","Pierce","6856 E Portland Ave","Tacoma","WA","98404","(253) 474-1093","","(253) 474-0662","3D","","1027XS-12 , 1006XS-12 , 1002XS-12 ","Lantz, Theresa","75","12/31/2026 12:00:00 AM","","","","622700","True","Yes","https://fortress.wa.gov/dshs/adsaapps/lookup/BHForms.aspx?Lic=2160",';
const RITZVILLE_ROW = '"None","Assisted Living SOW","","2631","60001105","47840","BH  ","Community Pride Ritzville LLC","OP    ","406 S Cascade St","Ritzville","WA","99169","Adams","PO Box 59","Saint John","WA","99171","(509) 659-4717","","(509) 659-4716","1B","","1002XS-12 ","Sadera, Isaac","21","4/30/2027 12:00:00 AM","","","","175883","False","Yes","https://fortress.wa.gov/dshs/adsaapps/lookup/BHForms.aspx?Lic=2631",';

test('real first-pull headers cover every required column, with the documented per-class divergence', () => {
  for (const kind of ['afh', 'alf']) {
    const headers = realHeaders(kind);
    for (const column of WA_DSHS_REQUIRED_COLUMNS) {
      assert.ok(headers.includes(column), `${kind} headers must include ${column}`);
    }
  }
  assert.ok(realHeaders('afh').includes('Disclosure of Services'));
  assert.ok(realHeaders('alf').includes('Check_Type'));
});

test('canonical identity is the typed license key', () => {
  assert.equal(waDshsEntityId('afh', '103302'), 'wa_dshs_license:AFH:103302');
  assert.equal(waDshsEntityId('alf', '2160'), 'wa_dshs_license:ALF:2160');
  assert.equal(waDshsEntityId('afh', '  '), null);
  assert.throws(() => waDshsEntityId('bogus', '1'), /wa_dshs_unknown_class/);
});

test('normalizer trims padded source values and types the fields', () => {
  const signal = normalizeWaDshsDirectoryRow('afh', AFH_RECORD, { retrievedAt: '2026-11-09T11:16:00.000Z' });
  assert.equal(signal.signal_type, 'wa_dshs_adult_family_home');
  assert.equal(signal.timestamp, '2026-11-09T11:16:00.000Z');
  assert.equal(signal.payload.external_id, 'wa_dshs_afh_directory_103302');
  assert.equal(signal.payload.canonical_entity_id, 'wa_dshs_license:AFH:103302');
  assert.equal(signal.payload.facility_type, 'AF');
  assert.equal(signal.payload.facility_status, 'OP');
  assert.equal(signal.payload.licensed_bed_count, 6);
  assert.equal(signal.payload.memory_certified, false);
  assert.equal(signal.payload.has_reports, true);
  assert.equal(signal.payload.license_expiration_at, null);
  assert.equal(signal.spacetime.jurisdiction, 'us_state_WA');
  assert.equal(signal.spacetime.zip, '99344');
  assert.equal(signal.provenance.source_system, 'wa_dshs_fortress_lookup');
});

test('normalizer parses a real expiration date and never fabricates one', () => {
  const record = { ...AFH_RECORD, LicenseExpirationDate: '4/30/2027 12:00:00 AM' };
  const signal = normalizeWaDshsDirectoryRow('afh', record, { retrievedAt: '2026-11-09T11:16:00.000Z' });
  assert.equal(signal.payload.license_expiration_date, '4/30/2027 12:00:00 AM');
  assert.equal(signal.payload.license_expiration_at, new Date('4/30/2027 12:00:00 AM').toISOString());
  const bad = normalizeWaDshsDirectoryRow('afh', { ...AFH_RECORD, LicenseExpirationDate: 'not a date' }, {});
  assert.equal(bad.payload.license_expiration_at, null);
});

test('county extraction reads the live form shape; the form body posts every county for CSV', () => {
  const html = '<input type="checkbox" name="county" value="Adams" />'
    + '<input type="checkbox" name="county" value="King" />'
    + '<input type="checkbox" name="county" value="King" />'
    + '<input type="checkbox" name="county" value="Yakima" />';
  assert.deepEqual(extractFortressCounties(html), ['Adams', 'King', 'Yakima']);
  const body = buildFortressCsvFormBody(['Adams', 'King']);
  const params = new URLSearchParams(body);
  assert.equal(params.get('searchOpt'), 'county');
  assert.equal(params.get('opt_output'), 'csv');
  assert.deepEqual(params.getAll('county'), ['Adams', 'King']);
});

test('directory fetch fails loudly when fortress answers HTML instead of CSV', async () => {
  const html = '<input type="checkbox" name="county" value="King" />';
  await assert.rejects(
    fetchWaDshsDirectoryCsv('afh', {
      httpGet: async () => html,
      httpPost: async () => '<html><body>error</body></html>',
    }),
    /wa_dshs_not_csv/,
  );
  const csv = await fetchWaDshsDirectoryCsv('afh', {
    httpGet: async () => html,
    httpPost: async () => '"LicenseNumber","FacilityName"\n"1","X"',
  });
  assert.ok(csv.includes('LicenseNumber'));
});

test('loader dedupes the state\'s own duplicate row and reconciles the summary', async () => {
  const headerLine = readFileSync(new URL('./fixtures/wa-dshs-headers/alf.txt', import.meta.url), 'utf8').trim();
  const csvText = [headerLine, SPRING_RIDGE_ROW, SPRING_RIDGE_ROW, RITZVILLE_ROW].join('\n');
  const posted = [];
  const summary = await loadWaDshsClass('alf', {
    apiBaseUrl: 'http://example.invalid',
    filePath: 'sealed.csv',
    readLocalFile: async () => csvText,
    post: async (spec, signals) => {
      posted.push(...signals);
      return { ingested_count: signals.length, replayed_count: 0, records_failed: 0 };
    },
    log: () => {},
  });
  assert.equal(summary.rows_received, 3);
  assert.equal(summary.source_duplicates, 1);
  assert.equal(summary.rows_posted, 2);
  assert.equal(summary.ingested_count, 2);
  assert.equal(summary.rows_received, summary.rows_posted + summary.source_duplicates + summary.blank_license_rows);
  assert.deepEqual(
    posted.map((s) => s.payload.canonical_entity_id).sort(),
    ['wa_dshs_license:ALF:2160', 'wa_dshs_license:ALF:2631'],
  );
  assert.match(summary.artifact.sha256, /^[0-9a-f]{64}$/);
});

test('directory poster aggregates disjoint slice receipts', async () => {
  const spec = { moduleHint: 'assisted_living_facility' };
  const signals = Array.from({ length: 10 }, (_, i) => ({ n: i }));
  const totals = await postDirectorySignals({
    spec,
    signals,
    apiBaseUrl: 'http://example.invalid',
    concurrency: 3,
    post: async (s, slice) => ({ ingested_count: slice.length, replayed_count: 0, records_failed: 0 }),
  });
  assert.equal(totals.ingested_count, 10);
  assert.equal(totals.slices_failed, 0);
});

test('argument discipline: class selection validates, unknown flags throw', () => {
  assert.deepEqual(parseWaDshsArgs(['--class', 'alf']).classes, ['alf']);
  assert.deepEqual(parseWaDshsArgs(['--class', 'all']).classes, ['afh', 'alf']);
  assert.throws(() => parseWaDshsArgs(['--class', 'bogus']), /wa_dshs_unknown_class/);
  assert.throws(() => parseWaDshsArgs(['--nope']), /wa_dshs_unknown_flag/);
});
