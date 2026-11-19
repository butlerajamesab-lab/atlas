import axios from 'axios';
import dotenv from 'dotenv';
import { postSignalsToAtlas, toIsoTimestamp } from './ingestClient.js';
dotenv.config();

// EPA ECHO replacement (2026-11-01): the ECHO REST two-step retrieval
// (facility search, then results-by-QID) is broken service-side and
// the previous adapter never performed step 2 at all, so every run
// "completed" with zero events. This adapter reads the same ICIS-NPDES
// data from EPA's DMAP-EF GraphQL service instead
// (https://data.epa.gov/dmapservice/query, public, no key).
//
// Data model (EPA Envirofacts ICIS data model,
// https://enviro.epa.gov/envirofacts/metadata/model/icis):
//   icis_permit.external_permit_nmbr  NPDES permit numbers are state-prefixed
//   icis_npdes_violation              one row per recorded NPDES violation,
//                                     keyed by permit_activity_id
//   icis_xref_activity_facility_int   activity_id <-> icis_facility_interest_id
//   icis_facility_interest            facility identity/location; facility_uin
//                                     is the FRS registry identifier (ICIS data
//                                     element dictionary: "the number assigned
//                                     by the Facility Linkage Application")
//   icis_xref_activity_program        activity programs; Clean Water Act
//                                     program codes begin with "CWA"
//   icis_enf_conclusion               fed_penalty_assessed_amt per enforcement
//                                     conclusion activity
//   icis_comp_monitor + icis_activity compliance monitoring (inspection)
//                                     activities and their dates
//
// DMAP's GraphQL *joins* timed out live (two probes, 100s and 240s), so the
// fetch below uses single-table queries with IN filters and joins client-side.

export const DMAP_QUERY_URL = 'https://data.epa.gov/dmapservice/query';
const DMAP_TIMEOUT_MS = 180_000;
const PERMIT_PAGE_SIZE = 250;
const MAX_PERMIT_PAGES = 8; // per-run scan cap: 2,000 permits, surfaced in logs
const IN_LIST_CHUNK = 250;

// SNC derivation (documented approximation, NOT ECHO's official QNCR
// determination): a violation counts toward significant noncompliance when
// its RNC detection code is a chronic / TRC / enforcement-order type
// (icis.ref_rnc_detection: CHR C/H/Z, TRC T/R/V/U/X/Y, ENF A/P) and its RNC
// resolution code still says unresolved (icis.ref_rnc_resolution: '1' and
// 'A' are the two "NC - Unresolved" codes; all others are RE/RP resolved).
export const SNC_DETECTION_CODES = ['C', 'H', 'Z', 'T', 'R', 'V', 'U', 'X', 'Y', 'A', 'P'];
export const SNC_UNRESOLVED_RESOLUTION_CODES = ['1', 'A'];

function assertStateCode(state) {
  const normalized = String(state || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) {
    throw new Error(`epa_dmap_invalid_state state=${JSON.stringify(state)} (expected a 2-letter state code)`);
  }
  return normalized;
}

function inList(ids) {
  return ids.map((id) => Number(id)).join(',');
}

function chunk(values, size) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

export function buildPermitsQuery(state, { limit = PERMIT_PAGE_SIZE, offset = 0 } = {}) {
  const st = assertStateCode(state);
  return `query atlasEpaPermits { icis__icis_permit(limit: ${limit}, offset: ${offset}, where: {external_permit_nmbr: {beginsWith: "${st}"}}) { activity_id external_permit_nmbr } }`;
}

export function buildViolationSummaryQuery(permitActivityIds) {
  return `query atlasEpaViolations { icis__icis_npdes_violation(where: {permit_activity_id: {in: [${inList(permitActivityIds)}]}}, groupBy: ["permit_activity_id"]) { permit_activity_id fn__count(parameters: ["npdes_violation_id"], alias: "violation_count") fn__max(parameters: ["single_event_violation_date"], alias: "last_violation_date") fn__max(parameters: ["rnc_detection_date"], alias: "last_detection_date") } }`;
}

export function buildSncQuery(permitActivityIds) {
  const detection = SNC_DETECTION_CODES.map((c) => `"${c}"`).join(', ');
  const resolution = SNC_UNRESOLVED_RESOLUTION_CODES.map((c) => `"${c}"`).join(', ');
  return `query atlasEpaSnc { icis__icis_npdes_violation(where: {permit_activity_id: {in: [${inList(permitActivityIds)}]}, rnc_detection_code: {in: [${detection}]}, rnc_resolution_code: {in: [${resolution}]}}, groupBy: ["permit_activity_id"]) { permit_activity_id fn__count(parameters: ["npdes_violation_id"], alias: "snc_open_count") } }`;
}

export function buildXrefByActivityQuery(activityIds) {
  return `query atlasEpaXrefByActivity { icis__xref_activity_facility_int(limit: 10000, where: {activity_id: {in: [${inList(activityIds)}]}}) { activity_id icis_facility_interest_id } }`;
}

export function buildXrefByFacilityQuery(facilityInterestIds) {
  return `query atlasEpaXrefByFacility { icis__xref_activity_facility_int(limit: 10000, where: {icis_facility_interest_id: {in: [${inList(facilityInterestIds)}]}}) { activity_id icis_facility_interest_id } }`;
}

export function buildFacilitiesQuery(facilityInterestIds) {
  return `query atlasEpaFacilities { icis__icis_facility_interest(where: {icis_facility_interest_id: {in: [${inList(facilityInterestIds)}]}}) { icis_facility_interest_id facility_name city state_code facility_uin geocode_latitude geocode_longitude } }`;
}

export function buildCwaProgramsQuery(activityIds) {
  return `query atlasEpaPrograms { icis__xref_activity_program(limit: 10000, where: {activity_id: {in: [${inList(activityIds)}]}, program_code: {beginsWith: "CWA"}}) { activity_id program_code } }`;
}

export function buildEnfConclusionQuery(activityIds) {
  return `query atlasEpaPenalties { icis__icis_enf_conclusion(where: {activity_id: {in: [${inList(activityIds)}]}}) { activity_id fed_penalty_assessed_amt } }`;
}

export function buildCompMonitorQuery(activityIds) {
  return `query atlasEpaCompMonitor { icis__icis_comp_monitor(limit: 10000, where: {activity_id: {in: [${inList(activityIds)}]}}) { activity_id } }`;
}

export function buildActivityDatesQuery(activityIds) {
  return `query atlasEpaActivityDates { icis__icis_activity(where: {activity_id: {in: [${inList(activityIds)}]}}) { activity_id actual_begin_date actual_end_date } }`;
}

// Default transport: POST one GraphQL query to DMAP and return payload.data.
// Every failure is LOUD (thrown with the upstream detail) — the failure mode
// this repair exists to kill is the old adapter's silent zero.
export async function dmapGraphql(query, { httpPost = axios.post } = {}) {
  let response;
  try {
    response = await httpPost(DMAP_QUERY_URL, { query }, {
      timeout: DMAP_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    });
  } catch (error) {
    const status = error?.response?.status ?? null;
    const body = error?.response?.data;
    const detail = typeof body === 'string' ? body : (body?.error || body?.message || error?.message || String(error));
    const wrapped = new Error(
      `epa_dmap_request_failed${status ? ` status=${status}` : ''} detail=${String(detail).slice(0, 700)}`,
    );
    wrapped.status = status;
    wrapped.cause = error;
    throw wrapped;
  }
  const payload = response?.data;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`epa_dmap_unexpected_payload detail=${JSON.stringify(payload)?.slice(0, 300) ?? String(payload)}`);
  }
  if (payload.errors || payload.error) {
    throw new Error(`epa_dmap_query_failed detail=${JSON.stringify(payload.errors || payload.error).slice(0, 700)}`);
  }
  if (!payload.data || typeof payload.data !== 'object') {
    throw new Error(`epa_dmap_unexpected_payload detail=${JSON.stringify(payload).slice(0, 300)}`);
  }
  return payload.data;
}

function tableRows(data, table) {
  const rows = data?.[table];
  if (!Array.isArray(rows)) {
    throw new Error(`epa_dmap_unexpected_shape table=${table} detail=${JSON.stringify(data)?.slice(0, 300) ?? String(data)}`);
  }
  return rows;
}

async function queryTable(dmapQuery, query, table) {
  return tableRows(await dmapQuery(query), table);
}

// Map one aggregated DMAP facility (identity + violation/penalty/inspection
// rollups) into the ECHO-shaped record normalizeViolation has always read.
// Field-by-field provenance is in EPA-DMAP-PREP-2026-11-01.md.
export function mapDmapFacilityToEchoRecord(facility) {
  return {
    FacName: facility.facility_name || 'Unknown Facility',
    RegistryID: facility.facility_uin || '',
    FacState: facility.state_code || '',
    FacCity: facility.city || '',
    FacLat: facility.geocode_latitude,
    FacLong: facility.geocode_longitude,
    CWAVioCount: facility.violation_count ?? 0,
    FedPenalty: facility.federal_penalty ?? 0,
    CWALastInspDate: facility.last_inspection_date || null,
    // Every record here is reached through an ICIS-NPDES permit, so the
    // program area is the Clean Water Act by construction.
    ObjectiveName: 'Clean Water Act',
    CWASNCFlag: facility.snc_open_count > 0 ? 'Y' : 'N',
    lastViolationDate: facility.last_violation_date || null,
    npdesPermitNumbers: facility.npdes_permit_numbers || [],
    dmapFacilityInterestId: facility.icis_facility_interest_id ?? null,
  };
}

export function normalizeViolation(facility) {
  const name = facility.FacName || facility.facility_name || 'Unknown Facility';
  const registryId = facility.RegistryID || facility.registry_id || '';
  const state = facility.FacState || facility.state || '';
  const city = facility.FacCity || facility.city || '';
  const lat = parseFloat(facility.FacLat || facility.latitude) || null;
  const lng = parseFloat(facility.FacLong || facility.longitude) || null;
  const violationCount = parseInt(facility.CWAVioCount || facility.violations || 0);
  const penaltyAmount = parseFloat(facility.FedPenalty || facility.penalty || 0);
  const lastInspection = facility.CWALastInspDate || facility.last_inspection || null;
  const programAreas = facility.ObjectiveName || facility.program || '';

  const isRepeatOffender = violationCount > 3;
  const signalType = isRepeatOffender ? 'repeat_environmental_violator' : 'environmental_violation';

  return {
    signal_type: signalType,
    timestamp: toIsoTimestamp(lastInspection, facility.lastViolationDate),
    spacetime: {
      region: state ? `us_state_${state}` : 'us_federal',
      jurisdiction: state ? `us_state_${state}` : 'us_federal',
      city,
      state,
      latitude: lat,
      longitude: lng,
    },
    provenance: {
      channel: 'epa_echo',
      source_system: 'epa_echo_enforcement',
      confidence: 1.0,
      source_url: `https://echo.epa.gov/detailed-facility-report?fid=${registryId}`,
    },
    payload: {
      external_id: `epa_${registryId}`,
      registry_id: registryId,
      facility_name: name,
      city,
      state,
      latitude: lat,
      longitude: lng,
      violation_count: violationCount,
      federal_penalty: penaltyAmount,
      last_inspection: lastInspection,
      program_areas: programAreas,
      is_repeat_offender: isRepeatOffender,
      in_significant_noncompliance: facility.CWASNCFlag === 'Y' || facility.snc === true,
      last_violation_date: facility.lastViolationDate || null,
      npdes_permit_numbers: facility.npdesPermitNumbers || [],
      dmap_facility_interest_id: facility.dmapFacilityInterestId ?? null,
    },
  };
}

function maxDate(values) {
  const valid = values.filter((v) => typeof v === 'string' && v.length > 0).sort();
  return valid.length ? valid[valid.length - 1] : null;
}

export async function fetchViolators({ state = 'WA', minViolations = 1, limit = 100, dmapQuery = dmapGraphql } = {}) {
  const stateCode = assertStateCode(state);

  // 1) Page the state's NPDES permits and roll up violations per permit
  //    until enough violating permits are found (or the scan cap is hit).
  const permitStats = new Map(); // activity_id -> {count, lastViolationDate, sncOpen}
  const permitNumbers = new Map(); // activity_id -> external_permit_nmbr
  for (let page = 0; page < MAX_PERMIT_PAGES; page += 1) {
    const permits = await queryTable(
      dmapQuery,
      buildPermitsQuery(stateCode, { limit: PERMIT_PAGE_SIZE, offset: page * PERMIT_PAGE_SIZE }),
      'icis__icis_permit',
    );
    if (!permits.length) break;
    const permitIds = permits.map((p) => p.activity_id);
    for (const p of permits) permitNumbers.set(p.activity_id, p.external_permit_nmbr);

    for (const idChunk of chunk(permitIds, IN_LIST_CHUNK)) {
      const summaries = await queryTable(dmapQuery, buildViolationSummaryQuery(idChunk), 'icis__icis_npdes_violation');
      for (const row of summaries) {
        const count = Number(row.violation_count) || 0;
        if (count < minViolations) continue;
        permitStats.set(row.permit_activity_id, {
          count,
          lastViolationDate: maxDate([row.last_violation_date, row.last_detection_date]),
          sncOpen: 0,
        });
      }
      const sncRows = await queryTable(dmapQuery, buildSncQuery(idChunk), 'icis__icis_npdes_violation');
      for (const row of sncRows) {
        const existing = permitStats.get(row.permit_activity_id);
        if (existing) existing.sncOpen = Number(row.snc_open_count) || 0;
      }
    }
    if (permitStats.size >= limit * 2) break; // enough candidates; facilities dedupe below
  }
  if (!permitStats.size) return [];

  // 2) Permits -> facilities via the activity/facility cross-reference.
  const violatingPermitIds = [...permitStats.keys()];
  const facilityIdByPermit = new Map();
  for (const idChunk of chunk(violatingPermitIds, IN_LIST_CHUNK)) {
    const xref = await queryTable(dmapQuery, buildXrefByActivityQuery(idChunk), 'icis__xref_activity_facility_int');
    for (const row of xref) facilityIdByPermit.set(row.activity_id, row.icis_facility_interest_id);
  }

  // 3) Aggregate permits up to facilities.
  const facilities = new Map(); // facility_interest_id -> aggregate
  for (const [permitId, stats] of permitStats) {
    const facilityId = facilityIdByPermit.get(permitId);
    if (facilityId === undefined) continue; // permit with no ICIS facility link: cannot place it, skip loudly below
    if (!facilities.has(facilityId)) {
      facilities.set(facilityId, {
        icis_facility_interest_id: facilityId,
        violation_count: 0,
        last_violation_date: null,
        snc_open_count: 0,
        npdes_permit_numbers: [],
        federal_penalty: 0,
        last_inspection_date: null,
      });
    }
    const agg = facilities.get(facilityId);
    agg.violation_count += stats.count;
    agg.last_violation_date = maxDate([agg.last_violation_date, stats.lastViolationDate]);
    agg.snc_open_count += stats.sncOpen;
    if (permitNumbers.get(permitId)) agg.npdes_permit_numbers.push(permitNumbers.get(permitId));
  }
  const unlinkedPermits = violatingPermitIds.length - facilityIdByPermit.size;
  if (unlinkedPermits > 0) {
    console.warn(`EPA DMAP: ${unlinkedPermits} violating permits had no ICIS facility link and were skipped`);
  }

  // 4) Strongest facilities first, capped at the requested limit.
  const selected = [...facilities.values()]
    .sort((a, b) => b.violation_count - a.violation_count)
    .slice(0, limit);
  if (!selected.length) return [];
  const selectedIds = selected.map((f) => f.icis_facility_interest_id);

  // 5) Facility identity/location rows.
  for (const idChunk of chunk(selectedIds, IN_LIST_CHUNK)) {
    const rows = await queryTable(dmapQuery, buildFacilitiesQuery(idChunk), 'icis__icis_facility_interest');
    const byId = new Map(rows.map((r) => [r.icis_facility_interest_id, r]));
    for (const agg of selected) {
      const identity = byId.get(agg.icis_facility_interest_id);
      if (identity) Object.assign(agg, identity);
    }
  }

  // 6) Enrichment: federal penalties + last inspection, restricted to each
  //    facility's Clean Water Act activities so air/other-program actions
  //    at the same site never leak into a CWA record.
  const activityIdsByFacility = new Map(selectedIds.map((id) => [id, []]));
  for (const idChunk of chunk(selectedIds, IN_LIST_CHUNK)) {
    const xref = await queryTable(dmapQuery, buildXrefByFacilityQuery(idChunk), 'icis__xref_activity_facility_int');
    for (const row of xref) {
      const list = activityIdsByFacility.get(row.icis_facility_interest_id);
      if (list) list.push(row.activity_id);
    }
  }
  const allActivityIds = [...new Set([...activityIdsByFacility.values()].flat())];
  const cwaActivityIds = new Set();
  for (const idChunk of chunk(allActivityIds, IN_LIST_CHUNK)) {
    if (!idChunk.length) continue;
    const programs = await queryTable(dmapQuery, buildCwaProgramsQuery(idChunk), 'icis__xref_activity_program');
    for (const row of programs) cwaActivityIds.add(row.activity_id);
  }
  // Each CWA activity may belong to multiple facilities; preserve every association.
  const facilityIdsByActivity = new Map();
  for (const [facilityId, ids] of activityIdsByFacility) {
    for (const id of ids) {
      if (!cwaActivityIds.has(id)) continue;
      if (!facilityIdsByActivity.has(id)) facilityIdsByActivity.set(id, new Set());
      facilityIdsByActivity.get(id).add(facilityId);
    }
  }
  const cwaIds = [...facilityIdsByActivity.keys()];
  const aggById = new Map(selected.map((f) => [f.icis_facility_interest_id, f]));
  for (const idChunk of chunk(cwaIds, IN_LIST_CHUNK)) {
    if (!idChunk.length) continue;
    const conclusions = await queryTable(dmapQuery, buildEnfConclusionQuery(idChunk), 'icis__icis_enf_conclusion');
    for (const row of conclusions) {
      for (const facilityId of facilityIdsByActivity.get(row.activity_id) || []) {
        const agg = aggById.get(facilityId);
        if (agg) agg.federal_penalty += Number(row.fed_penalty_assessed_amt) || 0;
      }
    }
    const monitors = await queryTable(dmapQuery, buildCompMonitorQuery(idChunk), 'icis__icis_comp_monitor');
    const monitorIds = [...new Set(monitors.map((m) => m.activity_id))];
    for (const monitorChunk of chunk(monitorIds, IN_LIST_CHUNK)) {
      if (!monitorChunk.length) continue;
      const activities = await queryTable(dmapQuery, buildActivityDatesQuery(monitorChunk), 'icis__icis_activity');
      for (const activity of activities) {
        for (const facilityId of facilityIdsByActivity.get(activity.activity_id) || []) {
          const agg = aggById.get(facilityId);
          if (agg) agg.last_inspection_date = maxDate([agg.last_inspection_date, activity.actual_end_date, activity.actual_begin_date]);
        }
      }
    }
  }

  return selected.map((facility) => normalizeViolation(mapDmapFacilityToEchoRecord(facility)));
}

export async function ingestEpaSignals({ state = 'WA', apiBaseUrl } = {}) {
  const signals = await fetchViolators({ state });
  if (!signals.length) {
    return { accepted: true, ingested_count: 0, note: 'No EPA violations returned' };
  }
  return postSignalsToAtlas({
    sourceId: 'epa_echo',
    jurisdictionId: `us_state_${state}`,
    moduleHint: 'environmental_enforcement',
    signals,
    apiBaseUrl,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const state = process.argv[2] || 'WA';
  console.log(`Fetching EPA violations for ${state} via DMAP-EF (ICIS-NPDES)...`);
  const result = await ingestEpaSignals({ state });
  console.log(JSON.stringify({ ok: true, source: 'epa_echo', state, result }, null, 2));
}
