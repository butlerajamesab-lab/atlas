"use strict";
/**
 * Luminari Ingest Engine — ProPublica Nonprofit Explorer Adapter
 * Fetches nonprofit organizations and IRS 990 filings.
 *
 * Base URL  : https://projects.propublica.org/nonprofits/api/v2
 * Auth      : None required
 * Endpoints :
 *   GET /search.json?q={query}&state[id]={state}&page={page}
 *   GET /organizations/{ein}.json
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchNonprofits = searchNonprofits;
exports.fetchOrgDetail = fetchOrgDetail;
exports.normalizeToNonprofit = normalizeToNonprofit;
exports.normalizeToFiling = normalizeToFiling;
exports.runIngestProPublica = runIngestProPublica;
const axios_1 = __importDefault(require("axios"));
const hash_1 = require("../utils/hash");
const rawWriter_1 = require("../utils/rawWriter");
const ingestLogger_1 = require("../utils/ingestLogger");
const BASE_URL = 'https://projects.propublica.org/nonprofits/api/v2';
const RAW_TABLE = 'raw_records';
const NONPROFIT_TABLE = 'nonprofit_orgs';
const FILING_TABLE = 'nonprofit_filings';
// ─── API Client Factory ───────────────────────────────────────────────────────
function buildClient() {
    return axios_1.default.create({
        baseURL: BASE_URL,
        headers: { Accept: 'application/json' },
        timeout: 30000,
    });
}
// ─── API Calls ────────────────────────────────────────────────────────────────
/**
 * Searches nonprofits by state with optional keyword query.
 */
async function searchNonprofits(state, page = 0, query = '') {
    const client = buildClient();
    const params = {
        'state[id]': state.toUpperCase(),
        page,
    };
    if (query) {
        params['q'] = query;
    }
    const response = await client.get('/search.json', { params });
    return {
        organizations: response.data.organizations ?? [],
        num_pages: response.data.num_pages ?? 1,
    };
}
/**
 * Fetches full organization detail and all 990 filings for the given EIN.
 */
async function fetchOrgDetail(ein) {
    const client = buildClient();
    // Normalize EIN: remove dashes
    const cleanEin = ein.replace(/-/g, '');
    const response = await client.get(`/organizations/${cleanEin}.json`);
    return {
        organization: response.data.organization ?? {},
        filings_with_data: response.data.filings_with_data ?? [],
    };
}
// ─── Normalizers ─────────────────────────────────────────────────────────────
/**
 * Maps a ProPublica org object to the `nonprofit_orgs` table schema.
 */
function normalizeToNonprofit(org, ingestJobId) {
    // Normalize EIN to XX-XXXXXXX format
    const rawEin = String(org.ein ?? '').replace(/-/g, '');
    const ein = rawEin.length === 9
        ? `${rawEin.substring(0, 2)}-${rawEin.substring(2)}`
        : rawEin;
    return {
        ein,
        name: org.name ?? org.strein ?? '',
        ntee_code: org.ntee_code ?? '',
        subsection_code: org.subsection_code ?? '',
        classification_codes: org.classification_codes ?? '',
        city: org.city ?? '',
        state: org.state ?? '',
        zipcode: org.zipcode ?? '',
        income_amount: org.income_amount ?? null,
        revenue_amount: org.revenue_amount ?? null,
        asset_amount: org.asset_amount ?? null,
        filing_requirement: org.filing_requirement ?? '',
        pf_filing_requirement: org.pf_filing_requirement ?? '',
        accounting_period: org.accounting_period ?? '',
        deductibility: org.deductibility ?? null,
        foundation: org.foundation ?? null,
        organization_type: org.organization ?? '',
        ruling_date: org.ruling_date ?? null,
        exempt_status: org.exempt_status ?? '',
        source_url: `https://projects.propublica.org/nonprofits/organizations/${String(org.ein ?? '').replace(/-/g, '')}`,
        source_system: 'propublica',
        ingest_job_id: ingestJobId,
        updated_at: new Date().toISOString(),
    };
}
/**
 * Maps a ProPublica 990 filing to the `nonprofit_filings` table schema.
 */
function normalizeToFiling(filing, nonprofitId, ingestJobId) {
    return {
        nonprofit_id: nonprofitId,
        tax_period: filing.tax_period ?? '',
        payer_name: filing.payer_name ?? '',
        form_type: filing.formtype ?? filing.form_type ?? '',
        sub_id: String(filing.sub_id ?? ''),
        updated: filing.updated ?? null,
        totrevenue: filing.totrevenue ?? null,
        totfuncexpns: filing.totfuncexpns ?? null,
        totassetsend: filing.totassetsend ?? null,
        totliabend: filing.totliabend ?? null,
        totnetassetsend: filing.totnetassetsend ?? null,
        compnsatncurrofcr: filing.compnsatncurrofcr ?? null,
        noncontrirevnue: filing.noncontrirevnue ?? null,
        profndraising: filing.profndraising ?? null,
        investmntinc: filing.investmntinc ?? null,
        grsrcptsrelated170: filing.grsrcptsrelated170 ?? null,
        totcntrbgfts: filing.totcntrbgfts ?? null,
        pdf_url: filing.pdf_url ?? '',
        source_system: 'propublica',
        ingest_job_id: ingestJobId,
        updated_at: new Date().toISOString(),
    };
}
// ─── Full Ingest Job ──────────────────────────────────────────────────────────
/**
 * Runs a full ProPublica ingest for all nonprofits in the given state.
 *
 * Workflow:
 *  1. Search for all orgs in the state (paginated)
 *  2. For each org: fetch detail → computeHash → writeRawRecord → upsert nonprofit
 *  3. For each filing: computeHash → writeRawRecord → upsert filing
 */
async function runIngestProPublica(supabase, state) {
    const jobId = await (0, ingestLogger_1.createIngestJob)(supabase, `ProPublica Nonprofits ${state.toUpperCase()}`, 'propublica', 'nonprofits', state.toLowerCase(), { state });
    const result = {
        jobId,
        recordsFetched: 0,
        recordsUpserted: 0,
        recordsSkipped: 0,
        errors: [],
    };
    try {
        let page = 0;
        let maxPages = 1;
        // Iterate search pages
        do {
            let orgs;
            try {
                const searchResult = await searchNonprofits(state, page);
                orgs = searchResult.organizations;
                maxPages = searchResult.num_pages;
            }
            catch (searchErr) {
                const msg = `Search page ${page} error: ${searchErr.message}`;
                result.errors.push(msg);
                console.error(msg);
                break;
            }
            if (orgs.length === 0)
                break;
            for (const orgSummary of orgs) {
                try {
                    result.recordsFetched++;
                    const ein = String(orgSummary.ein ?? '').replace(/-/g, '');
                    if (!ein) {
                        result.recordsSkipped++;
                        continue;
                    }
                    // Fetch full detail
                    let orgDetail;
                    let filings = [];
                    try {
                        const detail = await fetchOrgDetail(ein);
                        orgDetail = detail.organization;
                        filings = detail.filings_with_data;
                    }
                    catch (detailErr) {
                        // Fall back to summary if detail fetch fails
                        orgDetail = orgSummary;
                        result.errors.push(`EIN ${ein} detail fetch failed: ${detailErr.message}`);
                    }
                    const orgHash = (0, hash_1.computeHash)(orgDetail);
                    const orgRawRecord = {
                        sourceSystem: 'propublica',
                        jurisdiction: state.toLowerCase(),
                        payloadJson: orgDetail,
                        payloadHash: orgHash,
                        fetchedAt: new Date().toISOString(),
                        sourceUrl: `https://projects.propublica.org/nonprofits/organizations/${ein}`,
                        ingestJobId: jobId,
                    };
                    const { isNew: isOrgNew } = await (0, rawWriter_1.writeRawRecord)(supabase, RAW_TABLE, orgRawRecord);
                    if (!isOrgNew) {
                        result.recordsSkipped++;
                        continue;
                    }
                    const normalizedOrg = normalizeToNonprofit(orgDetail, jobId);
                    // Upsert nonprofit keyed on EIN
                    const { data: upsertedOrg, error: orgUpsertErr } = await supabase
                        .from(NONPROFIT_TABLE)
                        .upsert([{ ...normalizedOrg, payload_hash: orgHash }], {
                        onConflict: 'ein',
                        ignoreDuplicates: false,
                    })
                        .select('id')
                        .single();
                    if (orgUpsertErr)
                        throw new Error(orgUpsertErr.message);
                    result.recordsUpserted++;
                    const nonprofitId = upsertedOrg.id;
                    // Ingest each filing
                    for (const filing of filings) {
                        try {
                            const filingHash = (0, hash_1.computeHash)(filing);
                            const filingRaw = {
                                sourceSystem: 'propublica',
                                jurisdiction: state.toLowerCase(),
                                payloadJson: filing,
                                payloadHash: filingHash,
                                fetchedAt: new Date().toISOString(),
                                sourceUrl: filing.pdf_url ?? '',
                                ingestJobId: jobId,
                            };
                            const { isNew: isFilingNew } = await (0, rawWriter_1.writeRawRecord)(supabase, RAW_TABLE, filingRaw);
                            if (!isFilingNew)
                                continue;
                            const normalizedFiling = normalizeToFiling(filing, nonprofitId, jobId);
                            await supabase
                                .from(FILING_TABLE)
                                .upsert([{ ...normalizedFiling, payload_hash: filingHash }], {
                                onConflict: 'nonprofit_id,tax_period,form_type',
                                ignoreDuplicates: false,
                            });
                            result.recordsUpserted++;
                            result.recordsFetched++;
                        }
                        catch (filingErr) {
                            result.errors.push(`Filing ${filing.sub_id ?? 'unknown'} error: ${filingErr.message}`);
                        }
                    }
                }
                catch (orgErr) {
                    const msg = `Org ${orgSummary.ein ?? 'unknown'} error: ${orgErr.message}`;
                    result.errors.push(msg);
                    console.error(msg);
                }
            }
            page++;
        } while (page < maxPages);
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
//# sourceMappingURL=proPublicaAdapter.js.map