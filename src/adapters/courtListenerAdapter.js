"use strict";
/**
 * Luminari Ingest Engine — CourtListener Adapter
 * Fetches case law opinions from the CourtListener REST API v3.
 *
 * Base URL   : https://www.courtlistener.com/api/rest/v3
 * Auth       : Authorization: Token {COURT_LISTENER_TOKEN}
 * Rate limit : 5000/hour (authenticated)
 * Endpoints  :
 *   GET /opinions/?cluster__docket__court__jurisdiction={jurisdiction}&format=json&page={page}
 *   GET /clusters/?docket__court__jurisdiction={jurisdiction}&page={page}
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchOpinions = fetchOpinions;
exports.fetchClusters = fetchClusters;
exports.normalizeToCase = normalizeToCase;
exports.runIngestCourtListener = runIngestCourtListener;
const axios_1 = __importDefault(require("axios"));
const hash_1 = require("../utils/hash");
const rawWriter_1 = require("../utils/rawWriter");
const ingestLogger_1 = require("../utils/ingestLogger");
const BASE_URL = 'https://www.courtlistener.com/api/rest/v3';
const RAW_TABLE = 'raw_records';
const CASE_LAW_TABLE = 'case_law';
const PAGE_SIZE = 20;
// ─── API Client Factory ───────────────────────────────────────────────────────
function buildClient(token) {
    return axios_1.default.create({
        baseURL: BASE_URL,
        headers: {
            Authorization: `Token ${token}`,
            Accept: 'application/json',
        },
        timeout: 30000,
    });
}
// ─── API Calls ────────────────────────────────────────────────────────────────
/**
 * Fetches one page of opinions for the given court jurisdiction.
 *
 * CourtListener uses state postal abbreviations for jurisdiction:
 *   e.g. 'wa' → Washington state courts
 *        'f'  → Federal courts
 */
async function fetchOpinions(jurisdiction, token, page = 1) {
    const client = buildClient(token);
    const params = {
        cluster__docket__court__jurisdiction: jurisdiction,
        format: 'json',
        page,
        page_size: PAGE_SIZE,
    };
    const response = await client.get('/opinions/', { params });
    return {
        results: response.data.results ?? [],
        next: response.data.next ?? null,
    };
}
/**
 * Fetches opinion clusters (groups related opinions by case).
 */
async function fetchClusters(jurisdiction, token, page = 1) {
    const client = buildClient(token);
    const params = {
        docket__court__jurisdiction: jurisdiction,
        format: 'json',
        page,
        page_size: PAGE_SIZE,
    };
    const response = await client.get('/clusters/', { params });
    return {
        results: response.data.results ?? [],
        next: response.data.next ?? null,
    };
}
// ─── Normalizer ───────────────────────────────────────────────────────────────
/**
 * Maps a CourtListener opinion object to the `case_law` table schema.
 */
function normalizeToCase(opinion, jurisdiction, ingestJobId) {
    // Extract cluster info if embedded
    const cluster = opinion.cluster_id ?? opinion.cluster ?? null;
    // Parse dates
    const dateFiled = opinion.date_created
        ? opinion.date_created.substring(0, 10)
        : null;
    // Build a citation string from the absolute_url
    const sourceUrl = opinion.absolute_url
        ? `https://www.courtlistener.com${opinion.absolute_url}`
        : opinion.download_url ?? '';
    // Extract plain text (try multiple fields)
    const opinionText = opinion.plain_text ??
        opinion.html_with_citations ??
        opinion.html ??
        opinion.html_lawbox ??
        '';
    return {
        jurisdiction: jurisdiction.toLowerCase(),
        case_name: opinion.case_name ?? opinion.caseName ?? '',
        court: opinion.court_id ?? opinion.court ?? '',
        date_filed: dateFiled,
        citation: opinion.citation_string ?? opinion.citations ?? '',
        opinion_text: opinionText.substring(0, 50000), // guard extremely large text
        author_str: opinion.author_str ?? '',
        per_curiam: opinion.per_curiam ?? false,
        opinion_type: opinion.type ?? 'unknown',
        cluster_id: typeof cluster === 'string' ? cluster : String(cluster ?? ''),
        source_url: sourceUrl,
        source_system: 'courtlistener',
        ingest_job_id: ingestJobId,
        updated_at: new Date().toISOString(),
    };
}
// ─── Full Ingest Job ──────────────────────────────────────────────────────────
/**
 * Runs a full CourtListener ingest for the given jurisdiction.
 *
 * Workflow per opinion:
 *  1. computeHash → writeRawRecord (dedup)
 *  2. normalizeToCase → upsert into `case_law` keyed on (jurisdiction, source_url)
 */
async function runIngestCourtListener(supabase, token, jurisdiction) {
    const jobId = await (0, ingestLogger_1.createIngestJob)(supabase, `CourtListener ${jurisdiction.toUpperCase()} Case Law`, 'courtlistener', 'case_law', jurisdiction, { jurisdiction, pageSize: PAGE_SIZE });
    const result = {
        jobId,
        recordsFetched: 0,
        recordsUpserted: 0,
        recordsSkipped: 0,
        errors: [],
    };
    try {
        let page = 1;
        let hasMore = true;
        while (hasMore) {
            let opinions;
            let next;
            try {
                const response = await fetchOpinions(jurisdiction, token, page);
                opinions = response.results;
                next = response.next;
            }
            catch (fetchErr) {
                const msg = `CourtListener page ${page} fetch error: ${fetchErr.message}`;
                result.errors.push(msg);
                console.error(msg);
                break;
            }
            if (opinions.length === 0) {
                break;
            }
            result.recordsFetched += opinions.length;
            for (const opinion of opinions) {
                try {
                    const hash = (0, hash_1.computeHash)(opinion);
                    const rawRecord = {
                        sourceSystem: 'courtlistener',
                        jurisdiction,
                        payloadJson: opinion,
                        payloadHash: hash,
                        fetchedAt: new Date().toISOString(),
                        sourceUrl: opinion.absolute_url
                            ? `https://www.courtlistener.com${opinion.absolute_url}`
                            : '',
                        ingestJobId: jobId,
                    };
                    const { isNew } = await (0, rawWriter_1.writeRawRecord)(supabase, RAW_TABLE, rawRecord);
                    if (!isNew) {
                        result.recordsSkipped++;
                        continue;
                    }
                    const normalized = normalizeToCase(opinion, jurisdiction, jobId);
                    // Upsert on (jurisdiction, source_url)
                    const { error: upsertError } = await supabase
                        .from(CASE_LAW_TABLE)
                        .upsert([{ ...normalized, payload_hash: hash }], { onConflict: 'jurisdiction,source_url', ignoreDuplicates: false });
                    if (upsertError) {
                        throw new Error(upsertError.message);
                    }
                    result.recordsUpserted++;
                }
                catch (opErr) {
                    const msg = `Opinion ${opinion.id ?? 'unknown'} error: ${opErr.message}`;
                    result.errors.push(msg);
                    console.error(msg);
                }
            }
            hasMore = next !== null;
            page++;
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
//# sourceMappingURL=courtListenerAdapter.js.map