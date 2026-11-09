// CMS Form 2567 document adapter — the survey REPORTS behind the
// nursing-home deficiency rows.
//
// Why this layer exists (scope: WA-AFH-2567-SCOPE-2026-11-09.md):
// the Provider Data Catalog rows carry the citation's requirement
// text, NOT the surveyor's narrative — the facts of what happened
// (e.g. Kline Galland's F0610: three unwitnessed falls, the
// neurological assessments the DON admitted were never done) live
// only in the 2567 document itself. The document key is
// (CCN, survey_date, category, kind), joined to the deficiency
// events already in the reservoir on cms_provider:<ccn>.
//
// The door is CMS itself: Care Compare serves the PDFs at
//   https://www.medicare.gov/care-compare/inspections/pdf/
//     nursing-home/{CCN}/{category}/{kind}?date={YYYY-MM-DD}
// The 'complaint-inspection' kind slug is verified from three
// independent published examples (scope, 2026-11-09); the standard
// and fire-safety slugs were NOT verified there, and this sandbox's
// own egress draws a 403 from medicare.gov — so the pilot's first
// server-side run is a PROBE: it tries the declared candidate
// slugs per target and receipts which ones answer with a real PDF
// (%PDF magic + bytes + SHA-256). A slug that 404s is a finding,
// not a failure to hide. Nothing here guesses a URL into the
// reservoir: a document signal is created only from bytes that
// arrived and hashed.

import { cmsProviderEntityId, jurisdictionIdForState } from './cmsNursingHomeAdapter.js';
import { toIsoTimestamp } from './ingestClient.js';

export const FORM_2567_STREAM_ID = 'cms_nh_2567_documents';
export const FORM_2567_MODULE_HINT = 'nursing_home_2567_document';

const CARE_COMPARE_BASE = 'https://www.medicare.gov/care-compare/inspections/pdf/nursing-home';

// Candidate kind slugs per category, in probe order. Only
// 'complaint-inspection' (health) is externally verified; the
// rest are declared candidates the probe receipts or eliminates.
export const FORM_2567_KIND_CANDIDATES = Object.freeze({
  health: Object.freeze(['complaint-inspection', 'standard-inspection', 'health-inspection']),
  fire: Object.freeze(['fire-safety-inspection', 'complaint-inspection', 'standard-inspection']),
});

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

export function buildForm2567Url(ccn, category, kind, surveyDate) {
  return `${CARE_COMPARE_BASE}/${text(ccn)}/${category}/${kind}?date=${text(surveyDate)}`;
}

export function form2567Candidates(ccn, category, surveyDate) {
  const kinds = FORM_2567_KIND_CANDIDATES[category];
  if (!kinds) throw new Error(`cms_2567_unknown_category: ${category}`);
  return kinds.map((kind) => ({ kind, url: buildForm2567Url(ccn, category, kind, surveyDate) }));
}

export function isPdfBytes(bytes) {
  if (!bytes || bytes.length < 5) return false;
  return bytes.subarray(0, 5).toString('latin1') === '%PDF-';
}

export function normalizeForm2567Document({
  ccn,
  state = 'WA',
  surveyDate,
  category,
  kind,
  sourceUrl,
  sha256,
  bytes,
  retrievedAt,
} = {}) {
  const providerId = text(ccn);
  const jurisdiction = jurisdictionIdForState(state);
  return {
    signal_type: 'cms_nursing_home_form_2567',
    timestamp: toIsoTimestamp(retrievedAt),
    spacetime: {
      region: jurisdiction,
      jurisdiction,
      city: '',
      state: text(state) || 'WA',
      zip: '',
    },
    provenance: {
      channel: 'cms_2567',
      source_system: 'cms_care_compare',
      confidence: 1.0,
      source_url: sourceUrl,
    },
    payload: {
      external_id: `cms_2567_${providerId}_${category}_${text(surveyDate)}`,
      canonical_entity_id: cmsProviderEntityId(providerId),
      cms_certification_number_ccn: providerId,
      survey_date: text(surveyDate),
      category,
      document_kind: kind,
      source_url: sourceUrl,
      sha256,
      bytes,
    },
  };
}
