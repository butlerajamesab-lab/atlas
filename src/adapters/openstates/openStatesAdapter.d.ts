/**
 * Luminari Ingest Engine — Open States Adapter
 * Fetches state legislative bills from the Open States v3 API.
 *
 * Base URL : https://v3.openstates.org
 * Auth     : X-API-KEY header (env: OPEN_STATES_API_KEY)
 * Endpoint : GET /bills?jurisdiction={jurisdiction}&page={page}&per_page=20
 */
import { SupabaseClient } from '@supabase/supabase-js';
import { IngestResult } from '../types';
export interface OpenStatesPagination {
    per_page: number;
    page: number;
    max_page: number;
    total_items: number;
}
export interface OpenStatesBillResponse {
    results: any[];
    pagination: OpenStatesPagination;
}
/**
 * Fetches one page of bills for the given jurisdiction.
 */
export declare function fetchStatutes(jurisdiction: string, apiKey: string, session?: string, page?: number): Promise<{
    bills: any[];
    pagination: OpenStatesPagination;
}>;
/**
 * Maps an Open States bill object to the `statutes` table schema.
 */
export declare function normalizeToStatute(bill: any, jurisdiction: string, ingestJobId: string): Record<string, unknown>;
/**
 * Runs a full ingest job for WA statutes via Open States.
 *
 * Workflow per bill:
 *  1. computeHash → writeRawRecord (dedup)
 *  2. normalizeToStatute → upsert into `statutes` keyed on (jurisdiction, citation)
 *  3. If hash changed, insert a `statute_versions` row closing the previous version
 */
export declare function runIngestOpenStatesWA(supabase: SupabaseClient, apiKey: string): Promise<IngestResult>;
//# sourceMappingURL=openStatesAdapter.d.ts.map