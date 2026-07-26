import { createClient } from '@supabase/supabase-js';

const SOURCE_VIEW = 'v_civic_map_signals_production';
const TARGET_TABLE = 'atlas_lighthouse_signal_bridge_v1';
const BRIDGE_VERSION = 'atlas_lighthouse_bridge_v1';
const DEFAULT_PAGE_SIZE = 500;
const DEFAULT_SCAN_LIMIT = 5000;
const INSERT_BATCH_SIZE = 50;

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function createServiceClient(url, key) {
  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export function resolveBridgeConfiguration(env = process.env) {
  const atlasUrl = env.SUPABASE_URL;
  const atlasKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const lighthouseUrl = env.LIGHTHOUSE_SUPABASE_URL;
  const lighthouseKey = env.LIGHTHOUSE_SERVICE_ROLE_KEY || env.LIGHTHOUSE_SERVICE_KEY;

  const missing = [
    ['SUPABASE_URL', atlasUrl],
    ['SUPABASE_SERVICE_ROLE_KEY', atlasKey],
    ['LIGHTHOUSE_SUPABASE_URL', lighthouseUrl],
    ['LIGHTHOUSE_SERVICE_ROLE_KEY or LIGHTHOUSE_SERVICE_KEY', lighthouseKey],
  ].filter(([, value]) => !value).map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(`Atlas-to-Lighthouse bridge is not configured: missing ${missing.join(', ')}`);
  }

  if (atlasUrl === lighthouseUrl) {
    throw new Error('Atlas-to-Lighthouse bridge refused to start because source and target URLs are identical.');
  }

  return {
    atlasUrl,
    atlasKey,
    lighthouseUrl,
    lighthouseKey,
    pageSize: boundedInteger(env.ATLAS_BRIDGE_PAGE_SIZE, DEFAULT_PAGE_SIZE, 1, 1000),
    scanLimit: boundedInteger(env.ATLAS_BRIDGE_SCAN_LIMIT, DEFAULT_SCAN_LIMIT, 1, 50000),
    sourceProjectRef: env.SUPABASE_PROJECT_REF || 'bjdjjgnkhxblnpdrjqtw',
    targetProjectRef: env.LIGHTHOUSE_SUPABASE_PROJECT_REF || 'wepxlinwbjrkqdzkqpar',
  };
}

function requireSignalField(signal, field) {
  const value = signal?.[field];
  if (value === null || value === undefined || value === '') {
    throw new Error(`Production signal is missing required field: ${field}`);
  }
  return value;
}

export function mapProductionSignalToBridgeRow(signal, context = {}) {
  const emittedAt = context.emittedAt || new Date().toISOString();
  const atlasSignalId = String(requireSignalField(signal, 'signal_id'));
  const signalType = String(requireSignalField(signal, 'signal_type'));
  const sourceConnectorId = String(requireSignalField(signal, 'source_connector_id'));
  const rawRecordId = String(requireSignalField(signal, 'raw_record_id'));
  const statuteId = String(requireSignalField(signal, 'statute_id'));
  const sourceUrl = String(requireSignalField(signal, 'source_url'));
  const detectedAt = requireSignalField(signal, 'detected_at');
  const ruleId = String(requireSignalField(signal, 'rule_id'));

  return {
    atlas_signal_id: atlasSignalId,
    signal_type: signalType,
    source_system: 'atlas',
    bridge_version: BRIDGE_VERSION,
    source_connector_id: sourceConnectorId,
    raw_record_id: rawRecordId,
    statute_id: statuteId,
    entity_ids: Array.isArray(signal.entity_ids) ? signal.entity_ids.map(String) : [],
    jurisdiction_raw_value: signal.jurisdiction_raw_value ?? signal.geography_key ?? null,
    jurisdiction_id: signal.jurisdiction_id ? String(signal.jurisdiction_id) : null,
    source_url: sourceUrl,
    detected_at: detectedAt,
    bridged_at: emittedAt,
    confidence_score: signal.confidence_score ?? signal.severity_score ?? 0.5,
    severity: signal.severity ?? 'info',
    signal_status: signal.signal_status ?? 'active',
    rule_id: ruleId,
    rule_version: signal.rule_version ?? 'v1',
    generation_method: signal.generation_method ?? 'deterministic_rule',
    record_origin: signal.record_origin ?? 'live_api',
    verification_status: signal.verification_status ?? 'verified',
    evidence_payload: signal.evidence_payload ?? {},
    provenance_metadata: signal.provenance_metadata ?? {},
    atlas_metadata_json: signal.metadata_json ?? {},
    atlas_signal_dedup_key: signal.signal_dedup_key ?? `atlas|${atlasSignalId}`,
    source_view: `public.${SOURCE_VIEW}`,
    bridge_metadata: {
      transport: 'atlas_service_cross_project_v1',
      source_project_ref: context.sourceProjectRef ?? null,
      target_project_ref: context.targetProjectRef ?? null,
      emitted_at: emittedAt,
      deterministic_verified_only: true,
    },
    updated_at: emittedAt,
  };
}

async function readProductionSignals(atlasClient, pageSize, scanLimit) {
  const rows = [];

  for (let offset = 0; offset < scanLimit; offset += pageSize) {
    const upper = Math.min(offset + pageSize, scanLimit) - 1;
    const { data, error } = await atlasClient
      .from(SOURCE_VIEW)
      .select('*')
      .order('signal_id', { ascending: true })
      .range(offset, upper);

    if (error) {
      throw new Error(`Unable to read Atlas production signals: ${error.message}`);
    }

    const page = data ?? [];
    rows.push(...page);
    if (page.length < upper - offset + 1) break;
  }

  return rows;
}

async function readExistingSignalIds(lighthouseClient, signalIds) {
  const existing = new Set();

  for (let offset = 0; offset < signalIds.length; offset += DEFAULT_PAGE_SIZE) {
    const batch = signalIds.slice(offset, offset + DEFAULT_PAGE_SIZE);
    if (batch.length === 0) continue;

    const { data, error } = await lighthouseClient
      .from(TARGET_TABLE)
      .select('atlas_signal_id')
      .in('atlas_signal_id', batch);

    if (error) {
      throw new Error(`Unable to inspect Lighthouse bridge identities: ${error.message}`);
    }

    for (const row of data ?? []) {
      existing.add(String(row.atlas_signal_id));
    }
  }

  return existing;
}

async function insertBridgeRows(lighthouseClient, rows) {
  let bridged = 0;
  let errors = 0;
  const failures = [];

  for (let offset = 0; offset < rows.length; offset += INSERT_BATCH_SIZE) {
    const batch = rows.slice(offset, offset + INSERT_BATCH_SIZE);
    const { error } = await lighthouseClient.from(TARGET_TABLE).insert(batch);

    if (!error) {
      bridged += batch.length;
      continue;
    }

    // Preserve progress when one row conflicts with a separate canonical key.
    for (const row of batch) {
      const { error: rowError } = await lighthouseClient.from(TARGET_TABLE).insert(row);
      if (rowError) {
        errors += 1;
        failures.push({ atlas_signal_id: row.atlas_signal_id, error: rowError.message });
      } else {
        bridged += 1;
      }
    }
  }

  return { bridged, errors, failures };
}

export async function drainProductionSignals({
  atlasClient,
  lighthouseClient,
  pageSize = DEFAULT_PAGE_SIZE,
  scanLimit = DEFAULT_SCAN_LIMIT,
  sourceProjectRef = null,
  targetProjectRef = null,
  emittedAt = new Date().toISOString(),
}) {
  const productionSignals = await readProductionSignals(atlasClient, pageSize, scanLimit);
  const signalIds = productionSignals.map(signal => String(signal.signal_id));
  const existingIds = await readExistingSignalIds(lighthouseClient, signalIds);
  const unbridged = productionSignals.filter(signal => !existingIds.has(String(signal.signal_id)));

  const rows = [];
  const mappingFailures = [];
  for (const signal of unbridged) {
    try {
      rows.push(mapProductionSignalToBridgeRow(signal, {
        emittedAt,
        sourceProjectRef,
        targetProjectRef,
      }));
    } catch (error) {
      mappingFailures.push({
        atlas_signal_id: signal?.signal_id === undefined ? null : String(signal.signal_id),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const insertion = await insertBridgeRows(lighthouseClient, rows);
  const errors = mappingFailures.length + insertion.errors;

  return {
    processed: productionSignals.length,
    bridged: insertion.bridged,
    promoted: 0,
    staged: 0,
    rejected: 0,
    skipped: existingIds.size,
    errors,
    source_view: `public.${SOURCE_VIEW}`,
    target_table: `public.${TARGET_TABLE}`,
    scanned_at: emittedAt,
    failures: [...mappingFailures, ...insertion.failures].slice(0, 25),
  };
}

export async function runBridgeDrain(env = process.env) {
  const config = resolveBridgeConfiguration(env);
  const atlasClient = createServiceClient(config.atlasUrl, config.atlasKey);
  const lighthouseClient = createServiceClient(config.lighthouseUrl, config.lighthouseKey);

  return drainProductionSignals({
    atlasClient,
    lighthouseClient,
    pageSize: config.pageSize,
    scanLimit: config.scanLimit,
    sourceProjectRef: config.sourceProjectRef,
    targetProjectRef: config.targetProjectRef,
  });
}
