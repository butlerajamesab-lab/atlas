/**
 * Socrata Data Adapter — Session 80 Hardened
 * 
 * T1. Fetch rows from a Socrata API endpoint using $limit/$offset pagination.
 *     - Universal safe-fetch with timeout, retry, error classification
 *     - Captures HTTP status, content-type, body preview for diagnostics
 * T2. Normalize each row into a standard schema using dataset-specific field mappings.
 * T3. Upsert records into ingested_records (insert new, update changed).
 * T4. Return ingestion statistics + structured diagnostics for the run log.
 */

import { db } from "../db";
import { ingestedRecords, dataStreamRegistry, ingestRuns } from "../../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";
import crypto from "crypto";

// ─── Types ───

export interface SocrataDatasetConfig {
  datasetId: string;
  apiUrl: string;
  fieldMapping: Record<string, string>;
}

export interface NormalizedRecord {
  sourceRecordId: string;
  rawJson: Record<string, unknown>;
  normalizedDate: number | null;
  normalizedCategory: string | null;
  normalizedEntity: string | null;
  normalizedJurisdiction: string | null;
  normalizedCity: string | null;
  normalizedState: string | null;
  normalizedZip: string | null;
  normalizedStatus: string | null;
  normalizedAmount: string | null;
  normalizedDescription: string | null;
}

export interface IngestionResult {
  recordsProcessed: number;
  recordsInserted: number;
  recordsUpdated: number;
  signalsGenerated: number;
  errors: string[];
  runId: number;
  // Session 80: Structured diagnostics
  diagnostics: IngestionDiagnostics;
}

export interface IngestionDiagnostics {
  errorClassification: string | null;
  httpStatus: number | null;
  contentType: string | null;
  endpointAttempted: string | null;
  adapterUsed: string;
  bodyPreview: string | null;
  parseFailureReason: string | null;
  retryCount: number;
  failureClassification: string | null;
  suggestedRemediation: string | null;
  outcomeClassification: string;
}

// ─── Error Classification ───

export type ErrorClass =
  | "network_timeout"
  | "dns_failure"
  | "connection_refused"
  | "http_4xx"
  | "http_5xx"
  | "invalid_json"
  | "empty_response"
  | "rate_limited"
  | "auth_failure"
  | "schema_mismatch"
  | "data_too_large"
  | "unknown";

export function classifyError(err: unknown, httpStatus?: number, contentType?: string): ErrorClass {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();

  if (msg.includes("abort") || msg.includes("timeout")) return "network_timeout";
  if (msg.includes("enotfound") || msg.includes("dns")) return "dns_failure";
  if (msg.includes("econnrefused") || msg.includes("connection refused")) return "connection_refused";
  if (httpStatus === 429) return "rate_limited";
  if (httpStatus === 401 || httpStatus === 403) return "auth_failure";
  if (httpStatus && httpStatus >= 400 && httpStatus < 500) return "http_4xx";
  if (httpStatus && httpStatus >= 500) return "http_5xx";
  if (msg.includes("json") || msg.includes("unexpected token")) return "invalid_json";
  if (msg.includes("empty") || msg.includes("no data")) return "empty_response";
  if (msg.includes("too large") || msg.includes("payload")) return "data_too_large";
  return "unknown";
}

export function suggestRemediation(errorClass: ErrorClass): string {
  switch (errorClass) {
    case "network_timeout": return "Increase timeout or check if the API endpoint is responding slowly. Try again later.";
    case "dns_failure": return "Verify the API URL domain is correct. The service may be permanently moved.";
    case "connection_refused": return "The API server is refusing connections. It may be down for maintenance.";
    case "http_4xx": return "Check the API URL and query parameters. The request may be malformed.";
    case "http_5xx": return "The API server is experiencing internal errors. Retry later.";
    case "invalid_json": return "The API returned non-JSON content. Check if the endpoint URL is correct.";
    case "empty_response": return "The API returned an empty response. The dataset may have no new records.";
    case "rate_limited": return "API rate limit hit. Increase the interval between requests or reduce page size.";
    case "auth_failure": return "Authentication failed. Check if the API requires an app token.";
    case "schema_mismatch": return "The API response schema has changed. Update the field mapping.";
    case "data_too_large": return "Response payload too large. Reduce page size or add date filters.";
    default: return "Unknown error. Check the endpoint URL and API documentation.";
  }
}

// ─── T1. Safe Fetch with Structured Diagnostics ───

const PAGE_SIZE = 1000;
const MAX_PAGES = 300;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface SafeFetchResult {
  data: Record<string, unknown>[] | null;
  httpStatus: number | null;
  contentType: string | null;
  bodyPreview: string | null;
  errorClass: ErrorClass | null;
  errorMessage: string | null;
  retryCount: number;
}

/** Universal safe-fetch: never throws, always returns structured result */
export async function safeFetchSocrataPage(
  apiUrl: string,
  limit: number,
  offset: number,
  orderField?: string
): Promise<SafeFetchResult> {
  // Build URL with proper encoding — Socrata SoQL parameters
  const urlObj = new URL(apiUrl);
  urlObj.searchParams.set("$limit", String(limit));
  urlObj.searchParams.set("$offset", String(offset));
  if (orderField) {
    urlObj.searchParams.set("$order", `${orderField} ASC`);
  }
  const url = urlObj.toString();

  let lastError: Error | null = null;
  let httpStatus: number | null = null;
  let contentType: string | null = null;
  let bodyPreview: string | null = null;
  let retryCount = 0;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetchWithTimeout(
        url,
        { headers: { "Accept": "application/json" } },
        REQUEST_TIMEOUT_MS
      );

      httpStatus = response.status;
      contentType = response.headers.get("content-type");

      if (!response.ok) {
        // Capture body preview for diagnostics
        try {
          const text = await response.text();
          bodyPreview = text.substring(0, 500);
        } catch { /* ignore */ }

        const err = new Error(`Socrata API error: ${response.status} ${response.statusText} for ${url}`);
        lastError = err;
        retryCount = attempt;

        // Don't retry 4xx errors (except 429)
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          return {
            data: null, httpStatus, contentType, bodyPreview,
            errorClass: classifyError(err, httpStatus, contentType ?? undefined),
            errorMessage: err.message, retryCount,
          };
        }

        if (attempt < MAX_RETRIES) {
          const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
          console.warn(`[Socrata] Attempt ${attempt}/${MAX_RETRIES} failed (${response.status}). Retrying in ${backoff}ms...`);
          await sleep(backoff);
          continue;
        }

        return {
          data: null, httpStatus, contentType, bodyPreview,
          errorClass: classifyError(err, httpStatus, contentType ?? undefined),
          errorMessage: err.message, retryCount,
        };
      }

      // Parse JSON safely
      try {
        const data = await response.json() as Record<string, unknown>[];
        return {
          data, httpStatus, contentType, bodyPreview: null,
          errorClass: null, errorMessage: null, retryCount: attempt - 1,
        };
      } catch (parseErr) {
        // JSON parse failure
        try {
          bodyPreview = "(JSON parse failed)";
        } catch { /* ignore */ }
        return {
          data: null, httpStatus, contentType, bodyPreview,
          errorClass: "invalid_json",
          errorMessage: `JSON parse error: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
          retryCount: attempt,
        };
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      retryCount = attempt;

      if (attempt < MAX_RETRIES) {
        const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
        console.warn(`[Socrata] Attempt ${attempt}/${MAX_RETRIES} failed (${lastError.message}). Retrying in ${backoff}ms...`);
        await sleep(backoff);
      }
    }
  }

  return {
    data: null, httpStatus, contentType, bodyPreview,
    errorClass: classifyError(lastError, httpStatus ?? undefined, contentType ?? undefined),
    errorMessage: lastError?.message ?? "Unknown fetch error",
    retryCount,
  };
}

// Legacy wrapper for backward compatibility
export async function fetchSocrataPage(
  apiUrl: string,
  limit: number,
  offset: number
): Promise<Record<string, unknown>[]> {
  const result = await safeFetchSocrataPage(apiUrl, limit, offset);
  if (result.data) return result.data;
  throw new Error(result.errorMessage ?? "Fetch failed");
}

export interface FetchResult {
  records: Record<string, unknown>[];
  apiReachable: boolean;
  errorMessage: string | null;
  pagesCompleted: number;
  // Session 80: Diagnostics
  lastHttpStatus: number | null;
  lastContentType: string | null;
  lastBodyPreview: string | null;
  errorClass: ErrorClass | null;
  totalRetries: number;
}

export async function fetchAllSocrataRecords(
  apiUrl: string,
  onPage?: (pageNum: number, recordCount: number) => void,
  maxRecords?: number,
  orderField?: string
): Promise<FetchResult> {
  const allRecords: Record<string, unknown>[] = [];
  let offset = 0;
  let pageNum = 0;
  const effectiveMax = maxRecords ?? Infinity;
  let apiReachable = true;
  let errorMessage: string | null = null;
  let lastHttpStatus: number | null = null;
  let lastContentType: string | null = null;
  let lastBodyPreview: string | null = null;
  let errorClass: ErrorClass | null = null;
  let totalRetries = 0;

  while (pageNum < MAX_PAGES) {
    if (allRecords.length >= effectiveMax) break;

    const result = await safeFetchSocrataPage(apiUrl, PAGE_SIZE, offset, orderField);
    totalRetries += result.retryCount;
    lastHttpStatus = result.httpStatus;
    lastContentType = result.contentType;

    if (!result.data) {
      apiReachable = false;
      errorMessage = result.errorMessage;
      lastBodyPreview = result.bodyPreview;
      errorClass = result.errorClass;
      console.warn(`[Socrata] API unreachable after page ${pageNum}: ${errorMessage}`);
      break;
    }

    if (result.data.length === 0) break;
    allRecords.push(...result.data);
    onPage?.(pageNum + 1, allRecords.length);
    if (result.data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
    pageNum++;
  }

  const trimmed = maxRecords ? allRecords.slice(0, maxRecords) : allRecords;
  return {
    records: trimmed,
    apiReachable,
    errorMessage,
    pagesCompleted: pageNum,
    lastHttpStatus,
    lastContentType,
    lastBodyPreview,
    errorClass,
    totalRetries,
  };
}

// ─── T2. Normalize Records ───

export function normalizeRecord(
  raw: Record<string, unknown>,
  fieldMapping: Record<string, string>
): NormalizedRecord {
  const normalized: NormalizedRecord = {
    sourceRecordId: "",
    rawJson: raw,
    normalizedDate: null,
    normalizedCategory: null,
    normalizedEntity: null,
    normalizedJurisdiction: null,
    normalizedCity: null,
    normalizedState: null,
    normalizedZip: null,
    normalizedStatus: null,
    normalizedAmount: null,
    normalizedDescription: null,
  };

  for (const [sourceField, targetField] of Object.entries(fieldMapping)) {
    const value = raw[sourceField];
    if (value === undefined || value === null || value === "") continue;

    switch (targetField) {
      case "sourceRecordId":
        normalized.sourceRecordId = String(value);
        break;
      case "normalizedDate":
        normalized.normalizedDate = parseDate(value);
        break;
      case "normalizedCategory":
        normalized.normalizedCategory = String(value).trim().substring(0, 256);
        break;
      case "normalizedEntity":
        normalized.normalizedEntity = String(value).trim().substring(0, 512);
        break;
      case "normalizedJurisdiction":
        normalized.normalizedJurisdiction = String(value).trim().substring(0, 128);
        break;
      case "normalizedCity":
        normalized.normalizedCity = String(value).trim().substring(0, 128);
        break;
      case "normalizedState":
        normalized.normalizedState = String(value).trim().substring(0, 64);
        break;
      case "normalizedZip":
        normalized.normalizedZip = String(value).trim().substring(0, 16);
        break;
      case "normalizedStatus":
        normalized.normalizedStatus = String(value).trim().substring(0, 64);
        break;
      case "normalizedAmount":
        normalized.normalizedAmount = parseAmount(value);
        break;
      case "normalizedDescription":
        normalized.normalizedDescription = String(value).trim();
        break;
    }
  }

  // Fallback: generate sourceRecordId from hash if not mapped
  if (!normalized.sourceRecordId) {
    normalized.sourceRecordId = crypto
      .createHash("sha256")
      .update(JSON.stringify(raw))
      .digest("hex")
      .substring(0, 32);
  }

  return normalized;
}

function parseDate(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const ts = new Date(value).getTime();
    return isNaN(ts) ? null : ts;
  }
  return null;
}

function parseAmount(value: unknown): string | null {
  if (typeof value === "number") return value.toFixed(2);
  if (typeof value === "string") {
    const num = parseFloat(value.replace(/[^0-9.\-]/g, ""));
    return isNaN(num) ? null : num.toFixed(2);
  }
  return null;
}

// ─── T3. Batch Upsert Records ───

export async function upsertRecords(
  datasetId: string,
  records: NormalizedRecord[]
): Promise<{ inserted: number; updated: number; errors: string[] }> {
  let inserted = 0;
  let updated = 0;
  const errors: string[] = [];
  const now = Date.now();

  const BATCH_SIZE = 200;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);

    try {
      const values = batch.map((record) => ({
        datasetId: datasetId,
        sourceRecordId: record.sourceRecordId,
        ingestedAt: now,
        updatedAt: now,
        rawJson: record.rawJson,
        normalizedDate: record.normalizedDate,
        normalizedCategory: record.normalizedCategory,
        normalizedEntity: record.normalizedEntity,
        normalizedJurisdiction: record.normalizedJurisdiction,
        normalizedCity: record.normalizedCity,
        normalizedState: record.normalizedState,
        normalizedZip: record.normalizedZip,
        normalizedStatus: record.normalizedStatus,
        normalizedAmount: record.normalizedAmount,
        normalizedDescription: record.normalizedDescription,
        processedForSignals: false,
      }));

      await db.insert(ingestedRecords)
        .values(values)
        .onDuplicateKeyUpdate({
          set: {
            rawJson: sql`VALUES(rawJson)`,
            updatedAt: sql`VALUES(updatedAt_ir)`,
            normalizedDate: sql`VALUES(normalizedDate)`,
            normalizedCategory: sql`VALUES(normalizedCategory)`,
            normalizedEntity: sql`VALUES(normalizedEntity)`,
            normalizedJurisdiction: sql`VALUES(normalizedJurisdiction)`,
            normalizedCity: sql`VALUES(normalizedCity)`,
            normalizedState: sql`VALUES(normalizedState)`,
            normalizedZip: sql`VALUES(normalizedZip)`,
            normalizedStatus: sql`VALUES(normalizedStatus)`,
            normalizedAmount: sql`VALUES(normalizedAmount)`,
            normalizedDescription: sql`VALUES(normalizedDescription)`,
            processedForSignals: sql`0`,
          },
        });

      inserted += batch.length;
    } catch (err) {
      // Fallback to individual inserts
      for (const record of batch) {
        try {
          await db.insert(ingestedRecords)
            .values({
              datasetId: datasetId,
              sourceRecordId: record.sourceRecordId,
              ingestedAt: now,
              updatedAt: now,
              rawJson: record.rawJson,
              normalizedDate: record.normalizedDate,
              normalizedCategory: record.normalizedCategory,
              normalizedEntity: record.normalizedEntity,
              normalizedJurisdiction: record.normalizedJurisdiction,
              normalizedCity: record.normalizedCity,
              normalizedState: record.normalizedState,
              normalizedZip: record.normalizedZip,
              normalizedStatus: record.normalizedStatus,
              normalizedAmount: record.normalizedAmount,
              normalizedDescription: record.normalizedDescription,
              processedForSignals: false,
            })
            .onDuplicateKeyUpdate({
              set: {
                rawJson: sql`VALUES(rawJson)`,
                updatedAt: sql`VALUES(updatedAt_ir)`,
              },
            });
          inserted++;
        } catch (individualErr) {
          errors.push(`Record ${record.sourceRecordId}: ${individualErr instanceof Error ? individualErr.message : String(individualErr)}`);
        }
      }
    }
  }

  return { inserted, updated, errors };
}

// ─── T4. Full Ingestion Pipeline (Hardened) ───

export async function ingestDataset(
  datasetId: string,
  options?: { maxRecords?: number; onProgress?: (msg: string) => void }
): Promise<IngestionResult> {
  const log = options?.onProgress ?? console.log;

  // 1. Load dataset config from unified stream registry
  const [dataset] = await db
    .select()
    .from(dataStreamRegistry)
    .where(eq(dataStreamRegistry.streamId, datasetId))
    .limit(1);

  if (!dataset) {
    return {
      recordsProcessed: 0, recordsInserted: 0, recordsUpdated: 0,
      signalsGenerated: 0, errors: [`Dataset ${datasetId} not found in registry`],
      runId: 0,
      diagnostics: {
        errorClassification: "schema_mismatch", httpStatus: null, contentType: null,
        endpointAttempted: null, adapterUsed: "socrata", bodyPreview: null,
        parseFailureReason: null, retryCount: 0,
        failureClassification: "config_error",
        suggestedRemediation: "Register the dataset in the Data Stream Registry before running ingestion.",
        outcomeClassification: "config_error",
      },
    };
  }

  if (!dataset.enabled) {
    return {
      recordsProcessed: 0, recordsInserted: 0, recordsUpdated: 0,
      signalsGenerated: 0, errors: [`Dataset ${datasetId} is disabled`],
      runId: 0,
      diagnostics: {
        errorClassification: null, httpStatus: null, contentType: null,
        endpointAttempted: null, adapterUsed: "socrata", bodyPreview: null,
        parseFailureReason: null, retryCount: 0,
        failureClassification: "disabled",
        suggestedRemediation: "Enable the stream in Sovereign Control before running.",
        outcomeClassification: "skipped_disabled",
      },
    };
  }

  const fieldMapping = (dataset.fieldMapping as Record<string, string>) ?? {};

  // 2. Create ingest run
  const datasetApiUrl = dataset.apiUrl ?? dataset.sourceUrl ?? '';
  const [run] = await db.insert(ingestRuns).values({
    datasetId: datasetId,
    startTime: Date.now(),
    status: "running",
    endpointAttempted: datasetApiUrl,
    adapterUsed: "socrata",
  }).$returningId();

  const runId = run.id;

  try {
    // 3. Fetch data with pagination
    log(`[Ingest] Starting fetch from ${datasetApiUrl}`);

    // Build the API URL with proper checkpoint filtering
    // Find the date field from the field mapping (the source field that maps to normalizedDate)
    const dateSourceField = Object.entries(fieldMapping).find(([_, target]) => target === "normalizedDate")?.[0];
    const idSourceField = Object.entries(fieldMapping).find(([_, target]) => target === "sourceRecordId")?.[0];
    const orderField = dateSourceField || idSourceField || ":id";

    let apiUrl = datasetApiUrl;
    if (dataset.lastIngestedAt && dateSourceField) {
      const lastDate = new Date(Number(dataset.lastIngestedAt)).toISOString();
      // Use URL constructor to properly encode the $where parameter
      try {
        const urlObj = new URL(apiUrl);
        urlObj.searchParams.set("$where", `${dateSourceField} > '${lastDate}'`);
        apiUrl = urlObj.toString();
      } catch {
        // Fallback: manual encoding if URL constructor fails
        const separator = apiUrl.includes("?") ? "&" : "?";
        apiUrl = `${apiUrl}${separator}${encodeURIComponent("$where")}=${encodeURIComponent(`${dateSourceField} > '${lastDate}'`)}`;
      }
    }

    const fetchResult = await fetchAllSocrataRecords(
      apiUrl,
      (page, total) => {
        log(`[Ingest] Page ${page}: ${total} records fetched`);
      },
      options?.maxRecords,
      orderField
    );

    // Handle API unreachable gracefully
    if (!fetchResult.apiReachable && fetchResult.records.length === 0) {
      const failMsg = `External API unreachable: ${fetchResult.errorMessage}`;
      log(`[Ingest] ${failMsg}`);

      const errorClass = fetchResult.errorClass ?? "unknown";
      const remediation = suggestRemediation(errorClass);

      await db
        .update(ingestRuns)
        .set({
          endTime: Date.now(),
          recordsProcessed: 0,
          recordsInserted: 0,
          recordsUpdated: 0,
          status: "api_unavailable",
          errors: [failMsg],
          summary: `API unreachable — ${fetchResult.errorMessage}. ${remediation}`,
          errorClassification: errorClass,
          httpStatus: fetchResult.lastHttpStatus,
          contentType: fetchResult.lastContentType,
          endpointAttempted: apiUrl,
          adapterUsed: "socrata",
          bodyPreview: fetchResult.lastBodyPreview?.substring(0, 500) ?? null,
          retryCount: fetchResult.totalRetries,
          failureClassification: errorClass,
          suggestedRemediation: remediation,
          outcomeClassification: "api_unreachable",
        })
        .where(eq(ingestRuns.id, runId));

      return {
        recordsProcessed: 0, recordsInserted: 0, recordsUpdated: 0,
        signalsGenerated: 0, errors: [failMsg], runId,
        diagnostics: {
          errorClassification: errorClass, httpStatus: fetchResult.lastHttpStatus,
          contentType: fetchResult.lastContentType, endpointAttempted: apiUrl,
          adapterUsed: "socrata", bodyPreview: fetchResult.lastBodyPreview,
          parseFailureReason: null, retryCount: fetchResult.totalRetries,
          failureClassification: errorClass, suggestedRemediation: remediation,
          outcomeClassification: "api_unreachable",
        },
      };
    }

    if (!fetchResult.apiReachable && fetchResult.records.length > 0) {
      log(`[Ingest] Partial fetch: ${fetchResult.records.length} records before API failure. Processing available data.`);
    }

    const recordsToProcess = fetchResult.records;
    log(`[Ingest] Fetched ${recordsToProcess.length} records, normalizing...`);

    // 4. Normalize
    // Static overrides: apply registry-level jurisdiction/city/state when field mapping doesn't provide them
    const staticJurisdiction = dataset.jurisdiction ?? null;
    const normalized = recordsToProcess.map((raw) => {
      const rec = normalizeRecord(raw, fieldMapping);
      if (!rec.normalizedJurisdiction && staticJurisdiction) rec.normalizedJurisdiction = staticJurisdiction;
      return rec;
    });

    // 5. Upsert
    log(`[Ingest] Upserting ${normalized.length} records...`);
    const result = await upsertRecords(datasetId, normalized);

    // 6. Update run record
    const runStatus = !fetchResult.apiReachable ? "partial" : "completed";
    const partialNote = !fetchResult.apiReachable ? ` (partial — API failed after page ${fetchResult.pagesCompleted})` : "";
    await db
      .update(ingestRuns)
      .set({
        endTime: Date.now(),
        recordsProcessed: recordsToProcess.length,
        recordsInserted: result.inserted,
        recordsUpdated: result.updated,
        status: runStatus,
        errors: result.errors.length > 0 ? result.errors.slice(0, 50) : (!fetchResult.apiReachable ? [fetchResult.errorMessage ?? "API unreachable"] : null),
        summary: `Processed ${recordsToProcess.length} records${partialNote}: ${result.inserted} inserted, ${result.updated} updated, ${result.errors.length} errors`,
        httpStatus: fetchResult.lastHttpStatus,
        contentType: fetchResult.lastContentType,
        endpointAttempted: apiUrl,
        adapterUsed: "socrata",
        retryCount: fetchResult.totalRetries,
        outcomeClassification: runStatus,
      })
      .where(eq(ingestRuns.id, runId));

    // 7. Update unified stream registry
    await db
      .update(dataStreamRegistry)
      .set({
        lastIngestedAt: Date.now(),
        recordsIngested: sql`records_ingested_dsr + ${result.inserted}`,
        lastRecordsIngested: result.inserted,
        lastRunStatus: runStatus,
        lastSuccessAt: Date.now(),
        consecutiveFailures: 0,
        updatedAt: Date.now(),
      })
      .where(eq(dataStreamRegistry.streamId, datasetId));

    log(`[Ingest] Complete: ${result.inserted} inserted, ${result.updated} updated, ${result.errors.length} errors`);

    return {
      recordsProcessed: recordsToProcess.length,
      recordsInserted: result.inserted,
      recordsUpdated: result.updated,
      signalsGenerated: 0, // Will be set by scheduler after signal detection
      errors: result.errors,
      runId,
      diagnostics: {
        errorClassification: null, httpStatus: fetchResult.lastHttpStatus,
        contentType: fetchResult.lastContentType, endpointAttempted: apiUrl,
        adapterUsed: "socrata", bodyPreview: null,
        parseFailureReason: null, retryCount: fetchResult.totalRetries,
        failureClassification: null, suggestedRemediation: null,
        outcomeClassification: runStatus,
      },
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const errorClass = classifyError(err);
    const remediation = suggestRemediation(errorClass);

    // Mark run as failed
    try {
      await db
        .update(ingestRuns)
        .set({
          endTime: Date.now(),
          status: "failed",
          errors: [errorMsg],
          errorClassification: errorClass,
          endpointAttempted: dataset.apiUrl ?? dataset.sourceUrl ?? '',
          adapterUsed: "socrata",
          failureClassification: errorClass,
          suggestedRemediation: remediation,
          outcomeClassification: "pipeline_error",
        })
        .where(eq(ingestRuns.id, runId));
    } catch (dbErr) {
      console.error(`[Ingest] CRITICAL: Failed to mark run ${runId} as failed in DB:`, dbErr);
    }

    // Update stream failure tracking
    try {
      await db
        .update(dataStreamRegistry)
        .set({
          lastRunStatus: "failed",
          lastFailureAt: Date.now(),
          lastErrorType: errorClass,
          lastErrorMessage: errorMsg.substring(0, 500),
          failureCount: sql`failure_count_dsr + 1`,
          consecutiveFailures: sql`consecutive_failures_dsr + 1`,
          updatedAt: Date.now(),
        })
        .where(eq(dataStreamRegistry.streamId, datasetId));
    } catch { /* non-fatal */ }

    return {
      recordsProcessed: 0, recordsInserted: 0, recordsUpdated: 0,
      signalsGenerated: 0, errors: [errorMsg], runId,
      diagnostics: {
        errorClassification: errorClass, httpStatus: null,
        contentType: null, endpointAttempted: dataset.apiUrl ?? dataset.sourceUrl ?? '',
        adapterUsed: "socrata", bodyPreview: null,
        parseFailureReason: null, retryCount: 0,
        failureClassification: errorClass, suggestedRemediation: remediation,
        outcomeClassification: "pipeline_error",
      },
    };
  }
}

// ─── Pre-configured Dataset Definitions ───

export const WA_CONSUMER_COMPLAINTS: SocrataDatasetConfig = {
  datasetId: "gpri-47xz",
  apiUrl: "https://data.wa.gov/resource/gpri-47xz.json",
  fieldMapping: {
    id: "sourceRecordId",
    openeddate: "normalizedDate",
    businesscategory: "normalizedCategory",
    business: "normalizedEntity",
    businessstate: "normalizedState",
    businesscity: "normalizedCity",
    businesszip: "normalizedZip",
    status: "normalizedStatus",
    actualsavings: "normalizedAmount",
    naics: "normalizedDescription",
  },
};

export const WA_IMAGED_DOCUMENTS: SocrataDatasetConfig = {
  datasetId: "j78t-andi",
  apiUrl: "https://data.wa.gov/resource/j78t-andi.json",
  fieldMapping: {
    id: "sourceRecordId",
    receipt_date: "normalizedDate",
    type: "normalizedCategory",
    filer_name: "normalizedEntity",
    office: "normalizedJurisdiction",
    legislative_district: "normalizedCity",
    party: "normalizedState",
    election_year: "normalizedZip",
    origin: "normalizedStatus",
    document_description: "normalizedDescription",
  },
};
