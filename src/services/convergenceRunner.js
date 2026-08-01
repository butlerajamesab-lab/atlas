import {
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
import { loadWashingtonGeography } from '../substrate/geographyLoader.js';
import {
  normalizeGeographyId,
  resolveGeography,
  toRuntimeRegistry,
} from '../substrate/geography.js';

const SOURCE_PAGE_SIZE = 1000;
const EQUATION_ID = 'poisson_z_score';

function requireFinite(value, name) {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
}

function requirePositive(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`);
}

function readConfidence(row) {
  const candidates = [
    row?.payload?.confidence_score,
    row?.payload?.confidence,
    row?.provenance?.confidence,
  ];
  const value = candidates.find((candidate) => candidate !== null && candidate !== undefined);
  if (value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('declared confidence must be a finite number in [0,1]');
  }
  return value;
}

export function transformSignalEventDetailed(row, geographyRecords, analysisLevel) {
  if (!row || typeof row !== 'object') return { signal: null, reason: 'invalid_source_row' };
  for (const field of ['stream_id', 'offset', 'signal_type', 'timestamp', 'event_identity_hash']) {
    if (row[field] === null || row[field] === undefined || row[field] === '') {
      return { signal: null, reason: `missing_${field}` };
    }
  }

  const temporalCoordinate = new Date(row.timestamp).getTime();
  if (!Number.isFinite(temporalCoordinate)) return { signal: null, reason: 'invalid_timestamp' };

  const rawGeography = row.jurisdiction_id
    ?? row.spacetime?.jurisdiction_id
    ?? row.spacetime?.state
    ?? null;
  const resolvedGeography = resolveGeography(rawGeography, geographyRecords);
  if (!resolvedGeography) return { signal: null, reason: 'unresolved_geography' };
  const geographyRecord = geographyRecords.find(
    (record) => normalizeGeographyId(record.jurisdiction_id) === resolvedGeography,
  );
  if (!geographyRecord || geographyRecord.level !== analysisLevel) {
    return { signal: null, reason: 'geography_level_mismatch' };
  }

  let confidence;
  try {
    confidence = readConfidence(row);
  } catch {
    return { signal: null, reason: 'invalid_confidence' };
  }

  return {
    signal: {
      id: String(row.event_identity_hash),
      signal_type: String(row.signal_type),
      spatial_coordinate: resolvedGeography,
      temporal_coordinate: temporalCoordinate,
      confidence,
      characteristics: {
        source_id: row.source_id ?? null,
        module_hint: row.module_hint ?? null,
        spacetime: row.spacetime ?? {},
        provenance: row.provenance ?? {},
        payload: row.payload ?? {},
      },
      source_event: {
        stream_id: String(row.stream_id),
        offset: String(row.offset),
        event_identity_hash: String(row.event_identity_hash),
      },
    },
    reason: null,
  };
}

export function transformSignalEvent(
  row,
  geographyRecords = loadWashingtonGeography().records,
  analysisLevel = 'state',
) {
  return transformSignalEventDetailed(row, geographyRecords, analysisLevel).signal;
}

function normalizePage(data) {
  if (!Array.isArray(data)) throw new Error('source population RPC returned a non-array response');
  return data.map((entry) => entry?.row_json ?? entry);
}

export async function loadSourcePopulation(
  supabase,
  { as_of, time_window_ms, page_size = SOURCE_PAGE_SIZE },
) {
  requireFinite(as_of, 'as_of');
  requirePositive(time_window_ms, 'time_window_ms');
  if (!Number.isInteger(page_size) || page_size < 1 || page_size > 1000) {
    throw new Error('page_size must be an integer in [1,1000]');
  }

  const fromTimestamp = new Date(as_of - time_window_ms).toISOString();
  const toTimestamp = new Date(as_of).toISOString();
  const rows = [];
  let afterStreamId = null;
  let afterOffset = null;

  for (let pageNumber = 0; pageNumber < 100000; pageNumber += 1) {
    const { data, error } = await supabase.rpc('atlas_convergence_source_population_page_v1', {
      p_from_timestamp: fromTimestamp,
      p_to_timestamp: toTimestamp,
      p_after_stream_id: afterStreamId,
      p_after_offset: afterOffset,
      p_limit: page_size,
    });
    if (error) throw new Error(`Failed to load canonical source population: ${error.message}`);
    const page = normalizePage(data ?? []);
    if (page.length === 0) break;

    for (const row of page) {
      if (!row.event_identity_hash) throw new Error('canonical population row is missing event_identity_hash');
      rows.push(row);
    }

    const last = page.at(-1);
    const nextStream = String(last.stream_id);
    const nextOffset = String(last.offset);
    if (nextStream === afterStreamId && nextOffset === afterOffset) {
      throw new Error('source population pagination cursor did not advance');
    }
    afterStreamId = nextStream;
    afterOffset = nextOffset;
    if (page.length < page_size) break;
  }

  rows.sort((left, right) => {
    const streamComparison = String(left.stream_id).localeCompare(String(right.stream_id));
    if (streamComparison !== 0) return streamComparison;
    const leftOffset = BigInt(String(left.offset));
    const rightOffset = BigInt(String(right.offset));
    return leftOffset < rightOffset ? -1 : leftOffset > rightOffset ? 1 : 0;
  });

  const uniqueKeys = new Set();
  for (const row of rows) {
    const key = `${row.stream_id}:${row.offset}`;
    if (uniqueKeys.has(key)) throw new Error(`duplicate canonical source row ${key}`);
    uniqueKeys.add(key);
  }
  return { rows, total_count: rows.length };
}

function validateGovernedConfiguration(configuration) {
  requireFinite(configuration.as_of, 'as_of');
  requirePositive(configuration.time_window_ms, 'time_window_ms');
  requirePositive(configuration.temporal_bucket_ms, 'temporal_bucket_ms');
  if (!Number.isInteger(configuration.min_signals_for_analysis)
      || configuration.min_signals_for_analysis < 0) {
    throw new Error('min_signals_for_analysis must be a non-negative integer');
  }
  requireFinite(configuration.z_score_threshold, 'z_score_threshold');
  if (typeof configuration.analysis_level !== 'string' || configuration.analysis_level.length === 0) {
    throw new Error('analysis_level is required');
  }
  if (typeof configuration.persist !== 'boolean') throw new Error('persist must be explicit boolean');
}

function normalizeTargets(targetGeographies, geographyPackage, registry) {
  const allowed = new Set(registry.entries.map((entry) => entry.id));
  if (targetGeographies === null) return [...allowed].sort();
  if (!Array.isArray(targetGeographies) || targetGeographies.length === 0) {
    throw new Error('target_geographies must be null or a non-empty array');
  }
  const resolved = targetGeographies.map((value) => {
    const geography = resolveGeography(value, geographyPackage.records);
    if (!geography || !allowed.has(geography)) {
      throw new Error(`target geography '${value}' is not in the governed analysis registry`);
    }
    return geography;
  });
  return [...new Set(resolved)].sort();
}

export function buildConvergenceComputation({
  source_population,
  geography_package,
  configuration,
  target_geographies = null,
}) {
  validateGovernedConfiguration(configuration);
  if (!Array.isArray(source_population)) throw new Error('source_population must be an array');
  if (geography_package.registry_hash !== configuration.geography_registry_version) {
    throw new Error('geography_registry_version does not match the loaded immutable registry hash');
  }

  const registry = toRuntimeRegistry(
    geography_package.records,
    geography_package.registry_hash,
    configuration.analysis_level,
  );
  const analysisRegistryHash = sha256(registry);
  const ruleManifestHash = sha256(ENGINE_EQUATIONS);
  const sourcePopulation = [...source_population].sort((left, right) => {
    const streamComparison = String(left.stream_id).localeCompare(String(right.stream_id));
    if (streamComparison !== 0) return streamComparison;
    const leftOffset = BigInt(String(left.offset));
    const rightOffset = BigInt(String(right.offset));
    return leftOffset < rightOffset ? -1 : leftOffset > rightOffset ? 1 : 0;
  });
  const sourcePopulationHash = sha256(sourcePopulation);

  const transformedSignals = [];
  const transformErrors = [];
  for (const row of sourcePopulation) {
    const transformed = transformSignalEventDetailed(
      row,
      geography_package.records,
      configuration.analysis_level,
    );
    if (transformed.signal) transformedSignals.push(transformed.signal);
    else transformErrors.push({
      stream_id: String(row.stream_id),
      offset: String(row.offset),
      event_identity_hash: row.event_identity_hash ?? null,
      reason: transformed.reason,
    });
  }
  transformedSignals.sort((left, right) => left.id.localeCompare(right.id));
  transformErrors.sort((left, right) => {
    const streamComparison = left.stream_id.localeCompare(right.stream_id);
    if (streamComparison !== 0) return streamComparison;
    const leftOffset = BigInt(left.offset);
    const rightOffset = BigInt(right.offset);
    return leftOffset < rightOffset ? -1 : leftOffset > rightOffset ? 1 : 0;
  });
  const deduplicatedSignals = deduplicateSignals(
    transformedSignals,
    configuration.temporal_bucket_ms,
  );

  const normalizedConfiguration = Object.freeze({
    as_of: configuration.as_of,
    time_window_ms: configuration.time_window_ms,
    temporal_bucket_ms: configuration.temporal_bucket_ms,
    geography_registry_version: configuration.geography_registry_version,
    analysis_registry_hash: analysisRegistryHash,
    analysis_level: configuration.analysis_level,
    min_signals_for_analysis: configuration.min_signals_for_analysis,
    z_score_threshold: configuration.z_score_threshold,
    target_geographies: target_geographies === null ? null : [...target_geographies],
    persist: configuration.persist,
  });

  const runKey = computeRunKey({
    as_of: configuration.as_of,
    config: normalizedConfiguration,
    geography_registry_version: configuration.geography_registry_version,
    geography_registry_hash: analysisRegistryHash,
    rule_manifest_hash: ruleManifestHash,
    source_population_hash: sourcePopulationHash,
    engine_version: ENGINE_VERSION,
  });
  const geographiesToAnalyze = normalizeTargets(target_geographies, geography_package, registry);
  const byGeography = new Map();
  for (const signal of transformedSignals) {
    if (!byGeography.has(signal.spatial_coordinate)) byGeography.set(signal.spatial_coordinate, []);
    byGeography.get(signal.spatial_coordinate).push(signal);
  }

  const receipts = [];
  const results = [];
  for (const geographyId of geographiesToAnalyze) {
    const geographySignals = byGeography.get(geographyId) ?? [];
    const geographyDeduplicated = deduplicateSignals(
      geographySignals,
      configuration.temporal_bucket_ms,
    );
    let result;
    let status;
    let reasonUnresolved = null;
    let zScore = null;
    let expectedCount = null;
    let convergenceDetected = false;

    if (geographyDeduplicated.length < configuration.min_signals_for_analysis) {
      status = 'below_threshold';
      result = {
        geography: geographyId,
        raw_signal_count: geographySignals.length,
        signal_count: geographyDeduplicated.length,
        status,
        reason: `${geographyDeduplicated.length} deduplicated signals < min_signals_for_analysis (${configuration.min_signals_for_analysis})`,
      };
    } else {
      result = detectConvergence({
        geography: geographyId,
        raw_signals: geographySignals,
        as_of: configuration.as_of,
        time_window_ms: configuration.time_window_ms,
        temporal_bucket_ms: configuration.temporal_bucket_ms,
        total_signals_all_geographies: deduplicatedSignals.length,
        geography_registry: registry,
      });
      status = result.poisson.status;
      reasonUnresolved = result.poisson.reason_unresolved ?? null;
      zScore = result.poisson.z_score;
      expectedCount = result.poisson.expected_count;
      convergenceDetected = status === 'resolved'
        && zScore !== null
        && zScore >= configuration.z_score_threshold;
    }

    const receipt = generateProvenanceReceipt({
      run_key: runKey,
      geography_id: geographyId,
      equation_id: EQUATION_ID,
      as_of: configuration.as_of,
      config: normalizedConfiguration,
      source_population: sourcePopulation,
      raw_population: transformedSignals,
      deduplicated_population: deduplicatedSignals,
      geography_registry: registry,
      geography_signal_ids: geographySignals.map((signal) => signal.id),
      expected_count: expectedCount,
      observed_count: geographyDeduplicated.length,
      computed_outputs: result,
    });
    receipts.push({
      ...receipt,
      status,
      reason_unresolved: reasonUnresolved,
      z_score: zScore,
      convergence_detected: convergenceDetected,
    });
    results.push(result);
  }

  const completeOutput = {
    run_key: runKey,
    engine_version: ENGINE_VERSION,
    as_of: configuration.as_of,
    configuration: normalizedConfiguration,
    source_population_hash: sourcePopulationHash,
    transformed_population_hash: sha256(transformedSignals),
    deduplicated_population_hash: sha256(deduplicatedSignals),
    geography_registry_version: configuration.geography_registry_version,
    analysis_registry_hash: analysisRegistryHash,
    rule_manifest_hash: ruleManifestHash,
    total_source_rows: sourcePopulation.length,
    total_signals_raw: transformedSignals.length,
    total_signals_deduplicated: deduplicatedSignals.length,
    total_geographies: geographiesToAnalyze.length,
    transform_errors: transformErrors,
    receipts,
    results,
  };
  const outputHash = sha256(completeOutput);

  return {
    run_key: runKey,
    engine_version: ENGINE_VERSION,
    as_of: configuration.as_of,
    output_hash: outputHash,
    configuration: normalizedConfiguration,
    rule_manifest_hash: ruleManifestHash,
    source_population: sourcePopulation,
    source_population_hash: sourcePopulationHash,
    transformed_signals: transformedSignals,
    deduplicated_signals: deduplicatedSignals,
    transform_errors: transformErrors,
    geography_registry: registry,
    analysis_registry_hash: analysisRegistryHash,
    geography_package,
    receipts,
    results,
    complete_output: completeOutput,
  };
}

function persistenceBundle(computation) {
  return {
    bundle_version: 'atlas_convergence_persistence.v2.1.0',
    registry: {
      registry_hash: computation.analysis_registry_hash,
      registry_version: computation.geography_package.registry_hash,
      jurisdiction: computation.geography_package.jurisdiction,
      analysis_level: computation.configuration.analysis_level,
      source_id: computation.geography_package.source_id,
      source_version: computation.geography_package.source_version ?? null,
      source_url: computation.geography_package.source_url ?? null,
      entries_json: computation.geography_registry,
      provenance_records: computation.geography_package.records,
    },
    manifest: {
      run_key: computation.run_key,
      engine_version: computation.engine_version,
      as_of: computation.as_of,
      time_window_ms: computation.configuration.time_window_ms,
      temporal_bucket_ms: computation.configuration.temporal_bucket_ms,
      geography_registry_version: computation.configuration.geography_registry_version,
      analysis_registry_hash: computation.analysis_registry_hash,
      analysis_level: computation.configuration.analysis_level,
      rule_manifest_hash: computation.rule_manifest_hash,
      configuration_hash: sha256(computation.configuration),
      configuration_json: computation.configuration,
      source_population_hash: computation.source_population_hash,
      transformed_population_hash: sha256(computation.transformed_signals),
      deduplicated_population_hash: sha256(computation.deduplicated_signals),
      total_source_rows: computation.source_population.length,
      total_signals_raw: computation.transformed_signals.length,
      total_signals_deduplicated: computation.deduplicated_signals.length,
      total_geographies: computation.receipts.length,
      receipt_count: computation.receipts.length,
      output_hash: computation.output_hash,
    },
    snapshots: [
      { snapshot_type: 'source', population_hash: computation.source_population_hash, records: computation.source_population },
      { snapshot_type: 'transformed', population_hash: sha256(computation.transformed_signals), records: computation.transformed_signals },
      { snapshot_type: 'deduplicated', population_hash: sha256(computation.deduplicated_signals), records: computation.deduplicated_signals },
    ],
    receipts: computation.receipts,
    result: {
      output_hash: computation.output_hash,
      payload_json: computation.complete_output,
      receipt_count: computation.receipts.length,
    },
  };
}

async function persistComputation(supabase, computation) {
  const { data, error } = await supabase.rpc('atlas_convergence_persist_run_v1', {
    p_bundle: persistenceBundle(computation),
  });
  if (error) throw new Error(`Failed to persist convergence run atomically: ${error.message}`);
  if (!data || !['created', 'idempotent'].includes(data.status)) {
    throw new Error('Convergence persistence returned no governed receipt');
  }
  return data;
}

export async function executeConvergenceRun({
  supabase,
  as_of,
  time_window_ms,
  temporal_bucket_ms,
  geography_registry_version,
  analysis_level,
  min_signals_for_analysis,
  z_score_threshold,
  target_geographies,
  persist,
}) {
  if (!supabase) throw new Error('supabase client is required');
  const configuration = {
    as_of,
    time_window_ms,
    temporal_bucket_ms,
    geography_registry_version,
    analysis_level,
    min_signals_for_analysis,
    z_score_threshold,
    persist,
  };
  validateGovernedConfiguration(configuration);
  const geographyPackage = loadWashingtonGeography();
  const { rows } = await loadSourcePopulation(supabase, { as_of, time_window_ms });
  const computation = buildConvergenceComputation({
    source_population: rows,
    geography_package: geographyPackage,
    configuration,
    target_geographies,
  });
  const persistence = persist ? await persistComputation(supabase, computation) : null;
  return {
    run_key: computation.run_key,
    engine_version: computation.engine_version,
    as_of: computation.as_of,
    output_hash: computation.output_hash,
    source_population_hash: computation.source_population_hash,
    total_source_rows: computation.source_population.length,
    total_signals_raw: computation.transformed_signals.length,
    total_signals_deduplicated: computation.deduplicated_signals.length,
    total_geographies: computation.receipts.length,
    transform_errors: computation.transform_errors,
    receipts: computation.receipts,
    results: computation.results,
    persistence,
    complete_output: computation.complete_output,
  };
}

export async function getConvergenceRunStatus(supabase, runKey) {
  const { data, error } = await supabase.rpc('atlas_convergence_get_run_v1', {
    p_run_key: runKey,
  });
  if (error) throw new Error(`Failed to load convergence run: ${error.message}`);
  if (!data) throw new Error(`Run ${runKey} not found`);
  return data;
}

export async function replayConvergenceRun(supabase, runKey) {
  const { data: bundle, error } = await supabase.rpc('atlas_convergence_get_replay_bundle_v1', {
    p_run_key: runKey,
  });
  if (error) throw new Error(`Failed to load replay bundle: ${error.message}`);
  if (!bundle?.manifest || !bundle?.registry || !Array.isArray(bundle?.snapshots)) {
    throw new Error(`Run ${runKey} has no complete replay bundle`);
  }
  if (bundle.manifest.engine_version !== ENGINE_VERSION) {
    throw new Error(`Replay engine version mismatch: stored ${bundle.manifest.engine_version}, runtime ${ENGINE_VERSION}`);
  }
  const sourceSnapshot = bundle.snapshots.find((snapshot) => snapshot.snapshot_type === 'source');
  if (!sourceSnapshot) throw new Error('Replay bundle is missing source snapshot');
  if (sha256(sourceSnapshot.records) !== sourceSnapshot.population_hash) {
    throw new Error('Replay source snapshot hash mismatch');
  }
  const geographyPackage = {
    jurisdiction: bundle.registry.jurisdiction,
    source_id: bundle.registry.source_id,
    source_version: bundle.registry.source_version,
    source_url: bundle.registry.source_url,
    registry_hash: bundle.manifest.geography_registry_version,
    records: bundle.registry.provenance_records,
  };
  const configuration = {
    ...bundle.manifest.configuration_json,
    persist: true,
  };
  const replay = buildConvergenceComputation({
    source_population: sourceSnapshot.records,
    geography_package: geographyPackage,
    configuration,
    target_geographies: configuration.target_geographies,
  });
  const storedReceiptIdentities = [...bundle.receipts]
    .map((receipt) => `${receipt.geography_id}:${receipt.receipt_identity}`)
    .sort();
  const replayReceiptIdentities = replay.receipts
    .map((receipt) => `${receipt.geography_id}:${receipt.receipt_identity}`)
    .sort();
  const consistent = replay.run_key === runKey
    && replay.output_hash === bundle.result.output_hash
    && sha256(storedReceiptIdentities) === sha256(replayReceiptIdentities);
  return {
    status: 'completed',
    consistent,
    run_key: runKey,
    original_output_hash: bundle.result.output_hash,
    replay_output_hash: replay.output_hash,
    original_receipt_manifest_hash: sha256(storedReceiptIdentities),
    replay_receipt_manifest_hash: sha256(replayReceiptIdentities),
    receipt_count: replay.receipts.length,
    reason: consistent ? null : 'run key, output hash, or receipt identity mismatch',
  };
}
