// Contract tests for the WHD adapter's integrity declarations
// (feature/whd-integrity-declarations-2026-11-07).
//
// The Domain 3 integrity engine (src/services/
// integrityPatternDetectorService.js) detects only over structures
// a governed source adapter explicitly declares in
// payload.integrity_observation. The WHD adapter declares one
// numeric observation per concluded case with a findings_end_date:
// the date (as epoch days) must fall inside the declared range
// [dataset coverage start 2005-01-01, the record's own load_dt].
//
// These tests pin:
//   1. the epoch-day conversion (exact values, datetime strings,
//      rejection of non-dates and overflow dates);
//   2. the declaration shape the engine's mapper consumes — kind,
//      canonical subject, metric, numeric bounds — plus the
//      human-readable basis carried on the face of the payload;
//   3. the honest skips: no findings date, no load_dt, no case id
//      -> no declaration (a missing value is not a number);
//   4. end to end through the REAL detector: an in-range
//      declaration maps to one numeric observation and yields no
//      candidate; a far-future findings date (the source carries
//      a real 3021 typo) yields exactly one
//      numeric_range_anomaly candidate with a resolvable
//      evidence reference;
//   5. the governed ingest tuple for the declaration stream,
//      pinned at source level like the WHD tuple before it.
//
// No network, no key: the builder is pure, and the detector runs
// in-process over events shaped exactly as the ingest door stores
// them.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildWhdDeclarations,
  buildWhdFindingsDeclaration,
  epochDays,
  WHD_FINDINGS_RANGE_RULE,
} from '../src/adapters/dolWhdAdapter.js';
import {
  deriveIntegrityPatternCandidates,
  mapIntegrityPatternInput,
  summarizeIntegrityPatternReadiness,
} from '../src/services/integrityPatternDetectorService.js';

const adapterSource = readFileSync(
  new URL('../src/adapters/dolWhdAdapter.js', import.meta.url),
  'utf8',
);

// Trimmed from the DOL metadata endpoint's published preview rows
// (same fixtures as the WHD successor contract), plus the load_dt
// every real record carries (verified against stored events
// 2026-11-07).
const IN_RANGE_CASE = {
  case_id: 1784005,
  trade_nm: 'Westwood Center',
  legal_name: 'Healthcare Services Group, Inc.',
  street_addr_1_txt: '123 Main St',
  cty_nm: 'Keene',
  st_cd: 'NH',
  zip_cd: '03431',
  case_violtn_cnt: 1,
  findings_start_date: '2019-01-01T00:00:00',
  findings_end_date: '2020-06-30T00:00:00',
  load_dt: '2026-10-09T08:25:28',
};

// The source dataset carries a findings_end_date typo'd to 3021
// (verified from the dataset during the 2026-11-06 WHD build
// recon). This fixture reproduces that record's decisive fields.
const FAR_FUTURE_CASE = {
  case_id: 9999999,
  trade_nm: 'Future Findings Co',
  legal_name: 'Future Findings Co LLC',
  cty_nm: 'Nowhere',
  st_cd: 'WA',
  zip_cd: '98000',
  case_violtn_cnt: 1,
  findings_start_date: '2020-01-01T00:00:00',
  findings_end_date: '3021-05-01T00:00:00',
  load_dt: '2026-10-09T08:25:28',
};

test('epochDays converts calendar dates exactly', () => {
  assert.equal(epochDays('1970-01-01'), 0);
  assert.equal(epochDays('2005-01-01'), 12784);
  assert.equal(epochDays('2020-06-30'), 18443);
  assert.equal(epochDays('2020-06-30T00:00:00'), 18443);
  assert.equal(epochDays('3021-05-01'), 383990);
});

test('epochDays rejects non-dates and overflow dates', () => {
  assert.equal(epochDays(''), null);
  assert.equal(epochDays(null), null);
  assert.equal(epochDays(undefined), null);
  assert.equal(epochDays('not-a-date'), null);
  assert.equal(epochDays('2021-13-01'), null);
  assert.equal(epochDays('2021-02-30'), null);
});

test('declaration carries the exact observation the engine consumes', () => {
  const declaration = buildWhdFindingsDeclaration(IN_RANGE_CASE);
  assert.ok(declaration);
  assert.equal(declaration.signal_type, 'declared_numeric_observation');
  assert.equal(declaration.payload.declaration_rule, WHD_FINDINGS_RANGE_RULE);
  assert.equal(declaration.payload.source_external_id, 'whd_1784005');
  assert.equal(declaration.payload.findings_end_date, '2020-06-30T00:00:00');
  assert.equal(declaration.payload.load_dt, '2026-10-09T08:25:28');
  assert.match(declaration.payload.bounds_basis.expected_min, /FY2005/);
  assert.match(declaration.payload.bounds_basis.expected_max, /load_dt/);

  const observation = declaration.payload.integrity_observation;
  assert.equal(observation.kind, 'numeric_observation');
  assert.equal(observation.subject_canonical_entity_id, 'whd_case:1784005');
  assert.match(observation.subject_name, /Healthcare Services Group/);
  assert.equal(observation.metric, 'findings_end_date');
  assert.equal(observation.actual, epochDays('2020-06-30'));
  assert.equal(observation.expected_min, 12784);
  assert.equal(observation.expected_max, epochDays('2026-10-09'));
  assert.equal(observation.jurisdiction_id, 'us_state_NH');
});

test('no declaration without a findings date, a load stamp, or a case id', () => {
  assert.equal(buildWhdFindingsDeclaration({ ...IN_RANGE_CASE, findings_end_date: '' }), null);
  assert.equal(buildWhdFindingsDeclaration({ ...IN_RANGE_CASE, findings_end_date: undefined }), null);
  assert.equal(buildWhdFindingsDeclaration({ ...IN_RANGE_CASE, load_dt: '' }), null);
  assert.equal(buildWhdFindingsDeclaration({ ...IN_RANGE_CASE, case_id: '' }), null);
  assert.equal(buildWhdFindingsDeclaration({ ...IN_RANGE_CASE, findings_end_date: '3021-13-01' }), null);
  assert.deepEqual(buildWhdDeclarations([IN_RANGE_CASE, { ...IN_RANGE_CASE, case_id: 2, findings_end_date: '' }]).length, 1);
});

// Shape an ingested declaration event exactly as the replay loads
// it from signal_events (stream, offset, identity hash included).
function declarationEvent(declaration, offset) {
  return {
    stream_id: 'atlas_integrity_observations',
    offset,
    timestamp: declaration.timestamp,
    signal_type: declaration.signal_type,
    spacetime: declaration.spacetime,
    provenance: declaration.provenance,
    payload: declaration.payload,
    source_id: 'atlas_integrity',
    jurisdiction_id: 'us_federal',
    module_hint: 'integrity_observation',
    ingested_at: declaration.timestamp,
    event_identity_hash: 'a'.repeat(64),
  };
}

test('in-range declaration maps to one observation and no candidate', () => {
  const event = declarationEvent(buildWhdFindingsDeclaration(IN_RANGE_CASE), 1);
  const input = mapIntegrityPatternInput([event]);
  assert.equal(input.numeric_observations.length, 1);
  assert.equal(input.numeric_observations[0].metric, 'findings_end_date');

  const candidates = deriveIntegrityPatternCandidates([event]);
  assert.equal(
    candidates.filter((c) => c.rule_id === 'atlas.domain3.integrity.numeric_range_anomaly').length,
    0,
  );

  const readiness = summarizeIntegrityPatternReadiness([event]);
  assert.equal(readiness.declared_numeric_observations, 1);
  assert.ok(!readiness.blocking_gaps.includes('no_source_declared_numeric_bounds'));
});

test('far-future findings date yields exactly one anomaly candidate with evidence', () => {
  const event = declarationEvent(buildWhdFindingsDeclaration(FAR_FUTURE_CASE), 2);
  const candidates = deriveIntegrityPatternCandidates([event]);
  const anomalies = candidates.filter(
    (c) => c.rule_id === 'atlas.domain3.integrity.numeric_range_anomaly',
  );
  assert.equal(anomalies.length, 1);
  const candidate = anomalies[0];
  assert.equal(candidate.signal_type, 'numeric_range_anomaly_candidate');
  assert.match(candidate.title, /Declared-range anomaly/);
  assert.equal(candidate.evidence_refs.length, 1);
  assert.equal(candidate.evidence_refs[0].stream_id, 'atlas_integrity_observations');
  assert.equal(candidate.supporting_statistics.metric, 'findings_end_date');
  assert.ok(candidate.supporting_statistics.actual > candidate.supporting_statistics.expected_max);
});

test('declaration ingest tuple is pinned at source level', () => {
  assert.match(adapterSource, /sourceId:\s*'atlas_integrity'/);
  assert.match(adapterSource, /moduleHint:\s*'integrity_observation'/);
  assert.match(adapterSource, /declarations_posted/);
});
