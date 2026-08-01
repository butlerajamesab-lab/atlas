/**
 * ATLAS CONVERGENCE RUNNER v2.1.0
 *
 * Production runner that:
 * 1. Loads the complete source-event identity population from public.signal_events
 *    + atlas.signal_event_identity
 * 2. Transforms to Math Engine v2.1 Signal format
 * 3. Runs convergence detection per geography
 * 4. Persists run manifest, signal snapshots, per-geography receipts, and result payload
 * 5. Supports exact replay via persisted snapshots
 *
 * Requires explicit:
 *   - as_of (epoch ms)
 *   - time_window_ms (from = as_of - time_window_ms)
 *   - temporal_bucket_ms
 *   - geography_registry_version (hash of the registry)
 *   - rule_manifest_hash (sha256 of ENGINE_EQUATIONS)
 *   - engine_version
 *
 * Does NOT:
 *   - Use LLMs
 *   - Infer counties from city names
 *   - Assign placeholder scores
 *   - Inject wall-clock time
 *   - Silently promote candidates
 */

import { createClient } from '@supabase/supabase-js';
import {
  canonicalJson,
  sha256,
  computeRunKey,
  ENGINE_VERSION,
} from '../substrate/canonical.js';
import {
  deduplicateSignals,
  detectConvergence,
  generateProvenanceReceipt,
  ENGINE_EQUATIONS,
} from '../substrate/convergence.js';
import {
  loadWashingtonGeography,
  loadGeographyByJurisdiction,
} from '../substrate/geographyLoader.js';
import {
  normalizeGeographyId,
  toRuntimeRegistry,
  computeRegistryHash,
} from '../substrate/geography.js';

/**
 * Transform a raw signal_events row into Math Engine v2.1 Signal format.
 * Returns null if the row cannot be transformed (missing required fields).
 */
export function transformSignalEvent(row) {
  // Required fields
  if (!row.stream_id || row.offset === undefined || row.offset === null) return null;
  if (!row.signal_type) return null;

  // Construct canonical signal ID from stream_id + offset
  const id = row.event_identity_hash || `${row.stream_id}:${row.offset}`;

  // Temporal coordinate: prefer detected_at, fall back to timestamp
  const ts = row.detected_at || row.timestamp;
  if (!ts) return null;
  const temporal_coordinate = new Date(ts).getTime();
  if (!Number.isFinite(temporal_coordinate)) return null;

  // Spatial coordinate: normalize jurisdiction_id to uppercase
  const spatial_coordinate = normalizeGeographyId(
    row.jurisdiction_id || row.state || null,
  );
  if (!spatial_coordinate) return null;

  // Confidence: from payload or null
  const confidence = typeof row.confidence === 'number'
    ? Math.max(0, Math.min(1, row.confidence))
    : null;

  // Characteristics: extract from payload (deterministic subset)
  const payload = row.payload || {};
  const characteristics = {};
  if (payload.product) characteristics.product = String(payload.product);
  if (payload.issue) characteristics.issue = String(payload.issue);
  if (payload.sub_product) characteristics.sub_product = String(payload.sub_product);
  if (payload.sub_issue) characteristics.sub_issue = String(payload.sub_issue);
  if (payload.company) characteristics.company = String(payload.company);
  if (payload.company_response) characteristics.company_response = String(payload.company_response);
  if (row.signal_type) characteristics.signal_type_raw = String(row.signal_type);

  return {
    id,
    signal_type: String(row.signal_type),
    spatial_coordinate,
    temporal_coordinate,
    confidence,
    characteristics,
  };
}

/**
 * Load the complete source-event population from the production database.
 * Bounded by as_of and time_window_ms. Returns ALL signals (not just target geography).
 */
export async function loadSourcePopulation(supabase, { as_of, time_window_ms }) {
  const from_ts = new Date(as_of - time_window_ms).toISOString();
  const to_ts = new Date(as_of).toISOString();

  // Load from public.signal_events with time bounds
  // Use timestamp column for time filtering
  const { data, error, count } = await supabase
    .from('signal_events')
    .select('*', { count: 'exact' })
    .gte('timestamp', from_ts)
    .lte('timestamp', to_ts)
    .order('stream_id', { ascending: true })
    .order('offset', { ascending: true });

  if (error) {
    throw new Error(`Failed to load signal_events: ${error.message}`);
  }

  return { rows: data || [], total_count: count || (data || []).length };
}

/**
 * Execute a governed convergence run.
 *
 * This is the main entry point for the production runner.
 * All parameters are explicit — nothing is inferred or defaulted from wall-clock.
 */
export async function executeConvergenceRun({
  supabase,
  as_of,
  time_window_ms,
  temporal_bucket_ms,
  geography_registry_version,
  min_signals_for_analysis = 1,
  z_score_threshold = 2.0,
  target_geographies = null, // null = all in registry; array = specific subset
  persist = true,
}) {
  // ─── 1. Validate all explicit parameters ───
  if (!Number.isFinite(as_of)) throw new Error('as_of must be a finite number');
  if (!Number.isFinite(time_window_ms) || time_window_ms <= 0) throw new Error('time_window_ms must be positive');
  if (!Number.isFinite(temporal_bucket_ms) || temporal_bucket_ms <= 0) throw new Error('temporal_bucket_ms must be positive');
  if (!geography_registry_version) throw new Error('geography_registry_version is required');

  // ─── 2. Load geography registry ───
  const waGeo = loadWashingtonGeography();
  if (waGeo.registry_hash !== geography_registry_version && geography_registry_version !== waGeo.runtime.version) {
    // Check if the version matches the hash or the runtime version string
    if (geography_registry_version !== waGeo.registry_hash) {
      throw new Error(
        `geography_registry_version mismatch: requested '${geography_registry_version}' but loaded registry has hash '${waGeo.registry_hash}'`,
      );
    }
  }
  const registry = waGeo.runtime;

  // ─── 3. Build configuration object ───
  const config = Object.freeze({
    as_of,
    time_window_ms,
    temporal_bucket_ms,
    geography_registry_version: registry.version,
    min_signals_for_analysis,
    z_score_threshold,
  });
  const configHash = sha256(config);
  const ruleManifestHash = sha256(ENGINE_EQUATIONS);

  // ─── 4. Compute run key (deterministic identity) ───
  const runKey = computeRunKey({
    as_of,
    config,
    geography_registry_version: registry.version,
    engine_version: ENGINE_VERSION,
  });

  // ─── 5. Load complete source-event population ───
  const { rows, total_count } = await loadSourcePopulation(supabase, { as_of, time_window_ms });

  // ─── 6. Transform to v2.1 Signal format ───
  const allSignals = [];
  const transformErrors = [];
  for (const row of rows) {
    const signal = transformSignalEvent(row);
    if (signal) {
      allSignals.push(signal);
    } else {
      transformErrors.push({ stream_id: row.stream_id, offset: row.offset, reason: 'missing required fields' });
    }
  }

  // Sort by ID for determinism
  allSignals.sort((a, b) => a.id.localeCompare(b.id));

  // ─── 7. Deduplicate the full population ───
  const deduplicatedAll = deduplicateSignals(allSignals, temporal_bucket_ms);

  // ─── 8. Group signals by geography ───
  const byGeography = new Map();
  for (const signal of allSignals) {
    const geo = signal.spatial_coordinate;
    if (!byGeography.has(geo)) byGeography.set(geo, []);
    byGeography.get(geo).push(signal);
  }

  // Determine which geographies to analyze
  const geographiesToAnalyze = target_geographies
    ? target_geographies.map(normalizeGeographyId)
    : [...byGeography.keys()].sort();

  // ─── 9. Run convergence detection per geography ───
  const receipts = [];
  const results = [];

  for (const geoId of geographiesToAnalyze) {
    const geoSignals = byGeography.get(geoId) || [];

    if (geoSignals.length < min_signals_for_analysis) {
      // Below threshold — still persist the receipt with status
      const result = {
        geography: geoId,
        raw_signal_count: geoSignals.length,
        signal_count: 0,
        status: 'below_threshold',
        reason: `${geoSignals.length} signals < min_signals_for_analysis (${min_signals_for_analysis})`,
      };
      results.push(result);

      const receipt = generateProvenanceReceipt({
        run_key: runKey,
        geography_id: geoId,
        equation_id: 'poisson_z_score',
        as_of,
        config,
        raw_population: allSignals,
        deduplicated_population: deduplicatedAll,
        geography_registry: registry,
        expected_count: null,
        observed_count: geoSignals.length,
        computed_outputs: result,
      });
      receipts.push({ ...receipt, status: 'below_threshold', z_score: null, convergence_detected: false });
      continue;
    }

    // Run convergence
    const convergenceResult = detectConvergence({
      geography: geoId,
      raw_signals: geoSignals,
      as_of,
      time_window_ms,
      temporal_bucket_ms,
      total_signals_all_geographies: deduplicatedAll.length,
      geography_registry: registry,
    });

    const convergenceDetected = convergenceResult.poisson.status === 'resolved'
      && convergenceResult.poisson.z_score !== null
      && convergenceResult.poisson.z_score >= z_score_threshold;

    const receipt = generateProvenanceReceipt({
      run_key: runKey,
      geography_id: geoId,
      equation_id: 'poisson_z_score',
      as_of,
      config,
      raw_population: allSignals,
      deduplicated_population: deduplicatedAll,
      geography_registry: registry,
      expected_count: convergenceResult.poisson.expected_count,
      observed_count: convergenceResult.poisson.observed_count,
      computed_outputs: convergenceResult,
    });

    receipts.push({
      ...receipt,
      z_score: convergenceResult.poisson.z_score,
      convergence_detected: convergenceDetected,
      status: convergenceResult.poisson.status,
      reason_unresolved: convergenceResult.poisson.reason_unresolved || null,
    });
    results.push(convergenceResult);
  }

  // ─── 10. Build complete output payload ───
  const completeOutput = {
    run_key: runKey,
    engine_version: ENGINE_VERSION,
    as_of,
    config,
    geography_registry_version: registry.version,
    rule_manifest_hash: ruleManifestHash,
    total_signals_raw: allSignals.length,
    total_signals_deduplicated: deduplicatedAll.length,
    total_geographies: geographiesToAnalyze.length,
    transform_errors: transformErrors.length,
    receipts,
    results,
  };
  const outputHash = sha256(completeOutput);

  // ─── 11. Persist if requested ───
  let persistenceResult = null;
  if (persist && supabase) {
    persistenceResult = await persistRun(supabase, {
      runKey,
      config,
      configHash,
      ruleManifestHash,
      registry,
      allSignals,
      deduplicatedAll,
      receipts,
      completeOutput,
      outputHash,
      geographiesToAnalyze,
    });
  }

  return {
    run_key: runKey,
    engine_version: ENGINE_VERSION,
    as_of,
    output_hash: outputHash,
    total_signals_raw: allSignals.length,
    total_signals_deduplicated: deduplicatedAll.length,
    total_geographies: geographiesToAnalyze.length,
    transform_errors: transformErrors.length,
    receipts,
    results,
    persistence: persistenceResult,
    complete_output: completeOutput,
  };
}

/**
 * Persist the run to the production database.
 * Uses the RPCs defined in 20260801_convergence_persistence.sql.
 */
async function persistRun(supabase, {
  runKey, config, configHash, ruleManifestHash, registry,
  allSignals, deduplicatedAll, receipts, completeOutput, outputHash,
  geographiesToAnalyze,
}) {
  const errors = [];

  // 1. Start run
  const { data: startData, error: startError } = await supabase.rpc(
    'atlas_convergence_start_run_v1',
    {
      p_run_key: runKey,
      p_engine_version: ENGINE_VERSION,
      p_as_of: config.as_of,
      p_time_window_ms: config.time_window_ms,
      p_temporal_bucket_ms: config.temporal_bucket_ms,
      p_geography_registry_version: config.geography_registry_version,
      p_rule_manifest_hash: ruleManifestHash,
      p_configuration_hash: configHash,
      p_configuration_json: config,
      p_min_signals_for_analysis: config.min_signals_for_analysis,
      p_z_score_threshold: config.z_score_threshold,
    },
  );
  if (startError) errors.push({ step: 'start_run', error: startError.message });

  // 2. Persist signal snapshots
  const rawHash = sha256(allSignals);
  const dedupHash = sha256(deduplicatedAll);

  const { error: rawErr } = await supabase.from('convergence_signal_snapshot').insert({
    run_key: runKey,
    snapshot_type: 'raw',
    population_hash: rawHash,
    signal_count: allSignals.length,
    signals_json: allSignals,
  }).select().maybeSingle();
  // Ignore unique constraint violations (idempotent)
  if (rawErr && !rawErr.message.includes('duplicate')) {
    errors.push({ step: 'raw_snapshot', error: rawErr.message });
  }

  const { error: dedupErr } = await supabase.from('convergence_signal_snapshot').insert({
    run_key: runKey,
    snapshot_type: 'deduplicated',
    population_hash: dedupHash,
    signal_count: deduplicatedAll.length,
    signals_json: deduplicatedAll,
  }).select().maybeSingle();
  if (dedupErr && !dedupErr.message.includes('duplicate')) {
    errors.push({ step: 'dedup_snapshot', error: dedupErr.message });
  }

  // 3. Persist per-geography receipts
  for (const receipt of receipts) {
    const { error: receiptErr } = await supabase.rpc(
      'atlas_convergence_persist_receipt_v1',
      {
        p_run_key: runKey,
        p_receipt_identity: receipt.input_hash, // receipt identity from provenance
        p_geography_id: receipt.geography_id,
        p_equation_id: receipt.equation_id,
        p_engine_version: receipt.engine_version,
        p_rule_manifest_hash: receipt.rule_manifest_hash,
        p_as_of: receipt.as_of,
        p_configuration_hash: receipt.configuration_hash,
        p_input_hash: receipt.input_hash,
        p_source_signal_ids: receipt.source_signal_ids,
        p_geography_registry_version: receipt.geography_registry_version,
        p_expected_count: receipt.expected_count,
        p_observed_count: receipt.observed_count,
        p_z_score: receipt.z_score ?? null,
        p_convergence_detected: receipt.convergence_detected || false,
        p_status: receipt.status || 'resolved',
        p_reason_unresolved: receipt.reason_unresolved || null,
        p_computed_outputs: receipt.computed_outputs || {},
        p_timestamp_computed: receipt.timestamp_computed,
      },
    );
    if (receiptErr && !receiptErr.message.includes('already exists')) {
      errors.push({ step: `receipt_${receipt.geography_id}`, error: receiptErr.message });
    }
  }

  // 4. Complete run
  const { error: completeErr } = await supabase.rpc(
    'atlas_convergence_complete_run_v1',
    {
      p_run_key: runKey,
      p_output_hash: outputHash,
      p_payload_json: completeOutput,
      p_receipt_count: receipts.length,
      p_total_signals_raw: allSignals.length,
      p_total_signals_dedup: deduplicatedAll.length,
      p_total_geographies: geographiesToAnalyze.length,
    },
  );
  if (completeErr) errors.push({ step: 'complete_run', error: completeErr.message });

  return {
    persisted: errors.length === 0,
    errors,
    run_key: runKey,
    output_hash: outputHash,
  };
}

/**
 * Replay a persisted run from its snapshots.
 * Loads the original snapshots from the database and recomputes.
 * Returns the replay result with consistency check.
 */
export async function replayConvergenceRun(supabase, runKey) {
  // Load the original run manifest
  const { data: manifest, error: manifestErr } = await supabase
    .from('convergence_run_manifest')
    .select('*')
    .eq('run_key', runKey)
    .single();
  if (manifestErr || !manifest) throw new Error(`Run ${runKey} not found: ${manifestErr?.message}`);

  // Load signal snapshots
  const { data: snapshots, error: snapErr } = await supabase
    .from('convergence_signal_snapshot')
    .select('*')
    .eq('run_key', runKey);
  if (snapErr) throw new Error(`Failed to load snapshots: ${snapErr.message}`);

  const rawSnapshot = snapshots?.find(s => s.snapshot_type === 'raw');
  const dedupSnapshot = snapshots?.find(s => s.snapshot_type === 'deduplicated');
  if (!rawSnapshot || !dedupSnapshot) throw new Error('Missing signal snapshots for replay');

  // Load original receipts for comparison
  const { data: originalReceipts, error: receiptErr } = await supabase
    .from('convergence_receipt')
    .select('*')
    .eq('run_key', runKey);
  if (receiptErr) throw new Error(`Failed to load receipts: ${receiptErr.message}`);

  // Load original result payload
  const { data: resultPayload, error: resultErr } = await supabase
    .from('convergence_result_payload')
    .select('*')
    .eq('run_key', runKey)
    .single();
  if (resultErr) throw new Error(`Failed to load result payload: ${resultErr.message}`);

  // Recompute using the persisted snapshots
  const config = manifest.configuration_json;
  const waGeo = loadWashingtonGeography();
  const registry = waGeo.runtime;

  const allSignals = rawSnapshot.signals_json;
  const deduplicatedAll = dedupSnapshot.signals_json;

  // Group by geography
  const byGeography = new Map();
  for (const signal of allSignals) {
    const geo = signal.spatial_coordinate;
    if (!byGeography.has(geo)) byGeography.set(geo, []);
    byGeography.get(geo).push(signal);
  }

  const geographiesToAnalyze = [...byGeography.keys()].sort();
  const replayReceipts = [];
  const replayResults = [];

  for (const geoId of geographiesToAnalyze) {
    const geoSignals = byGeography.get(geoId) || [];

    if (geoSignals.length < config.min_signals_for_analysis) {
      const result = {
        geography: geoId,
        raw_signal_count: geoSignals.length,
        signal_count: 0,
        status: 'below_threshold',
        reason: `${geoSignals.length} signals < min_signals_for_analysis (${config.min_signals_for_analysis})`,
      };
      replayResults.push(result);
      const receipt = generateProvenanceReceipt({
        run_key: runKey,
        geography_id: geoId,
        equation_id: 'poisson_z_score',
        as_of: config.as_of,
        config,
        raw_population: allSignals,
        deduplicated_population: deduplicatedAll,
        geography_registry: registry,
        expected_count: null,
        observed_count: geoSignals.length,
        computed_outputs: result,
      });
      replayReceipts.push({ ...receipt, status: 'below_threshold', z_score: null, convergence_detected: false });
      continue;
    }

    const convergenceResult = detectConvergence({
      geography: geoId,
      raw_signals: geoSignals,
      as_of: config.as_of,
      time_window_ms: config.time_window_ms,
      temporal_bucket_ms: config.temporal_bucket_ms,
      total_signals_all_geographies: deduplicatedAll.length,
      geography_registry: registry,
    });

    const convergenceDetected = convergenceResult.poisson.status === 'resolved'
      && convergenceResult.poisson.z_score !== null
      && convergenceResult.poisson.z_score >= config.z_score_threshold;

    const receipt = generateProvenanceReceipt({
      run_key: runKey,
      geography_id: geoId,
      equation_id: 'poisson_z_score',
      as_of: config.as_of,
      config,
      raw_population: allSignals,
      deduplicated_population: deduplicatedAll,
      geography_registry: registry,
      expected_count: convergenceResult.poisson.expected_count,
      observed_count: convergenceResult.poisson.observed_count,
      computed_outputs: convergenceResult,
    });

    replayReceipts.push({
      ...receipt,
      z_score: convergenceResult.poisson.z_score,
      convergence_detected: convergenceDetected,
      status: convergenceResult.poisson.status,
      reason_unresolved: convergenceResult.poisson.reason_unresolved || null,
    });
    replayResults.push(convergenceResult);
  }

  // Build complete replay output
  const replayOutput = {
    run_key: runKey,
    engine_version: ENGINE_VERSION,
    as_of: config.as_of,
    config,
    geography_registry_version: registry.version,
    rule_manifest_hash: sha256(ENGINE_EQUATIONS),
    total_signals_raw: allSignals.length,
    total_signals_deduplicated: deduplicatedAll.length,
    total_geographies: geographiesToAnalyze.length,
    transform_errors: 0,
    receipts: replayReceipts,
    results: replayResults,
  };
  const replayOutputHash = sha256(replayOutput);

  // Compare to original
  const consistent = replayOutputHash === resultPayload.output_hash;

  return {
    status: 'completed',
    consistent,
    run_key: runKey,
    original_output_hash: resultPayload.output_hash,
    replay_output_hash: replayOutputHash,
    receipt_count: replayReceipts.length,
    reason: consistent ? null : 'output_hash mismatch — non-deterministic computation or snapshot mutation',
  };
}
