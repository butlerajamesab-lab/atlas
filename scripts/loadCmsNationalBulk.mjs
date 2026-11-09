// Bulk loader for the CMS nursing-home NATIONAL streams
// (Alexander's direction 2026-11-08/09: whole country, layered —
// bulk artifacts first, governed ingest second).
//
// Why bulk (the physics, measured 2026-11-08): the governed ingest
// answers per-signal work synchronously and posts time out at the
// client's default batch on wide rows; the state-legged API draw
// works but means ~1,900 paged fetches and ~632k sequential posts
// for the country. CMS publishes the same datasets as flat release
// files — one CSV per dataset per monthly release (NH_Health-
// Citations_Oct2026.csv: 165 MB, 418,682 rows). This loader:
//
//   Layer 0 — downloads the release files and SHA-256-stamps them;
//             the whole national draw traces to four artifacts.
//   Layer 1 — streams each file through a header map into the SAME
//             record shape the API path produces, runs the SAME
//             normalizers, and posts through the SAME governed
//             ingest door (same resolver, dedupe, receipts) under
//             the national tuple (cms_nh / us_federal), with a
//             small pool of concurrent batch posters.
//   Layers 2–3 are untouched: reservoir, then derivation.
//
// Washington rows are SKIPPED: WA lives in the us_state_WA family
// and the whole country is the union of the two families with zero
// double-count. Rows are flushed in state blocks (the files are
// CCN-ordered); a state that reappears after its block flushed is
// held as a straggler and flushed at the end, so the loader is
// correct even if a future release file is not state-sorted.
// A failed state is logged and the run continues; re-run with
// --states to close failures out (dedupe absorbs overlap).
//
// Execution: one-off Render jobs in the Atlas service's own
// environment (ATLAS_INGEST_TOKEN lives there; the CMS files are
// public). Posts go to the service's public URL (ATLAS_PUBLIC_URL,
// defaulting to the Atlas custom domain). Inert in the deployed
// service: nothing imports it; only an explicit job runs it.
//
// Usage:
//   node scripts/loadCmsNationalBulk.mjs [--dataset providers|
//        health|fire|penalties|all] [--states CA,TX]
//        [--concurrency 4] [--keep-files]
//

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pipeline } from 'node:stream/promises';

import axios from 'axios';

import {
  CMS_DATASETS,
  NATIONAL_JURISDICTION_ID,
  normalizeCmsFireSafetyDeficiency,
  normalizeCmsHealthDeficiency,
  normalizeCmsPenalty,
  normalizeCmsProvider,
} from '../src/adapters/cmsNursingHomeAdapter.js';
import { postSignalsToAtlas } from '../src/adapters/ingestClient.js';

const METASTORE_BASE = 'https://data.cms.gov/provider-data/api/1/metastore/schemas/dataset/items';

export const BULK_KINDS = Object.freeze({
  providers: { datasetId: CMS_DATASETS.provider_info, moduleHint: 'nursing_home_provider', normalize: normalizeCmsProvider },
  health: { datasetId: CMS_DATASETS.health_deficiencies, moduleHint: 'nursing_home_deficiency', normalize: normalizeCmsHealthDeficiency },
  fire: { datasetId: CMS_DATASETS.fire_safety_deficiencies, moduleHint: 'nursing_home_fire_safety', normalize: normalizeCmsFireSafetyDeficiency },
  penalties: { datasetId: CMS_DATASETS.penalties, moduleHint: 'nursing_home_penalty', normalize: normalizeCmsPenalty },
});

// CSV header -> API record field, per dataset kind. The release
// files use human-readable headers ("CMS Certification Number
// (CCN)"); the normalizers consume the API's field names. Every
// field a normalizer reads has an entry here — the contract tests
// pin that, and pin a bulk-mapped Kline Galland row to the same
// signal the API path produced for it.
const SHARED_HEADERS = {
  'CMS Certification Number (CCN)': 'cms_certification_number_ccn',
  'Provider Name': 'provider_name',
  'Provider Address': 'provider_address',
  'City/Town': 'citytown',
  'State': 'state',
  'ZIP Code': 'zip_code',
  'Processing Date': 'processing_date',
};

const DEFICIENCY_HEADERS = {
  ...SHARED_HEADERS,
  'Survey Date': 'survey_date',
  'Survey Footnote': 'survey_footnote',
  'Survey Type': 'survey_type',
  'Deficiency Prefix': 'deficiency_prefix',
  'Deficiency Category': 'deficiency_category',
  'Deficiency Tag Number': 'deficiency_tag_number',
  'Deficiency Description': 'deficiency_description',
  'Scope Severity Code': 'scope_severity_code',
  'Deficiency Corrected': 'deficiency_corrected',
  'Correction Date': 'correction_date',
  'Inspection Cycle': 'inspection_cycle',
  'Standard Deficiency': 'standard_deficiency',
  'Complaint Deficiency': 'complaint_deficiency',
  'Infection Control Inspection Deficiency': 'infection_control_inspection_deficiency',
  'Citation under IDR': 'citation_under_idr',
  'Citation under IIDR': 'citation_under_iidr',
  'Location': 'location',
};

export const BULK_HEADER_MAPS = Object.freeze({
  providers: {
    ...SHARED_HEADERS,
    'Legal Business Name': 'legal_business_name',
    'Latitude': 'latitude',
    'Longitude': 'longitude',
    'Ownership Type': 'ownership_type',
    'Number of Certified Beds': 'number_of_certified_beds',
    'Average Number of Residents per Day': 'average_number_of_residents_per_day',
    'Provider Type': 'provider_type',
    'Overall Rating': 'overall_rating',
    'Health Inspection Rating': 'health_inspection_rating',
    'Staffing Rating': 'staffing_rating',
    'QM Rating': 'qm_rating',
    'Reported Total Nurse Staffing Hours per Resident per Day': 'reported_total_nurse_staffing_hours_per_resident_per_day',
    'Total nursing staff turnover': 'total_nursing_staff_turnover',
    'Registered Nurse turnover': 'registered_nurse_turnover',
    'Number of Fines': 'number_of_fines',
    'Total Amount of Fines in Dollars': 'total_amount_of_fines_in_dollars',
    'Number of Payment Denials': 'number_of_payment_denials',
    'Total Number of Penalties': 'total_number_of_penalties',
    'Abuse Icon': 'abuse_icon',
    'Special Focus Status': 'special_focus_status',
    'Most Recent Health Inspection More Than 2 Years Ago': 'most_recent_health_inspection_more_than_2_years_ago',
    'Rating Cycle 1 Standard Survey Health Date': 'rating_cycle_1_standard_survey_health_date',
    'Rating Cycle 1 Total Number of Health Deficiencies': 'rating_cycle_1_total_number_of_health_deficiencies',
    'Rating Cycle 1 Total Health Score': 'rating_cycle_1_total_health_score',
    'Total Weighted Health Survey Score': 'total_weighted_health_survey_score',
  },
  health: DEFICIENCY_HEADERS,
  fire: { ...DEFICIENCY_HEADERS },
  penalties: {
    ...SHARED_HEADERS,
    'Penalty Date': 'penalty_date',
    'Penalty Type': 'penalty_type',
    'Fine ID': 'fine_id',
    'Fine Amount': 'fine_amount',
    'Payment Denial Start Date': 'payment_denial_start_date',
    'Payment Denial Length in Days': 'payment_denial_length_in_days',
    'Location': 'location',
  },
});

// Minimal RFC 4180 CSV parser as an async generator over text
// chunks: quoted fields, embedded commas/quotes/newlines, CRLF.
// Yields arrays of string fields, header row first.
export async function* parseCsvRows(chunks) {
  let field = '';
  let row = [];
  let inQuotes = false;
  let fieldQuoted = false;
  let pendingQuote = false;
  let started = false;
  const emitField = () => { row.push(field); field = ''; fieldQuoted = false; };
  function* emitRow() { emitField(); yield row; row = []; started = false; }
  for await (const chunk of chunks) {
    const textChunk = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    for (let i = 0; i < textChunk.length; i += 1) {
      const ch = textChunk[i];
      if (pendingQuote) {
        pendingQuote = false;
        if (ch === '"') { field += '"'; continue; }
        inQuotes = false;
        // fall through: ch is a delimiter or newline
      }
      if (inQuotes) {
        if (ch === '"') pendingQuote = true;
        else field += ch;
        continue;
      }
      if (ch === '"' && field === '' && !fieldQuoted) { inQuotes = true; fieldQuoted = true; started = true; continue; }
      if (ch === ',') { emitField(); started = true; continue; }
      if (ch === '\n') { yield* emitRow(); continue; }
      if (ch === '\r') continue;
      field += ch;
      started = true;
    }
  }
  if (pendingQuote) inQuotes = false;
  if (inQuotes) throw new Error('cms_bulk_csv_unterminated_quote: the file ended inside a quoted field');
  if (started || field !== '' || row.length) yield* emitRow();
}

// Map one parsed CSV data row to the API record shape. Fails
// loudly when a header the kind requires is absent from the file.
export function mapBulkRow(kind, headers, values) {
  const map = BULK_HEADER_MAPS[kind];
  if (!map) throw new Error(`cms_bulk_unknown_kind: ${kind}`);
  const record = {};
  headers.forEach((header, index) => {
    const fieldName = map[header];
    if (fieldName) record[fieldName] = values[index] ?? '';
  });
  return record;
}

export function requiredHeadersPresent(kind, headers) {
  const map = BULK_HEADER_MAPS[kind];
  const present = new Set(headers);
  // A normalizer input is "required" if the map carries it; the
  // file must carry every mapped header for its kind. (The fire
  // file has no Survey Footnote column, so that header is simply
  // not in the file's set — the map entry is optional there and
  // the normalizer defaults it to ''.)
  const optional = new Set(['survey_footnote']);
  return Object.entries(map)
    .filter(([, fieldName]) => !optional.has(fieldName))
    .filter(([header]) => !(kind === 'fire' && header === 'Survey Footnote'))
    .every(([header]) => present.has(header));
}

async function resolveDownloadUrl(datasetId) {
  const { data } = await axios.get(`${METASTORE_BASE}/${datasetId}?show-reference-ids=false`, { timeout: 60000 });
  const dist = (data?.distribution ?? []).map((d) => d?.data ?? d).find((d) => d?.downloadURL);
  if (!dist?.downloadURL) throw new Error(`cms_bulk_no_download_url: metastore item ${datasetId} carries no distribution downloadURL`);
  return dist.downloadURL;
}

async function downloadWithHash(url, destPath) {
  const hash = createHash('sha256');
  let bytes = 0;
  const response = await axios.get(url, { responseType: 'stream', timeout: 120000 });
  response.data.on('data', (chunk) => { hash.update(chunk); bytes += chunk.length; });
  await pipeline(response.data, createWriteStream(destPath));
  return { bytes, sha256: hash.digest('hex') };
}

// Bounded retry for transient ingest failures. The governed door
// intermittently answers a batch with a Cloudflare 500/520 while
// sibling batches succeed (seen in the WA first load and again on
// the first national leg: 78 of 104 rows landed, one slice's first
// batch 500'd). Re-posting is safe — dedupe absorbs any partial
// progress inside the slice — so a slice retries whole, with
// backoff, before it is allowed to fail. A deterministic failure
// (a poisoned record) still fails after the attempts, unchanged.
export async function withRetry(fn, { attempts = 5, baseDelayMs = 2000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(Math.min(30000, baseDelayMs * 2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

async function postSlice(moduleHint, signals, apiBaseUrl) {
  if (!signals.length) return { ingested_count: 0, replayed_count: 0, records_failed: 0 };
  const result = await withRetry(() => postSignalsToAtlas({
    sourceId: 'cms_nh',
    jurisdictionId: NATIONAL_JURISDICTION_ID,
    moduleHint,
    signals,
    apiBaseUrl,
    batchSize: 25,
  }));
  return {
    ingested_count: result.ingested_count ?? 0,
    replayed_count: result.replayed_count ?? 0,
    records_failed: result.records_failed ?? 0,
  };
}

// Post one state's signals with a small worker pool: the signals
// are cut into `concurrency` disjoint slices and each slice posts
// sequentially through the governed door. Same door, same
// receipts — just more than one queue at it. Slices settle
// independently: one slice's failure never masks the others'
// receipts; it is counted as failed rows and reported.
export async function postStateSignals({ moduleHint, signals, apiBaseUrl, concurrency = 4, post = postSlice }) {
  const totals = { ingested_count: 0, replayed_count: 0, records_failed: 0, slices_failed: 0 };
  if (!signals.length) return totals;
  const workers = Math.max(1, Math.min(concurrency, signals.length));
  const slices = Array.from({ length: workers }, () => []);
  signals.forEach((signal, index) => slices[index % workers].push(signal));
  const settled = await Promise.allSettled(slices.map((slice) => post(moduleHint, slice, apiBaseUrl)));
  settled.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') {
      totals.ingested_count += outcome.value.ingested_count ?? 0;
      totals.replayed_count += outcome.value.replayed_count ?? 0;
      totals.records_failed += outcome.value.records_failed ?? 0;
    } else {
      totals.slices_failed += 1;
      totals.records_failed += slices[index].length;
    }
  });
  return totals;
}

export async function loadBulkKind(kind, { apiBaseUrl, states = null, concurrency = 4, log = console.log, filePath = null, download = downloadWithHash, resolveUrl = resolveDownloadUrl } = {}) {
  const spec = BULK_KINDS[kind];
  if (!spec) throw new Error(`cms_bulk_unknown_kind: ${kind}`);
  const url = filePath ? null : await resolveUrl(spec.datasetId);
  const dest = filePath ?? join(tmpdir(), `cms-bulk-${kind}.csv`);
  const artifact = filePath
    ? { bytes: null, sha256: null, note: 'local file supplied; not hash-stamped' }
    : await download(url, dest);
  log(`[cms-bulk] ${kind}: ${url ?? dest} bytes=${artifact.bytes} sha256=${artifact.sha256 ?? 'n/a'}`);

  const perState = new Map();
  const flushed = new Set();
  const stragglers = new Map();
  let rowsTotal = 0;
  let waSkipped = 0;
  let stateFiltered = 0;
  const failures = [];

  const flush = async (state, signals) => {
    if (!signals.length) return;
    try {
      const totals = await postStateSignals({ moduleHint: spec.moduleHint, signals, apiBaseUrl, concurrency });
      const prior = perState.get(state) ?? { rows: 0, ingested_count: 0, replayed_count: 0, records_failed: 0 };
      perState.set(state, {
        rows: prior.rows + signals.length,
        ingested_count: prior.ingested_count + totals.ingested_count,
        replayed_count: prior.replayed_count + totals.replayed_count,
        records_failed: prior.records_failed + totals.records_failed,
      });
      log(`[cms-bulk] ${kind} ${state}: ${signals.length} rows -> ingested=${totals.ingested_count} replayed=${totals.replayed_count} failed=${totals.records_failed}`);
      if (totals.slices_failed > 0) {
        failures.push({ state, partial: true, slices_failed: totals.slices_failed, error: `${totals.slices_failed} slice(s) exhausted retries; ${totals.records_failed} rows unlanded — re-run --states ${state}` });
      }
    } catch (error) {
      failures.push({ state, error: String(error?.message ?? error).slice(0, 300) });
      log(`[cms-bulk] ${kind} ${state} FAILED: ${String(error?.message ?? error).slice(0, 300)}`);
    }
    flushed.add(state);
  };

  let headers = null;
  let currentState = null;
  let currentBlock = [];
  const stream = createReadStream(dest, { encoding: 'utf8', highWaterMark: 1 << 20 });
  for await (const values of parseCsvRows(stream)) {
    if (!headers) {
      headers = values;
      if (!requiredHeadersPresent(kind, headers)) {
        throw new Error(`cms_bulk_header_mismatch: ${kind} file headers do not cover the required map (got: ${headers.slice(0, 6).join(' | ')}...)`);
      }
      continue;
    }
    if (values.length === 1 && values[0] === '') continue; // trailing blank line
    rowsTotal += 1;
    const record = mapBulkRow(kind, headers, values);
    const state = (record.state ?? '').trim();
    if (state === 'WA') { waSkipped += 1; continue; }
    if (states && !states.includes(state)) { stateFiltered += 1; continue; }
    const signal = spec.normalize(record);
    if (state !== currentState) {
      if (currentBlock.length) await flush(currentState, currentBlock);
      currentState = state;
      currentBlock = [];
    }
    if (flushed.has(state)) {
      // The state already flushed once and reappeared later in the
      // file (unsorted input): hold the row as a straggler.
      if (!stragglers.has(state)) stragglers.set(state, []);
      stragglers.get(state).push(signal);
    } else {
      currentBlock.push(signal);
    }
  }
  if (currentBlock.length) await flush(currentState, currentBlock);
  for (const [state, signals] of stragglers) {
    if (signals.length) await flush(state, signals);
  }

  const totals = { ingested_count: 0, replayed_count: 0, records_failed: 0, rows_posted: 0 };
  for (const entry of perState.values()) {
    totals.ingested_count += entry.ingested_count;
    totals.replayed_count += entry.replayed_count;
    totals.records_failed += entry.records_failed;
    totals.rows_posted += entry.rows;
  }
  return {
    kind,
    dataset: spec.datasetId,
    source_url: url ?? dest,
    artifact,
    rows_total: rowsTotal,
    wa_skipped: waSkipped,
    state_filtered: stateFiltered,
    states: Object.fromEntries(perState),
    totals,
    failures,
  };
}

export function parseBulkArgs(argv) {
  const args = { datasets: ['providers', 'health', 'fire', 'penalties'], states: null, concurrency: 4 };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--dataset' && value) {
      args.datasets = value === 'all' ? ['providers', 'health', 'fire', 'penalties'] : [value];
      for (const d of args.datasets) if (!BULK_KINDS[d]) throw new Error(`cms_bulk_unknown_dataset: ${d}`);
      i += 1;
    } else if (flag === '--states' && value) {
      args.states = value.split(',').map((v) => v.trim().toUpperCase()).filter(Boolean);
      if (args.states.includes('WA')) throw new Error('cms_bulk_wa_excluded: WA lives in the us_state_WA family and is never loaded into the national streams');
      i += 1;
    } else if (flag === '--concurrency' && value) {
      args.concurrency = Math.max(1, Math.min(16, parseInt(value, 10) || 4));
      i += 1;
    } else if (flag.startsWith('--')) {
      throw new Error(`cms_bulk_unknown_flag: ${flag}`);
    }
  }
  return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseBulkArgs(process.argv.slice(2));
  const apiBaseUrl = process.env.ATLAS_PUBLIC_URL || 'https://atlas.columbiacitycustomllc.com';
  const summaries = [];
  for (const kind of args.datasets) {
    summaries.push(await loadBulkKind(kind, { apiBaseUrl, states: args.states, concurrency: args.concurrency }));
  }
  const failed = summaries.flatMap((s) => s.failures.map((f) => ({ kind: s.kind, ...f })));
  console.log(JSON.stringify({ ok: failed.length === 0, source: 'cms_nh', family: 'national-bulk', summaries, failures: failed }, null, 2));
  if (failed.length) process.exitCode = 1;
}
