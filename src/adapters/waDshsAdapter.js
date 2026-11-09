// WA DSHS Residential Care Services (RCS) adapter — fortress
// provider lookups for Adult Family Homes (AFH) and Assisted
// Living Facilities (ALF).
//
// Alexander's program (2026-11-09, WA AFH/ALF family build): the
// directory is the identity spine for Washington's licensed
// residential-care facilities — the state license number is the
// canonical key, exactly as the CCN is for CMS nursing homes.
// Scoping: ~/workspace/luminari-recovery/WA-AFH-2567-SCOPE-2026-11-09.md
// First pull receipt: afh-alf-pull/PULL-RECEIPT-2026-11-09.md
// (6,278 AFH rows / 6,278 distinct licenses; 559 ALF rows received,
// 558 distinct — license 2160 appears twice as a byte-identical
// row in the STATE's own file; the loader dedupes within a run and
// reports the source duplicate, never renumbering silently).
//
// The fortress lookups are plain HTML forms (verified first-hand
// 2026-11-09: no viewstate): POST searchOpt=county with every
// county checkbox and opt_output=csv to the class's Results page
// and the state generates the full directory as one CSV. Server-
// side generation is SLOW (minutes for AFH) — this family is
// job-driven (scripts/loadWaDshsDirectory.mjs), monthly, never a
// scheduler draw.
//
// Directory rows carry source-supplied street addresses, so every
// facility here is Civic-Map eligible under Alexander's rule
// (address in the source, or no pin). Coordinates are NOT in this
// source and are never invented here; geocoding from the source's
// own address is a downstream step, as with the SSA offices.

import axios from 'axios';

import { toIsoTimestamp } from './ingestClient.js';

export const WA_DSHS_SOURCE_ID = 'wa_dshs_rcs';
export const WA_DSHS_JURISDICTION_ID = 'us_state_WA';

const FORTRESS_BASE = 'https://fortress.wa.gov/dshs/adsaapps/lookup';

export const WA_DSHS_CLASSES = Object.freeze({
  afh: Object.freeze({
    licenseClass: 'afh',
    classToken: 'AFH',
    facilityTypeCode: 'AF',
    formPage: 'AFHAdvLookup.aspx',
    resultsPage: 'AFHAdvResults.aspx',
    streamId: 'wa_dshs_afh_directory',
    moduleHint: 'adult_family_home',
    signalType: 'wa_dshs_adult_family_home',
    governanceContractId: 'wa-dshs-afh-directory-v1',
  }),
  alf: Object.freeze({
    licenseClass: 'alf',
    classToken: 'ALF',
    facilityTypeCode: 'BH',
    formPage: 'BHAdvLookup.aspx',
    resultsPage: 'BHAdvResults.aspx',
    streamId: 'wa_dshs_alf_directory',
    moduleHint: 'assisted_living_facility',
    signalType: 'wa_dshs_assisted_living_facility',
    governanceContractId: 'wa-dshs-alf-directory-v1',
  }),
});

export function waDshsClassSpec(licenseClass) {
  const spec = WA_DSHS_CLASSES[String(licenseClass ?? '').toLowerCase()];
  if (!spec) throw new Error(`wa_dshs_unknown_class: ${licenseClass}`);
  return spec;
}

// The canonical facility identity every WA DSHS stream joins on:
// the state license number, namespaced by license class (AFH and
// ALF number spaces are independent). Lane A's catalog keys
// entities by typed identifiers; this is the residential-care one.
export function waDshsEntityId(licenseClass, licenseNumber) {
  const spec = waDshsClassSpec(licenseClass);
  const value = text(licenseNumber);
  return value ? `wa_dshs_license:${spec.classToken}:${value}` : null;
}

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function asNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asBool(value) {
  const normalized = text(value).toLowerCase();
  if (normalized === 'true' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === 'no') return false;
  return null;
}

// Read the county checkbox values out of a fortress lookup page.
// The loader posts EVERY county the live form offers, so a county
// the state adds later is picked up without a code change; the
// contract tests pin the extraction against the 2026-11-09 shape.
export function extractFortressCounties(html) {
  const counties = [];
  const seen = new Set();
  const pattern = /<input[^>]*name="county"[^>]*>/gi;
  let match;
  while ((match = pattern.exec(String(html ?? ''))) !== null) {
    const valueMatch = /value="([^"]*)"/i.exec(match[0]);
    const value = valueMatch ? valueMatch[1].trim() : '';
    if (value && !seen.has(value)) {
      seen.add(value);
      counties.push(value);
    }
  }
  return counties;
}

// The all-counties CSV request body for a class's Results page.
export function buildFortressCsvFormBody(counties) {
  const params = new URLSearchParams();
  params.append('searchOpt', 'county');
  for (const county of counties) params.append('county', county);
  params.append('opt_output', 'csv');
  params.append('submit1', 'Search');
  return params.toString();
}

async function defaultHttpGet(url) {
  const response = await axios.get(url, {
    timeout: 60000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
  });
  return response.data;
}

async function defaultHttpPost(url, body) {
  const response = await axios.post(url, body, {
    timeout: 600000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });
  return response.data;
}

// Fetch one class's full-state directory CSV from fortress: read
// the live form for its county list, then POST for the CSV.
// Fails loudly on a non-CSV answer (an HTML error page from
// fortress must never be parsed as a directory).
export async function fetchWaDshsDirectoryCsv(licenseClass, { httpGet = defaultHttpGet, httpPost = defaultHttpPost } = {}) {
  const spec = waDshsClassSpec(licenseClass);
  const formHtml = await httpGet(`${FORTRESS_BASE}/${spec.formPage}`);
  const counties = extractFortressCounties(formHtml);
  if (!counties.length) {
    throw new Error(`wa_dshs_no_counties: ${spec.formPage} offered no county checkboxes`);
  }
  const csv = await httpPost(`${FORTRESS_BASE}/${spec.resultsPage}`, buildFortressCsvFormBody(counties));
  const body = String(csv ?? '');
  if (!body.includes('LicenseNumber')) {
    throw new Error(`wa_dshs_not_csv: ${spec.resultsPage} did not answer with the directory CSV (first bytes: ${body.slice(0, 80).replace(/\s+/g, ' ')})`);
  }
  return body;
}

// Columns the directory normalizer depends on. The two classes'
// files differ slightly (AFH carries 'Disclosure of Services',
// ALF carries 'Check_Type'); both differences are tolerated —
// a missing optional column normalizes to ''.
export const WA_DSHS_REQUIRED_COLUMNS = Object.freeze([
  'LicenseNumber',
  'FacilityName',
  'FacilityStatus',
  'LocationAddress',
  'LocationCity',
  'LocationZipCode',
  'LocationCounty',
]);

export function normalizeWaDshsDirectoryRow(licenseClass, record, { retrievedAt } = {}) {
  const spec = waDshsClassSpec(licenseClass);
  const licenseNumber = text(record.LicenseNumber);
  const city = text(record.LocationCity);
  const zip = text(record.LocationZipCode);
  return {
    signal_type: spec.signalType,
    timestamp: toIsoTimestamp(retrievedAt),
    spacetime: {
      region: WA_DSHS_JURISDICTION_ID,
      jurisdiction: WA_DSHS_JURISDICTION_ID,
      city,
      state: text(record.LocationState) || 'WA',
      zip,
    },
    provenance: {
      channel: 'wa_dshs_rcs',
      source_system: 'wa_dshs_fortress_lookup',
      confidence: 1.0,
      source_url: `${FORTRESS_BASE}/${spec.formPage}`,
    },
    payload: {
      external_id: `wa_dshs_${spec.licenseClass}_directory_${licenseNumber}`,
      canonical_entity_id: waDshsEntityId(licenseClass, licenseNumber),
      license_class: spec.licenseClass,
      license_number: licenseNumber,
      location_number: text(record.LocationNumber),
      facility_instance_id: text(record.FacInstanceId),
      facility_type: text(record.FacilityType),
      facility_name: text(record.FacilityName),
      facility_status: text(record.FacilityStatus),
      location_address: text(record.LocationAddress),
      location_city: city,
      location_state: text(record.LocationState),
      location_zip: zip,
      location_county: text(record.LocationCounty),
      mail_address: text(record.MailAddress),
      mail_city: text(record.MailCity),
      mail_state: text(record.MailState),
      mail_zip: text(record.MailZipCode),
      telephone: text(record.TelephoneNmbr),
      fax: text(record.FaxNmbr),
      rcs_region_unit: text(record.RCSRegionUnit),
      speciality: text(record.Speciality),
      speciality_code: text(record.SpecialityCode),
      contract: text(record.contract),
      contract_code: text(record.ContractCode),
      facility_poc: text(record.FacilityPOC),
      licensed_bed_count: asNumber(record.LicensedBedCount),
      license_expiration_date: text(record.LicenseExpirationDate),
      // ISO form only when the source value actually parses —
      // an unparseable expiration stays null (unknown), never a
      // fabricated "now" from a lenient timestamp helper.
      license_expiration_at: (() => {
        const raw = text(record.LicenseExpirationDate);
        if (!raw) return null;
        const parsed = new Date(raw);
        return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
      })(),
      memory_certified: asBool(record.MemoryCertFlag),
      disclosure_of_services_url: text(record['Disclosure of Services']),
      has_reports: asBool(record['Has Reports?']),
      reports_location_url: text(record['Reports Location']),
      raw: record,
    },
  };
}
