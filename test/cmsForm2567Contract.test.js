// Contract tests for the CMS Form 2567 document layer
// (src/adapters/cmsForm2567Adapter.js + scripts/fetchCms2567.mjs),
// built 2026-11-09 with the WA pilot.
//
// These pin:
//   1. the Care Compare URL shapes — the verified
//      'complaint-inspection' slug leads the health candidates,
//      and every candidate is a declared, receipted probe target
//      (an unverified slug is eliminated by the probe, in the
//      open, never silently trusted);
//   2. PDF detection is by magic bytes, not by status alone — a
//      200 HTML error page is NOT a document;
//   3. the document normalizer: the (CCN, survey_date, category,
//      kind) key, the cms_provider:<ccn> join identity, and the
//      content hash carried on the signal;
//   4. the runner: first answering PDF wins, probe mode posts
//      nothing, and a target no candidate answers for lands in
//      failures (unknown stays unknown, labeled).

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  FORM_2567_KIND_CANDIDATES,
  buildForm2567Url,
  form2567Candidates,
  isPdfBytes,
  normalizeForm2567Document,
} from '../src/adapters/cmsForm2567Adapter.js';
import {
  parseForm2567Args,
  runForm2567,
} from '../scripts/fetchCms2567.mjs';

const PDF_BYTES = Buffer.from('%PDF-1.4 fake pilot body');
const PDF_SHA = createHash('sha256').update(PDF_BYTES).digest('hex');

test('candidate URLs carry the verified slug first and the declared shape throughout', () => {
  assert.equal(FORM_2567_KIND_CANDIDATES.health[0], 'complaint-inspection');
  assert.equal(
    buildForm2567Url('505442', 'health', 'complaint-inspection', '2026-03-04'),
    'https://www.medicare.gov/care-compare/inspections/pdf/nursing-home/505442/health/complaint-inspection?date=2026-03-04',
  );
  const candidates = form2567Candidates('505442', 'fire', '2026-03-04');
  assert.ok(candidates.length >= 2);
  for (const { url } of candidates) {
    assert.ok(url.startsWith('https://www.medicare.gov/care-compare/inspections/pdf/nursing-home/505442/fire/'));
    assert.ok(url.endsWith('?date=2026-03-04'));
  }
  assert.throws(() => form2567Candidates('505442', 'bogus', '2026-03-04'), /cms_2567_unknown_category/);
});

test('PDF detection requires the magic bytes', () => {
  assert.equal(isPdfBytes(PDF_BYTES), true);
  assert.equal(isPdfBytes(Buffer.from('<html>not a pdf</html>')), false);
  assert.equal(isPdfBytes(Buffer.alloc(0)), false);
  assert.equal(isPdfBytes(null), false);
});

test('document normalizer keys the document and joins the provider identity', () => {
  const signal = normalizeForm2567Document({
    ccn: '505442',
    surveyDate: '2026-03-04',
    category: 'health',
    kind: 'complaint-inspection',
    sourceUrl: buildForm2567Url('505442', 'health', 'complaint-inspection', '2026-03-04'),
    sha256: PDF_SHA,
    bytes: PDF_BYTES.length,
    retrievedAt: '2026-11-09T16:30:00.000Z',
  });
  assert.equal(signal.signal_type, 'cms_nursing_home_form_2567');
  assert.equal(signal.payload.external_id, 'cms_2567_505442_health_2026-03-04');
  assert.equal(signal.payload.canonical_entity_id, 'cms_provider:505442');
  assert.equal(signal.payload.sha256, PDF_SHA);
  assert.equal(signal.spacetime.jurisdiction, 'us_state_WA');
  assert.equal(signal.provenance.source_system, 'cms_care_compare');
});

test('runner: first PDF wins, HTML 200s do not count, probe posts nothing', async () => {
  const calls = [];
  const httpGetBytes = async (url) => {
    calls.push(url);
    if (url.includes('complaint-inspection')) return { status: 200, bytes: Buffer.from('<html>challenge</html>') };
    if (url.includes('standard-inspection')) return { status: 200, bytes: PDF_BYTES };
    return { status: 404, bytes: Buffer.alloc(0) };
  };
  let posts = 0;
  const summary = await runForm2567({
    ccn: '505442',
    targets: [{ category: 'health', surveyDate: '2026-03-04' }],
    probe: false,
    apiBaseUrl: 'http://example.invalid',
    httpGetBytes,
    post: async (signals) => { posts += signals.length; return { ingested_count: 1, replayed_count: 0, records_failed: 0 }; },
    log: () => {},
  });
  assert.equal(summary.failures.length, 0);
  assert.equal(summary.results[0].kind, 'standard-inspection');
  assert.equal(summary.results[0].sha256, PDF_SHA);
  assert.equal(posts, 1);

  const probeSummary = await runForm2567({
    ccn: '505442',
    targets: [{ category: 'health', surveyDate: '2026-03-04' }],
    probe: true,
    httpGetBytes,
    post: async () => { throw new Error('probe must not post'); },
    log: () => {},
  });
  assert.equal(probeSummary.results[0].found, true);
});

test('runner: a target no candidate answers for is a labeled failure', async () => {
  const summary = await runForm2567({
    ccn: '505442',
    targets: [{ category: 'fire', surveyDate: '2023-08-04' }],
    probe: true,
    httpGetBytes: async () => ({ status: 404, bytes: Buffer.alloc(0) }),
    log: () => {},
  });
  assert.equal(summary.results[0].found, false);
  assert.equal(summary.failures.length, 1);
});

test('argument discipline: targets parse, bad shapes throw', () => {
  const args = parseForm2567Args(['--ccn', '505442', '--target', 'health:2026-03-04', '--probe']);
  assert.equal(args.ccn, '505442');
  assert.deepEqual(args.targets, [{ category: 'health', surveyDate: '2026-03-04' }]);
  assert.equal(args.probe, true);
  assert.throws(() => parseForm2567Args(['--target', 'health:2026-03-04']), /cms_2567_ccn_required/);
  assert.throws(() => parseForm2567Args(['--ccn', '505442', '--target', 'health:March 4']), /cms_2567_bad_target/);
});
