import axios from 'axios';
import dotenv from 'dotenv';
import { postSignalsToAtlas, toIsoTimestamp } from './ingestClient.js';
dotenv.config();

// CMS nursing home data via the Provider Data Catalog API
// (data.cms.gov/provider-data), the public API behind Care Compare.
//
// Why this source (Alexander's direction, 2026-11-08): nursing-home
// records in the WHD class — inspectors who went in, wrote graded
// findings, and dated the corrections — not counts of complaints.
// The scope document (~/workspace/luminari-recovery/
// CMS-NURSING-HOME-SCOPE-2026-11-08.md) verified every dataset and
// field below against the live API on 2026-11-08, and Kline
// Galland's own record (CCN 505442) was re-pulled first-hand.
//
// Four datasets, four streams, one tuple family (source_id 'cms_nh',
// jurisdiction 'us_state_WA' — the draw is Washington-first per the
// state-by-state reset; national volumes are ~419k health citations
// and are a separate deliberate choice, not a default):
//   Provider Information   4pq5-n9py -> cms_nh_provider_info
//   Health Deficiencies    r5ix-sfxw -> cms_nh_health_deficiencies
//   Fire Safety Defic.     ifjz-ge4w -> cms_nh_fire_safety_deficiencies
//   Penalties              g6vv-u9sr -> cms_nh_penalties
//
// What a deficiency row carries: the F-tag (or fire-safety tag), the
// text of the requirement (deficiency_description), the
// scope/severity grade (single letter A-L: A-C no harm/potential,
// D-F no actual harm with potential for more than minimal harm,
// G-I actual harm, J-L immediate jeopardy), whether the citation
// came from a standard survey or a complaint, and its correction
// status and date. What it does NOT carry: the surveyor's Form 2567
// narrative of what was observed — the API publishes the standard's
// text, not the observation narrative. Records here are graded
// findings, labeled as such; a citation is not a narrative.
//
// Draw shape: the source refreshes monthly (current release
// processed 2026-10-01; next 2026-12-02), so each run re-draws the
// full WA slice (193 facilities; ~9.6k health + ~6.3k fire rows;
// penalties are few) and replay dedupe absorbs the overlap. The
// datastore is paged with a stable sort (CCN, then survey date,
// then tag) so offset paging inside one run is deterministic.
// National expansion (Alexander's direction, 2026-11-08, "we want
// the whole country"): four more streams carry every other state
// under the federal tuple (source_id 'cms_nh', jurisdiction
// 'us_federal' — the WHD pattern), one stream per dataset:
//   cms_nh_provider_info_national
//   cms_nh_health_deficiencies_national
//   cms_nh_fire_safety_deficiencies_national
//   cms_nh_penalties_national
// Washington is deliberately NOT re-posted into them: WA already
// lives in the four us_state_WA streams above, and the whole
// country is the union of the two families with zero double-count.
// Every record still carries its own state's spacetime jurisdiction
// (us_state_<XX> derived from the row) and the same
// cms_provider:<ccn> canonical identity — CCNs are nationally
// unique, so a facility joins across both families. National
// volumes (live API counts, 2026-11-08): 14,686 providers,
// 418,682 health citations, 200,387 fire-safety citations, 15,007
// penalties. The national streams are job-driven through
// scripts/backfillCmsNational.mjs (state-legged, resumable), not
// scheduler-driven: the source is monthly and a full national
// cycle is ~632k posts beyond WA.

const CMS_PDC_BASE = 'https://data.cms.gov/provider-data/api/1';

export const CMS_DATASETS = Object.freeze({
  provider_info: '4pq5-n9py',
  health_deficiencies: 'r5ix-sfxw',
  fire_safety_deficiencies: 'ifjz-ge4w',
  penalties: 'g6vv-u9sr',
});

const STATE = 'WA';
const JURISDICTION_ID = 'us_state_WA';

// The federal tuple the national streams post under (the WHD
// pattern: one stream per dataset, the record's own state carried
// per signal).
export const NATIONAL_JURISDICTION_ID = 'us_federal';

export function jurisdictionIdForState(state) {
  const value = text(state);
  return value ? `us_state_${value}` : JURISDICTION_ID;
}

function asNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

// The canonical provider identity every CMS stream joins on: the
// federal certification number. Lane A's catalog keys entities by
// typed identifiers; this is the nursing-home one.
export function cmsProviderEntityId(ccn) {
  const value = text(ccn);
  return value ? `cms_provider:${value}` : null;
}

function baseSpacetime(record) {
  // The spacetime jurisdiction is the record's own state, WA rows
  // included (us_state_WA) — so a signal reads identically in the
  // WA family and the national family.
  const jurisdiction = jurisdictionIdForState(record.state);
  return {
    region: jurisdiction,
    jurisdiction,
    city: text(record.citytown),
    state: text(record.state) || STATE,
    zip: text(record.zip_code),
  };
}

function baseProvenance(datasetId) {
  return {
    channel: 'cms_nh',
    source_system: 'cms_provider_data_catalog',
    confidence: 1.0,
    source_url: `${CMS_PDC_BASE}/datastore/query/${datasetId}/0`,
  };
}

export function normalizeCmsProvider(record) {
  const ccn = text(record.cms_certification_number_ccn);
  return {
    signal_type: 'cms_nursing_home_provider',
    timestamp: toIsoTimestamp(record.processing_date),
    spacetime: baseSpacetime(record),
    provenance: baseProvenance(CMS_DATASETS.provider_info),
    payload: {
      external_id: `cms_nh_provider_${ccn}`,
      canonical_entity_id: cmsProviderEntityId(ccn),
      cms_certification_number_ccn: ccn,
      provider_name: text(record.provider_name),
      legal_business_name: text(record.legal_business_name),
      provider_address: text(record.provider_address),
      city: text(record.citytown),
      state: text(record.state),
      zip: text(record.zip_code),
      latitude: asNumber(record.latitude),
      longitude: asNumber(record.longitude),
      ownership_type: text(record.ownership_type),
      number_of_certified_beds: asNumber(record.number_of_certified_beds),
      average_number_of_residents_per_day: asNumber(record.average_number_of_residents_per_day),
      provider_type: text(record.provider_type),
      overall_rating: asNumber(record.overall_rating),
      health_inspection_rating: asNumber(record.health_inspection_rating),
      staffing_rating: asNumber(record.staffing_rating),
      qm_rating: asNumber(record.qm_rating),
      reported_total_nurse_staffing_hours: asNumber(record.reported_total_nurse_staffing_hours_per_resident_per_day),
      total_nursing_staff_turnover: asNumber(record.total_nursing_staff_turnover),
      registered_nurse_turnover: asNumber(record.registered_nurse_turnover),
      number_of_fines: asNumber(record.number_of_fines),
      total_amount_of_fines_in_dollars: asNumber(record.total_amount_of_fines_in_dollars),
      number_of_payment_denials: asNumber(record.number_of_payment_denials),
      total_number_of_penalties: asNumber(record.total_number_of_penalties),
      abuse_icon: text(record.abuse_icon),
      special_focus_status: text(record.special_focus_status),
      most_recent_health_inspection_more_than_2_years_ago: text(record.most_recent_health_inspection_more_than_2_years_ago),
      rating_cycle_1_standard_survey_health_date: text(record.rating_cycle_1_standard_survey_health_date),
      rating_cycle_1_total_number_of_health_deficiencies: asNumber(record.rating_cycle_1_total_number_of_health_deficiencies),
      rating_cycle_1_total_health_score: asNumber(record.rating_cycle_1_total_health_score),
      total_weighted_health_survey_score: asNumber(record.total_weighted_health_survey_score),
      processing_date: text(record.processing_date),
      raw: record,
    },
  };
}

function normalizeDeficiency(record, { datasetId, streamKind }) {
  const ccn = text(record.cms_certification_number_ccn);
  const tag = `${text(record.deficiency_prefix)}${text(record.deficiency_tag_number).padStart(4, '0')}`;
  const surveyDate = text(record.survey_date);
  const fire = streamKind === 'fire_safety';
  return {
    signal_type: fire ? 'cms_nursing_home_fire_safety_deficiency' : 'cms_nursing_home_health_deficiency',
    timestamp: toIsoTimestamp(surveyDate || record.processing_date),
    spacetime: baseSpacetime(record),
    provenance: baseProvenance(datasetId),
    payload: {
      external_id: `cms_nh_${fire ? 'fire' : 'def'}_${ccn}_${surveyDate}_${tag}`,
      canonical_entity_id: cmsProviderEntityId(ccn),
      cms_certification_number_ccn: ccn,
      provider_name: text(record.provider_name),
      provider_address: text(record.provider_address),
      city: text(record.citytown),
      state: text(record.state),
      zip: text(record.zip_code),
      survey_date: surveyDate,
      survey_type: text(record.survey_type),
      survey_footnote: text(record.survey_footnote),
      deficiency_prefix: text(record.deficiency_prefix),
      deficiency_tag_number: text(record.deficiency_tag_number),
      deficiency_tag: tag,
      deficiency_category: text(record.deficiency_category),
      deficiency_description: text(record.deficiency_description),
      scope_severity_code: text(record.scope_severity_code),
      deficiency_corrected: text(record.deficiency_corrected),
      correction_date: text(record.correction_date),
      inspection_cycle: asNumber(record.inspection_cycle),
      standard_deficiency: text(record.standard_deficiency),
      complaint_deficiency: text(record.complaint_deficiency),
      infection_control_inspection_deficiency: text(record.infection_control_inspection_deficiency),
      citation_under_idr: text(record.citation_under_idr),
      citation_under_iidr: text(record.citation_under_iidr),
      processing_date: text(record.processing_date),
      raw: record,
    },
  };
}

export function normalizeCmsHealthDeficiency(record) {
  return normalizeDeficiency(record, { datasetId: CMS_DATASETS.health_deficiencies, streamKind: 'health' });
}

export function normalizeCmsFireSafetyDeficiency(record) {
  return normalizeDeficiency(record, { datasetId: CMS_DATASETS.fire_safety_deficiencies, streamKind: 'fire_safety' });
}

export function normalizeCmsPenalty(record) {
  const ccn = text(record.cms_certification_number_ccn);
  const fineId = text(record.fine_id);
  return {
    signal_type: 'cms_nursing_home_penalty',
    timestamp: toIsoTimestamp(record.penalty_date || record.processing_date),
    spacetime: baseSpacetime(record),
    provenance: baseProvenance(CMS_DATASETS.penalties),
    payload: {
      external_id: `cms_nh_penalty_${fineId || `${ccn}_${text(record.penalty_date)}_${text(record.penalty_type)}`}`,
      canonical_entity_id: cmsProviderEntityId(ccn),
      cms_certification_number_ccn: ccn,
      provider_name: text(record.provider_name),
      provider_address: text(record.provider_address),
      city: text(record.citytown),
      state: text(record.state),
      zip: text(record.zip_code),
      fine_id: fineId,
      penalty_type: text(record.penalty_type),
      penalty_date: text(record.penalty_date),
      fine_amount: asNumber(record.fine_amount),
      payment_denial_start_date: text(record.payment_denial_start_date),
      payment_denial_length_in_days: asNumber(record.payment_denial_length_in_days),
      processing_date: text(record.processing_date),
      raw: record,
    },
  };
}

// Build the datastore query URL for one page. The DKAN datastore API
// takes conditions/sorts as bracketed query parameters; the sort
// (CCN, survey date, tag — properties that exist on the deficiency
// datasets; CCN alone on the others) keeps offset paging stable
// within a run against a monthly-static release.
export function buildCmsDatastoreUrl(datasetId, { state = STATE, limit = 500, offset = 0, sortProperties = ['cms_certification_number_ccn'] } = {}) {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  params.set('count', 'true');
  params.set('results', 'true');
  params.set('conditions[0][property]', 'state');
  params.set('conditions[0][value]', state);
  params.set('conditions[0][operator]', '=');
  sortProperties.forEach((property, index) => {
    params.set(`sorts[${index}][property]`, property);
    params.set(`sorts[${index}][order]`, 'asc');
  });
  return `${CMS_PDC_BASE}/datastore/query/${datasetId}/0?${params.toString()}`;
}

// Default transport: one axios GET resolving to the parsed JSON
// body. Tests inject a stub httpGet with this same shape.
async function defaultHttpGet(url) {
  const response = await axios.get(url, {
    timeout: 60000,
    headers: { Accept: 'application/json' },
  });
  return response.data;
}

function cmsRequestError(error, datasetId) {
  const status = error?.response?.status ?? null;
  const body = error?.response?.data;
  const detail = typeof body === 'string'
    ? body
    : body?.message || body?.error || error?.message || String(error);
  const wrapped = new Error(
    `cms_nh_request_failed dataset=${datasetId}` +
    `${status ? ` status=${status}` : ''}` +
    ` detail=${String(detail).slice(0, 300)}`
  );
  wrapped.status = status;
  wrapped.cause = error;
  return wrapped;
}

// Fetch the full WA slice of one dataset, page by page. An
// unrecognised envelope fails loudly — an unexpected response is a
// failure, never a silent zero.
export async function fetchCmsDataset(datasetId, { state = STATE, pageSize = 500, maxPages = 100, httpGet = defaultHttpGet, sortProperties } = {}) {
  const records = [];
  for (let page = 0; page < maxPages; page += 1) {
    const url = buildCmsDatastoreUrl(datasetId, {
      state,
      limit: pageSize,
      offset: page * pageSize,
      ...(sortProperties ? { sortProperties } : {}),
    });
    let payload;
    try {
      payload = await httpGet(url);
    } catch (e) {
      throw cmsRequestError(e, datasetId);
    }
    if (!payload || !Array.isArray(payload.results)) {
      throw new Error(
        `cms_nh_unexpected_payload: response for dataset ${datasetId} carried no results ` +
        `array (shape: ${payload && typeof payload === 'object' ? `object keys=[${Object.keys(payload).join(',')}]` : typeof payload}). ` +
        'Refusing to map an unrecognised payload to zero records.'
      );
    }
    records.push(...payload.results);
    if (payload.results.length < pageSize) break;
  }
  return records;
}

const DEFICIENCY_SORT = ['cms_certification_number_ccn', 'survey_date', 'deficiency_tag_number'];

async function ingestStream({ datasetId, moduleHint, normalize, sortProperties, httpGet, apiBaseUrl, state = STATE, jurisdictionId = JURISDICTION_ID, maxPages }) {
  const records = await fetchCmsDataset(datasetId, { state, httpGet, ...(sortProperties ? { sortProperties } : {}), ...(maxPages ? { maxPages } : {}) });
  const signals = records.map(normalize);
  if (!signals.length) {
    return { accepted: true, ingested_count: 0, note: `No CMS nursing-home records returned for dataset ${datasetId}` };
  }
  return postSignalsToAtlas({
    sourceId: 'cms_nh',
    jurisdictionId,
    moduleHint,
    signals,
    apiBaseUrl,
    // The governed ingest answers per-signal work synchronously and
    // the client's default batch (500) is too big for wide rows: the
    // first live provider post — one 193-signal, 604 KB batch —
    // exceeded the 60 s timeout on 2026-11-08 (ECONNABORTED, zero
    // records landed). 25 is the WHD backfill's proven shape.
    batchSize: 25,
  });
}

export async function ingestCmsProviderInfoSignals({ httpGet, apiBaseUrl, state, jurisdictionId, maxPages } = {}) {
  return ingestStream({
    datasetId: CMS_DATASETS.provider_info,
    moduleHint: 'nursing_home_provider',
    normalize: normalizeCmsProvider,
    httpGet,
    apiBaseUrl,
    ...(state ? { state } : {}),
    ...(jurisdictionId ? { jurisdictionId } : {}),
    ...(maxPages ? { maxPages } : {}),
  });
}

export async function ingestCmsHealthDeficiencySignals({ httpGet, apiBaseUrl, state, jurisdictionId, maxPages } = {}) {
  return ingestStream({
    datasetId: CMS_DATASETS.health_deficiencies,
    moduleHint: 'nursing_home_deficiency',
    normalize: normalizeCmsHealthDeficiency,
    sortProperties: DEFICIENCY_SORT,
    httpGet,
    apiBaseUrl,
    ...(state ? { state } : {}),
    ...(jurisdictionId ? { jurisdictionId } : {}),
    ...(maxPages ? { maxPages } : {}),
  });
}

export async function ingestCmsFireSafetySignals({ httpGet, apiBaseUrl, state, jurisdictionId, maxPages } = {}) {
  return ingestStream({
    datasetId: CMS_DATASETS.fire_safety_deficiencies,
    moduleHint: 'nursing_home_fire_safety',
    normalize: normalizeCmsFireSafetyDeficiency,
    sortProperties: DEFICIENCY_SORT,
    httpGet,
    apiBaseUrl,
    ...(state ? { state } : {}),
    ...(jurisdictionId ? { jurisdictionId } : {}),
    ...(maxPages ? { maxPages } : {}),
  });
}

export async function ingestCmsPenaltySignals({ httpGet, apiBaseUrl, state, jurisdictionId, maxPages } = {}) {
  return ingestStream({
    datasetId: CMS_DATASETS.penalties,
    moduleHint: 'nursing_home_penalty',
    normalize: normalizeCmsPenalty,
    sortProperties: ['cms_certification_number_ccn', 'penalty_date'],
    httpGet,
    apiBaseUrl,
    ...(state ? { state } : {}),
    ...(jurisdictionId ? { jurisdictionId } : {}),
    ...(maxPages ? { maxPages } : {}),
  });
}

// One state's full draw (all four datasets) under the national
// tuple. Used by scripts/backfillCmsNational.mjs, which legs the
// country state by state. maxPages 200 (100k rows) clears the
// largest state's deficiency files with headroom.
export async function ingestCmsStateSignals(state, { httpGet, apiBaseUrl } = {}) {
  const options = { httpGet, apiBaseUrl, state, jurisdictionId: NATIONAL_JURISDICTION_ID, maxPages: 200 };
  const results = {};
  results.providers = await ingestCmsProviderInfoSignals(options);
  results.health_deficiencies = await ingestCmsHealthDeficiencySignals(options);
  results.fire_safety = await ingestCmsFireSafetySignals(options);
  results.penalties = await ingestCmsPenaltySignals(options);
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // Standalone runs (Render jobs) are separate containers: the
  // ingest client's default base URL is the in-service loopback,
  // which does not exist there. Post through the public URL, the
  // same door the WHD backfill uses.
  const apiBaseUrl = process.env.ATLAS_PUBLIC_URL || 'https://atlas.columbiacitycustomllc.com';
  console.log('Fetching CMS nursing-home WA slices (providers, deficiencies, fire safety, penalties)...');
  const results = {};
  results.providers = await ingestCmsProviderInfoSignals({ apiBaseUrl });
  results.health_deficiencies = await ingestCmsHealthDeficiencySignals({ apiBaseUrl });
  results.fire_safety = await ingestCmsFireSafetySignals({ apiBaseUrl });
  results.penalties = await ingestCmsPenaltySignals({ apiBaseUrl });
  console.log(JSON.stringify({ ok: true, source: 'cms_nh', results }, null, 2));
}
