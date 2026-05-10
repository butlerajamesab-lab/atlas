"use strict";
/**
 * Luminari Ingest Engine — Open States Adapter
 * Fetches state legislative bills from the Open States v3 API.
 *
 * Base URL : https://v3.openstates.org
 * Auth     : X-API-KEY header (env: OPEN_STATES_API_KEY)
 * Endpoint : GET /bills?jurisdiction={jurisdiction}&page={page}&per_page=20
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchStatutes = fetchStatutes;
exports.normalizeToStatute = normalizeToStatute;
exports.runIngestOpenStatesWA = runIngestOpenStatesWA;
const axios_1 = __importDefault(require("axios"));
const hash_1 = require("../utils/hash");
const rawWriter_1 = require("../utils/rawWriter");
const ingestLogger_1 = require("../utils/ingestLogger");
const BASE_URL = 'https://v3.openstates.org';
const RAW_TABLE = 'raw_records';
const STATUTE_TABLE = 'statutes';
const PER_PAGE = 20;
// ─── API Client Factory ───────────────────────────────────────────────────────
function buildClient(apiKey) {
    return axios_1.default.create({
        baseURL: BASE_URL,
        headers: {
            'X-API-KEY': apiKey,
            'Accept': 'application/json',
        },
        timeout: 30000,
    });
}
// ─── API Calls ────────────────────────────────────────────────────────────────
/**
 * Fetches one page of bills for the given jurisdiction.
 */
async function fetchStatutes(jurisdiction, apiKey, session, page = 1) {
    const client = buildClient(apiKey);
    const params = {
        jurisdiction,
        page,
        per_page: PER_PAGE,
        include: ['abstracts', 'versions'],
    };
    if (session) {
        params['session'] = session;
    }
    const response = await client.get('/bills', { params });
    const data = response.data;
    return {
        bills: data.results ?? [],
        pagination: data.pagination ?? { per_page: PER_PAGE, page, max_page: 1, total_items: 0 },
    };
}
// ─── Normalizer ───────────────────────────────────────────────────────────────
/**
 * Derives a code family from a jurisdiction abbreviation.
 * WA → RCW, OR → ORS, etc.
 */
function deriveCodeFamily(jurisdiction) {
    const map = {
        wa: 'RCW',
        or: 'ORS',
        ca: 'Cal. Code',
        tx: 'Tex. Code',
        ny: 'N.Y. Laws',
        fl: 'Fla. Stat.',
        il: 'ILCS',
        pa: 'Pa. Cons. Stat.',
        oh: 'Ohio Rev. Code',
        mi: 'MCLA',
    };
    return map[jurisdiction.toLowerCase()] ?? jurisdiction.toUpperCase();
}
/**
 * Parses a bill identifier like "HB 1234" into chapter/section components.
 */
function parseIdentifier(identifier) {
    const match = identifier.match(/^([A-Z]+)\s*(\d+)/i);
    if (match) {
        return { chapter: match[1].toUpperCase(), section: match[2] };
    }
    return { chapter: '', section: identifier };
}
/**
 * Maps an Open States bill object to the `statutes` table schema.
 */
function normalizeToStatute(bill, jurisdiction, ingestJobId) {
    const { chapter, section } = parseIdentifier(bill.identifier ?? '');
    const codeFamily = deriveCodeFamily(jurisdiction);
    // Build a citation: e.g. RCW HB 1234
    const citation = `${codeFamily} ${bill.identifier ?? ''}`.trim();
    // Extract abstract text
    const abstracts = bill.abstracts ?? [];
    const currentText = abstracts.length > 0 && abstracts[0].abstract
        ? abstracts[0].abstract
        : '';
    // Derive effective_date from session_identifier (format: "2023-2024" → "2023-01-01")
    const sessionId = bill.session_identifier ?? bill.legislative_session ?? '';
    const yearMatch = sessionId.match(/^(\d{4})/);
    const effectiveDate = yearMatch ? `${yearMatch[1]}-01-01` : null;
    return {
        jurisdiction: jurisdiction.toLowerCase(),
        code_family: codeFamily,
        chapter_number: chapter,
        section_number: section,
        citation,
        heading: bill.title ?? '',
        current_text: currentText,
        effective_date: effectiveDate,
        source_url: bill.openstates_url ?? '',
        source_system: 'openstates',
        ingest_job_id: ingestJobId,
        raw_payload: bill,
        updated_at: new Date().toISOString(),
    };
}
// ─── Full WA Ingest Job ───────────────────────────────────────────────────────
/**
 * Runs a full ingest job for WA statutes via Open States.
 *
 * Workflow per bill:
 *  1. computeHash → writeRawRecord (dedup)
 *  2. normalizeToStatute → upsert into `statutes` keyed on (jurisdiction, citation)
 *  3. If hash changed, insert a `statute_versions` row closing the previous version
 */
async function runIngestOpenStatesWA(supabase, apiKey) {
    const jurisdiction = 'wa';
    const jobId = await (0, ingestLogger_1.createIngestJob)(supabase, 'OpenStates WA Statutes', 'openstates', 'statutes', jurisdiction, { jurisdiction, perPage: PER_PAGE });
    const result = {
        jobId,
        recordsFetched: 0,
        recordsUpserted: 0,
        recordsSkipped: 0,
        errors: [],
    };
    try {
        let page = 1;
        let maxPage = 1;
        do {
            let bills;
            let pagination;
            try {
                const response = await fetchStatutes(jurisdiction, apiKey, undefined, page);
                bills = response.bills;
                pagination = response.pagination;
                maxPage = pagination.max_page;
            }
            catch (fetchErr) {
                const msg = `Page ${page} fetch error: ${fetchErr.message}`;
                result.errors.push(msg);
                console.error(msg);
                break;
            }
            result.recordsFetched += bills.length;
            for (const bill of bills) {
                try {
                    const hash = (0, hash_1.computeHash)(bill);
                    const rawRecord = {
                        sourceSystem: 'openstates',
                        jurisdiction,
                        payloadJson: bill,
                        payloadHash: hash,
                        fetchedAt: new Date().toISOString(),
                        sourceUrl: bill.openstates_url ?? '',
                        ingestJobId: jobId,
                    };
                    const { isNew } = await (0, rawWriter_1.writeRawRecord)(supabase, RAW_TABLE, rawRecord);
                    if (!isNew) {
                        result.recordsSkipped++;
                        continue;
                    }
                    const normalized = normalizeToStatute(bill, jurisdiction, jobId);
                    // Check for existing statute row to detect hash changes
                    const { data: existing } = await supabase
                        .from(STATUTE_TABLE)
                        .select('id, payload_hash, current_text')
                        .eq('jurisdiction', jurisdiction)
                        .eq('citation', normalized.citation)
                        .maybeSingle();
                    if (existing) {
                        const existingRow = existing;
                        // If hash changed, snapshot the old version
                        if (existingRow.payload_hash && existingRow.payload_hash !== hash) {
                            await supabase.from('statute_versions').insert([{
                                    statute_id: existingRow.id,
                                    text_snapshot: existingRow.current_text ?? '',
                                    hash_snapshot: existingRow.payload_hash,
                                    superseded_at: new Date().toISOString(),
                                    ingest_job_id: jobId,
                                }]);
                        }
                        // Update existing statute
                        await supabase
                            .from(STATUTE_TABLE)
                            .update({ ...normalized, payload_hash: hash })
                            .eq('id', existingRow.id);
                    }
                    else {
                        // Insert new statute
                        await supabase.from(STATUTE_TABLE).insert([{ ...normalized, payload_hash: hash }]);
                    }
                    result.recordsUpserted++;
                }
                catch (billErr) {
                    const msg = `Bill ${bill.identifier ?? 'unknown'} error: ${billErr.message}`;
                    result.errors.push(msg);
                    console.error(msg);
                }
            }
            page++;
        } while (page <= maxPage);
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
//# sourceMappingURL=openStatesAdapter.js.map