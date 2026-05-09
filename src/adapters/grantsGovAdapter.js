"use strict";
/**
 * Luminari Ingest Engine — Grants.gov Adapter
 * Fetches federal grant opportunities from the Grants.gov API v1.
 *
 * Base URL  : https://api.grants.gov/v1/api
 * Auth      : None required for public search
 * Endpoints :
 *   POST /search2          — paginated keyword search
 *   POST /fetchOpportunity — single opportunity detail by number
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchOpportunities = searchOpportunities;
exports.fetchOpportunityDetail = fetchOpportunityDetail;
exports.normalizeToGrant = normalizeToGrant;
exports.runIngestGrantsGov = runIngestGrantsGov;
const axios_1 = __importDefault(require("axios"));
const hash_1 = require("../utils/hash");
const rawWriter_1 = require("../utils/rawWriter");
const ingestLogger_1 = require("../utils/ingestLogger");
const BASE_URL = 'https://api.grants.gov/v1/api';
const RAW_TABLE = 'raw_records';
const GRANT_TABLE = 'grant_opportunities';
const DEFAULT_ROWS = 25;
// ─── API Client Factory ───────────────────────────────────────────────────────
function buildClient() {
    return axios_1.default.create({
        baseURL: BASE_URL,
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
        },
        timeout: 30000,
    });
}
// ─── API Calls ────────────────────────────────────────────────────────────────
/**
 * Searches grant opportunities with an optional keyword.
 * Uses the search2 endpoint which supports richer filtering.
 */
async function searchOpportunities(keyword = '', startRecord = 1, rows = DEFAULT_ROWS) {
    const client = buildClient();
    const body = {
        keyword,
        rows,
        startRecord,
        oppStatuses: 'posted',
    };
    const response = await client.post('/search2', body);
    return {
        oppHits: response.data.oppHits ?? [],
        hitCount: response.data.hitCount ?? 0,
    };
}
/**
 * Fetches full detail for a single opportunity by its opportunity number.
 */
async function fetchOpportunityDetail(opportunityNumber) {
    const client = buildClient();
    const body = { opportunityNumber };
    const response = await client.post('/fetchOpportunity', body);
    return response.data.opportunity ?? response.data ?? {};
}
// ─── Normalizer ───────────────────────────────────────────────────────────────
/**
 * Maps a Grants.gov opportunity object to the `grant_opportunities` table schema.
 */
function normalizeToGrant(opp, ingestJobId) {
    // Parse monetary values safely
    const parseAmount = (val) => {
        if (val === null || val === undefined || val === '')
            return null;
        const n = Number(val);
        return isNaN(n) ? null : n;
    };
    // Parse date strings
    const parseDate = (val) => {
        if (!val)
            return null;
        const s = String(val);
        // Grants.gov dates can be MM/DD/YYYY or YYYY-MM-DD
        if (s.includes('/')) {
            const parts = s.split('/');
            if (parts.length === 3) {
                return `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
            }
        }
        return s.length >= 10 ? s.substring(0, 10) : null;
    };
    const oppNumber = opp.oppNumber ?? opp.opportunityNumber ?? '';
    const sourceUrl = oppNumber
        ? `https://www.grants.gov/search-results-detail/${oppNumber}`
        : '';
    return {
        opportunity_number: oppNumber,
        opportunity_id: String(opp.id ?? opp.opportunityId ?? ''),
        title: opp.title ?? opp.opportunityTitle ?? '',
        agency_code: opp.agencyCode ?? opp.owningAgencyCode ?? '',
        agency_name: opp.agencyName ?? opp.agencyContactName ?? '',
        cfda_number: opp.cfdaNumber ?? opp.cfdaList ?? '',
        opportunity_category: opp.oppCategory ?? opp.opportunityCategory ?? '',
        funding_instrument_type: opp.fundingInstrumentType ?? '',
        eligible_applicants: opp.eligibleApplicants ?? '',
        synopsis: (opp.synopsis ?? opp.description ?? '').substring(0, 10000),
        award_floor: parseAmount(opp.awardFloor),
        award_ceiling: parseAmount(opp.awardCeiling),
        expected_number_of_awards: parseAmount(opp.expectedNumberOfAwards),
        estimated_total_funding: parseAmount(opp.estimatedTotalProgramFunding),
        open_date: parseDate(opp.openDate ?? opp.postDate),
        close_date: parseDate(opp.closeDate ?? opp.archiveDate),
        status: opp.oppStatus ?? opp.opportunityStatus ?? 'posted',
        source_url: sourceUrl,
        source_system: 'grants_gov',
        ingest_job_id: ingestJobId,
        updated_at: new Date().toISOString(),
    };
}
// ─── Full Ingest Job ──────────────────────────────────────────────────────────
/**
 * Runs a full Grants.gov ingest with an optional keyword filter.
 *
 * Workflow:
 *  1. Paginate through search2 results
 *  2. For each opportunity hit: computeHash → writeRawRecord → fetchDetail → normalizeToGrant → upsert
 */
async function runIngestGrantsGov(supabase, keyword = '') {
    const jobId = await (0, ingestLogger_1.createIngestJob)(supabase, `Grants.gov Opportunities${keyword ? ` [${keyword}]` : ''}`, 'grants_gov', 'grants', 'federal', { keyword, rows: DEFAULT_ROWS });
    const result = {
        jobId,
        recordsFetched: 0,
        recordsUpserted: 0,
        recordsSkipped: 0,
        errors: [],
    };
    try {
        let startRecord = 1;
        let totalHits = Infinity;
        while (startRecord <= totalHits) {
            let oppHits;
            let hitCount;
            try {
                const searchResult = await searchOpportunities(keyword, startRecord, DEFAULT_ROWS);
                oppHits = searchResult.oppHits;
                hitCount = searchResult.hitCount;
                totalHits = hitCount;
            }
            catch (fetchErr) {
                const msg = `Grants.gov search error (startRecord=${startRecord}): ${fetchErr.message}`;
                result.errors.push(msg);
                console.error(msg);
                break;
            }
            if (oppHits.length === 0)
                break;
            result.recordsFetched += oppHits.length;
            for (const opp of oppHits) {
                try {
                    // Compute hash on the summary record first
                    const summaryHash = (0, hash_1.computeHash)(opp);
                    const rawRecord = {
                        sourceSystem: 'grants_gov',
                        jurisdiction: 'federal',
                        payloadJson: opp,
                        payloadHash: summaryHash,
                        fetchedAt: new Date().toISOString(),
                        sourceUrl: opp.oppNumber
                            ? `https://www.grants.gov/search-results-detail/${opp.oppNumber}`
                            : '',
                        ingestJobId: jobId,
                    };
                    const { isNew } = await (0, rawWriter_1.writeRawRecord)(supabase, RAW_TABLE, rawRecord);
                    if (!isNew) {
                        result.recordsSkipped++;
                        continue;
                    }
                    // Fetch detail for richer data
                    let detail = opp;
                    const oppNumber = opp.oppNumber ?? opp.opportunityNumber;
                    if (oppNumber) {
                        try {
                            detail = await fetchOpportunityDetail(oppNumber);
                        }
                        catch (detailErr) {
                            // Use summary if detail fails
                            result.errors.push(`Detail fetch for ${oppNumber} failed: ${detailErr.message}`);
                        }
                    }
                    const normalized = normalizeToGrant(detail, jobId);
                    const { error: upsertErr } = await supabase
                        .from(GRANT_TABLE)
                        .upsert([{ ...normalized, payload_hash: summaryHash }], {
                        onConflict: 'opportunity_number',
                        ignoreDuplicates: false,
                    });
                    if (upsertErr)
                        throw new Error(upsertErr.message);
                    result.recordsUpserted++;
                }
                catch (oppErr) {
                    const msg = `Opportunity ${opp.oppNumber ?? 'unknown'} error: ${oppErr.message}`;
                    result.errors.push(msg);
                    console.error(msg);
                }
            }
            startRecord += DEFAULT_ROWS;
        }
        const status = result.errors.length === 0
            ? 'completed'
            : result.recordsUpserted > 0
                ? 'partial'
                : 'failed';
        await (0, ingestLogger_1.finalizeIngestJob)(supabase, jobId, result, status);
    }
    catch (err) {
        result.errors.push(`Fatal: ${err.message}`);
        await (0, ingestLogger_1.finalizeIngestJob)(supabase, jobId, result, 'failed');
    }
    return result;
}
//# sourceMappingURL=grantsGovAdapter.js.map