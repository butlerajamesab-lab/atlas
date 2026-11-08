import crypto from 'crypto';
import {
  accumulatePopulationEvent,
  CONFIDENCE_SEMANTICS,
  createPopulationAccumulator,
  DOMAIN3_POPULATION_RULES,
  deriveDomain3PopulationCandidates,
  entityKeyOf,
  entityOf,
  EVIDENCE_SAMPLING,
  finalizePopulationCandidates,
  jurisdictionOf,
  mostFrequentFromCounts,
  sampleSourceRefs,
} from './domain3PopulationDetectorService.js';
import {
  accumulateIntegrityEvent,
  createIntegrityAccumulator,
  INTEGRITY_PATTERN_RULES,
  deriveIntegrityPatternCandidates,
  deriveIntegrityPatternCandidatesFromInput,
  summarizeIntegrityPatternReadiness,
  summarizeIntegrityPatternReadinessFromInput,
} from './integrityPatternDetectorService.js';

// Bump whenever derivation code changes in a way that can change outputs
// without changing a rule contract; part of the no-change watermark key.
const DERIVATION_BUILD = '2026-11-08-fullset-v1';

const ENGINE_ID = 'atlas.domain3_population_exact';
const ENGINE_VERSION = '1.1.0';
const DEFAULT_OBSERVATION_LIMIT = 100000;
const DEFAULT_CANDIDATE_LIMIT_PER_RULE = 250;
const SOURCE_REF_LIMIT = 25;

const CROSS_JURISDICTION_RULE = Object.freeze({
  rule_id: 'atlas.domain3.cross_jurisdiction_recurrence',
  rule_version: '1.0.0',
  signal_type: 'cross_jurisdiction_recurrence',
  rule_contract: {
    domain: 3,
    detector: 'cross_jurisdiction_recurrence',
    minimum_records: 10,
    minimum_jurisdictions: 2,
    entity_grouping: 'declared_normalized_name_key_not_identity',
    entity_resolution: 'candidate remains unverified until exact entity resolution succeeds',
    confidence: CONFIDENCE_SEMANTICS,
    evidence_sampling: EVIDENCE_SAMPLING,
    interpretation_boundary: 'cross-jurisdiction repeat-appearance observation; not misconduct, causation, or legal finding',
  },
});

const RULES = Object.freeze([
  ...DOMAIN3_POPULATION_RULES.map((rule) => ({
    ...rule,
    rule_contract: {
      ...rule.rule_contract,
      replay_scope: 'complete_identity_bound_observation_population',
    },
  })),
  CROSS_JURISDICTION_RULE,
  ...INTEGRITY_PATTERN_RULES.map((rule) => ({
    ...rule,
    rule_contract: {
      ...rule.rule_contract,
      replay_scope: 'complete_identity_bound_observation_population',
    },
  })),
]);

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function sourceRef(event) {
  return {
    stream_id: event.stream_id,
    offset: Number(event.offset),
    event_identity_hash: event.event_identity_hash || null,
  };
}

function deriveCrossJurisdictionCandidates(events) {
  const byEntity = new Map();
  for (const event of events) {
    const key = entityKeyOf(event);
    if (!key) continue;
    if (!byEntity.has(key)) byEntity.set(key, []);
    byEntity.get(key).push(event);
  }

  const candidates = [];
  for (const [key, rows] of byEntity) {
    const jurisdictions = [...new Set(rows.map(jurisdictionOf).filter((value) => value && value !== 'unknown'))].sort();
    if (rows.length < 10 || jurisdictions.length < 2) continue;
    const streams = [...new Set(rows.map((row) => row.stream_id))].sort();
    const nameCounts = new Map();
    for (const row of rows) {
      const name = entityOf(row);
      if (name) nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
    }
    let entity = key;
    let bestCount = -1;
    for (const [name, count] of nameCounts) {
      if (count > bestCount || (count === bestCount && name < entity)) {
        entity = name;
        bestCount = count;
      }
    }
    const refs = sampleSourceRefs(rows);
    const sourceFreshness = rows.reduce((latest, row) => {
      const value = new Date(row.timestamp || row.ingested_at || 0).getTime();
      return Number.isFinite(value) && value > latest ? value : latest;
    }, 0);
    const factors = [
      { factor_id: 'recurrence_minimum', weight: 0.3, satisfied: true, explanation: `Appears in ${rows.length} observations across ${jurisdictions.length} jurisdictions (declared minimums 10 and 2).` },
      { factor_id: 'wide_recurrence', weight: 0.2, satisfied: jurisdictions.length >= 4, explanation: jurisdictions.length >= 4 ? 'Recurs across at least four jurisdictions.' : 'Recurs across fewer than four jurisdictions.' },
      { factor_id: 'volume', weight: 0.2, satisfied: rows.length >= 50, explanation: `${rows.length} observations in the pattern (declared full-volume mark 50).` },
      { factor_id: 'exact_entity_resolution', weight: 0.3, satisfied: false, explanation: 'Grouping uses a declared normalized name key; exact entity resolution has not succeeded, so this factor is not satisfied and the score is capped until it does.' },
    ];
    const confidence = factors.reduce((sum, factor) => sum + (factor.satisfied ? factor.weight : 0), 0);
    const statistics = {
      records_analyzed: events.length,
      pattern_count: rows.length,
      jurisdiction_count: jurisdictions.length,
      jurisdictions,
      streams,
      entity_name: entity,
      entity_key: key,
      confidence_factors: factors,
      confidence_semantics: CONFIDENCE_SEMANTICS,
      evidence_sampling: EVIDENCE_SAMPLING,
      evidence_ref_count: refs.length,
    };
    const sourceInputHash = stableHash({ rule_id: CROSS_JURISDICTION_RULE.rule_id, refs, statistics });
    const candidateHash = stableHash({
      rule_id: CROSS_JURISDICTION_RULE.rule_id,
      entity,
      jurisdictions,
      source_input_hash: sourceInputHash,
    });
    const severity = jurisdictions.length >= 8 ? 'high' : 'medium';

    candidates.push({
      candidate_hash: candidateHash,
      rule_id: CROSS_JURISDICTION_RULE.rule_id,
      rule_version: CROSS_JURISDICTION_RULE.rule_version,
      engine_id: ENGINE_ID,
      engine_version: ENGINE_VERSION,
      signal_type: CROSS_JURISDICTION_RULE.signal_type,
      title: `Cross-jurisdiction recurrence: ${entity}`,
      description: `${entity} appears in ${rows.length} observations across ${jurisdictions.length} governed jurisdictions. Grouping uses a declared normalized name key, not resolved identity. This is a recurrence observation, not a finding of wrongdoing.`,
      primary_stream_id: streams[0] || 'unknown',
      source_event_refs: refs,
      entity_ids: [],
      entity_resolution_status: 'unresolved_exact_match_required',
      jurisdiction_id: 'multi_jurisdiction',
      severity,
      confidence_score: Number(confidence.toFixed(6)),
      verification_state: 'unverified',
      supporting_statistics: statistics,
      evidence_refs: refs,
      source_freshness_at: new Date(sourceFreshness || Date.now()).toISOString(),
      detected_at: new Date().toISOString(),
      source_input_hash: sourceInputHash,
    });
  }
  return candidates.sort((a, b) => a.candidate_hash.localeCompare(b.candidate_hash));
}

// Page reads cross Cloudflare to PostgREST; a truncated body or a
// 520 surfaces as a JSON SyntaxError or a 5xx error on ONE page.
// Range paging is stateless, so a page is safe to re-read: retry
// transient failures per page with backoff instead of killing a
// full-set derivation that may already be hundreds of pages in
// (first observed live 2026-11-08, when a truncated ~2 MB page
// failed the verification job while the origin shed 520s).
// Non-transient errors (auth, missing table, bad query) fail fast.
const TRANSIENT_READ_PATTERNS = [
  /unterminated string/i,
  /unexpected end of json/i,
  /syntaxerror/i,
  /fetch failed/i,
  /socket/i,
  /ECONNRESET/,
  /ETIMEDOUT/,
  /timeout/i,
  /network/i,
  /<!doctype html/i,
  /web server is down/i,
  /cloudflare/i,
  /\b429\b/,
  /\b52\d\b/,
  /\b502\b/,
  /\b503\b/,
  /\b504\b/,
  /status=5\d\d/,
];

export function isTransientObservationReadError(error) {
  const message = String(error?.message || error || '');
  return TRANSIENT_READ_PATTERNS.some((pattern) => pattern.test(message));
}

const observationReadSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function readObservationPage(atlasClient, from, to, {
  attempts = 5,
  baseDelayMs = 2_000,
  maxDelayMs = 30_000,
  sleepFn = observationReadSleep,
} = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const { data, error } = await atlasClient
        .from('signal_events')
        .select('stream_id,offset,timestamp,signal_type,spacetime,provenance,payload,source_id,jurisdiction_id,module_hint,ingested_at,event_identity_hash')
        .not('event_identity_hash', 'is', null)
        .order('stream_id', { ascending: true })
        .order('offset', { ascending: true })
        .range(from, to);
      if (error) throw error;
      return data || [];
    } catch (error) {
      lastError = error;
      if (!isTransientObservationReadError(error) || attempt === attempts) break;
      await sleepFn(Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs));
    }
  }
  throw new Error(`Domain 3 full replay observation read failed: ${lastError?.message || lastError}`);
}

async function loadCanonicalObservations(atlasClient, limit) {
  const bounded = Math.min(100000, Math.max(1, Number(limit) || DEFAULT_OBSERVATION_LIMIT));
  const readLimit = bounded + 1;
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; from < readLimit; from += pageSize) {
    const to = Math.min(from + pageSize - 1, readLimit - 1);
    const data = await readObservationPage(atlasClient, from, to);
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return {
    observations: rows.slice(0, bounded),
    complete: rows.length <= bounded,
  };
}

function materializeRuleRows() {
  return RULES.map((rule) => {
    const engineId = rule.engine_id || ENGINE_ID;
    const engineVersion = rule.engine_version || ENGINE_VERSION;
    const ruleContract = {
      ...rule.rule_contract,
      engine_id: engineId,
      engine_version: engineVersion,
    };
    return {
      rule_id: rule.rule_id,
      rule_version: rule.rule_version,
      signal_type: rule.signal_type,
      engine_id: engineId,
      engine_version: engineVersion,
      rule_contract: ruleContract,
      rule_contract_hash: stableHash(ruleContract),
      is_active: true,
    };
  });
}

async function ensureRules(atlasClient) {
  const rows = materializeRuleRows();
  const { data, error } = await atlasClient.rpc('register_domain3_population_rules_v1', {
    p_rules: rows,
  });
  if (error) throw new Error(`Domain 3 rule registration failed: ${error.message}`);
  if (!data || Number(data.rules_registered ?? 0) !== rows.length) {
    throw new Error(`Domain 3 rule registration returned an invalid receipt: ${JSON.stringify(data ?? null)}`);
  }
  return new Map(rows.map((row) => [row.rule_id, row]));
}

async function persistRuleRun({ atlasClient, rule, observationsScanned, candidates, runId = crypto.randomUUID() }) {
  const { data, error } = await atlasClient.rpc('persist_domain3_population_run_v1', {
    p_rule: rule,
    p_run_id: runId,
    p_observations_scanned: observationsScanned,
    p_candidates: candidates,
  });
  if (error) throw new Error(`Domain 3 persistence failed for ${rule.rule_id}: ${error.message}`);
  if (!data || data.status !== 'completed' || data.run_id !== runId) {
    throw new Error(`Domain 3 persistence returned an invalid receipt for ${rule.rule_id}: ${JSON.stringify(data ?? null)}`);
  }
  return {
    run_id: runId,
    rule_id: rule.rule_id,
    candidates_produced: Number(data.candidates_produced ?? 0),
    candidates_inserted: Number(data.candidates_inserted ?? 0),
    candidates_replayed: Number(data.candidates_replayed ?? 0),
  };
}

async function reconcileRuleCurrentness({ atlasClient, rule, runId, candidates, replayComplete }) {
  const { data, error } = await atlasClient.rpc('reconcile_domain3_population_currentness_v1', {
    p_rule_id: rule.rule_id,
    p_rule_version: rule.rule_version,
    p_run_id: runId,
    p_current_candidate_hashes: candidates.map((candidate) => candidate.candidate_hash),
    p_replay_complete: replayComplete,
  });
  if (error) throw new Error(`Domain 3 currentness reconciliation failed for ${rule.rule_id}: ${error.message}`);
  if (!data || !['completed', 'skipped'].includes(data.status)) {
    throw new Error(`Domain 3 currentness reconciliation returned an invalid receipt for ${rule.rule_id}: ${JSON.stringify(data ?? null)}`);
  }
  return data;
}

export async function executeDomain3FullReplay({
  atlasClient,
  candidateChunkSize = 250,
} = {}) {
  if (!atlasClient) throw new Error('atlasClient is required');

  const rules = await ensureRules(atlasClient);
  const boundedChunk = Math.min(1000, Math.max(1, Number(candidateChunkSize) || 250));
  const ruleSetHash = stableHash(materializeRuleRows().map((row) => [row.rule_id, row.rule_version, row.rule_contract_hash]));

  // Change trigger: if the reservoir watermark, the rule set, and the
  // derivation build all match the last fully successful derivation, the
  // derivation is provably a no-op (Y = F_v(X, R); X and R unchanged) and
  // is skipped. The caller still drains the recorded runs' bridging.
  const state = await readDerivationState(atlasClient);
  const currentWatermark = await queryReservoirWatermark(atlasClient);
  if (state
    && state.build === DERIVATION_BUILD
    && state.rule_set_hash === ruleSetHash
    && stableHash(state.watermark || {}) === stableHash(currentWatermark)) {
    return {
      status: 'skipped_no_change',
      engine_id: ENGINE_ID,
      engine_version: ENGINE_VERSION,
      replay_scope: 'complete_identity_bound_observation_population',
      observations_scanned: 0,
      observation_scan_complete: true,
      candidates_derived: 0,
      candidates_persisted: 0,
      candidate_limit_per_rule: null,
      rules_registered: rules.size,
      integrity_candidates_derived: 0,
      integrity_readiness: null,
      rule_errors: [],
      rule_warnings: [],
      runs: [],
      last_run_ids: Array.isArray(state.last_run_ids) ? state.last_run_ids : [],
      watermark: currentWatermark,
    };
  }

  const populationAcc = createPopulationAccumulator();
  const integrityAcc = createIntegrityAccumulator();
  const seenWatermark = {};
  let seenTotal = 0;
  const seenKeys = new Set();
  const observationsScanned = await streamCanonicalObservations(atlasClient, (event) => {
    // Range paging over a growing, append-only set can re-read a boundary
    // row when appends shift page indices; derivation input is an
    // identity-bound set, so exact (stream_id, offset) repeats are fed once.
    const key = `${event.stream_id}\u0000${event.offset}`;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    accumulatePopulationEvent(populationAcc, event);
    accumulateIntegrityEvent(integrityAcc, event);
    const entry = seenWatermark[event.stream_id] || [0, null];
    entry[0] += 1;
    const offset = Number(event.offset);
    if (Number.isFinite(offset) && (entry[1] === null || offset > entry[1])) entry[1] = offset;
    seenWatermark[event.stream_id] = entry;
    seenTotal += 1;
  });
  void observationsScanned;
  const seenWatermarkSorted = Object.fromEntries(
    Object.entries(seenWatermark).sort(([a], [b]) => a.localeCompare(b)),
  );
  seenWatermarkSorted.__total = seenTotal;

  const baseCandidates = finalizePopulationCandidates(populationAcc).map((candidate) => ({
    ...candidate,
    engine_id: ENGINE_ID,
    engine_version: ENGINE_VERSION,
  }));
  const crossJurisdictionCandidates = finalizeCrossJurisdictionCandidates(populationAcc);
  const integrityCandidates = deriveIntegrityPatternCandidatesFromInput(integrityAcc.input);
  const integrityReadiness = summarizeIntegrityPatternReadinessFromInput(integrityAcc.input, integrityAcc.scanned);
  const allCandidates = [...baseCandidates, ...crossJurisdictionCandidates, ...integrityCandidates]
    .sort((a, b) => a.rule_id.localeCompare(b.rule_id) || a.candidate_hash.localeCompare(b.candidate_hash));
  const runs = [];
  const ruleErrors = [];
  const ruleWarnings = [];
  let persisted = 0;

  for (const rule of rules.values()) {
    const ruleCandidates = allCandidates.filter((candidate) => candidate.rule_id === rule.rule_id);
    try {
      const runId = crypto.randomUUID();
      let produced = 0;
      let inserted = 0;
      let replayed = 0;
      for (let from = 0; from < Math.max(ruleCandidates.length, 1); from += boundedChunk) {
        const chunk = ruleCandidates.slice(from, from + boundedChunk);
        const part = await persistRuleRun({
          atlasClient,
          rule,
          observationsScanned: seenTotal,
          candidates: chunk,
          runId,
        });
        produced += part.candidates_produced;
        inserted += part.candidates_inserted;
        replayed += part.candidates_replayed;
        if (!chunk.length) break;
      }
      persisted += ruleCandidates.length;

      let currentness;
      try {
        currentness = await reconcileRuleCurrentness({
          atlasClient,
          rule,
          runId,
          candidates: ruleCandidates,
          replayComplete: true,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        ruleErrors.push({ rule_id: rule.rule_id, phase: 'currentness_reconciliation', error: errorMessage });
        currentness = { status: 'failed', error: errorMessage, retired: 0 };
      }

      runs.push({
        run_id: runId,
        rule_id: rule.rule_id,
        candidates_produced: produced,
        candidates_inserted: inserted,
        candidates_replayed: replayed,
        status: currentness.status === 'failed' ? 'partial' : 'completed',
        candidates_derived: ruleCandidates.length,
        replay_complete: true,
        currentness,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      ruleErrors.push({
        rule_id: rule.rule_id,
        phase: 'persistence',
        candidates_derived: ruleCandidates.length,
        error: errorMessage,
      });
      runs.push({
        run_id: null,
        rule_id: rule.rule_id,
        status: 'failed',
        candidates_derived: ruleCandidates.length,
        candidates_produced: 0,
        candidates_inserted: 0,
        candidates_replayed: 0,
        replay_complete: true,
        error: errorMessage,
      });
    }
  }

  // The watermark advances only on a fully successful derivation;
  // a partial run leaves it stale so the next cycle redoes the work.
  let stateError = null;
  if (!ruleErrors.length) {
    try {
      await writeDerivationState(atlasClient, {
        watermark: seenWatermarkSorted,
        rule_set_hash: ruleSetHash,
        build: DERIVATION_BUILD,
        last_run_ids: runs.map((run) => run.run_id).filter(Boolean),
      });
    } catch (error) {
      stateError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    status: ruleErrors.length || ruleWarnings.length ? 'partial' : 'completed',
    engine_id: ENGINE_ID,
    engine_version: ENGINE_VERSION,
    replay_scope: 'complete_identity_bound_observation_population',
    observations_scanned: seenTotal,
    observation_scan_complete: true,
    candidates_derived: allCandidates.length,
    candidates_persisted: persisted,
    candidate_limit_per_rule: null,
    rules_registered: rules.size,
    integrity_candidates_derived: integrityCandidates.length,
    integrity_readiness: integrityReadiness,
    rule_errors: ruleErrors,
    rule_warnings: ruleWarnings,
    runs,
    watermark: seenWatermarkSorted,
    state_error: stateError,
  };
}

// Streams the complete identity-bound observation population in
// (stream_id, offset) order, one page at a time, with no observation cap.
// Each row is handed to onEvent and then released; accumulators retain
// only their compact state.
async function streamCanonicalObservations(atlasClient, onEvent) {
  const pageSize = 1000;
  let total = 0;
  for (let from = 0; ; from += pageSize) {
    const rows = await readObservationPage(atlasClient, from, from + pageSize - 1);
    for (const row of rows) {
      onEvent(row);
      total += 1;
    }
    if (rows.length < pageSize) break;
  }
  return total;
}

function finalizeCrossJurisdictionCandidates(acc) {
  const candidates = [];
  for (const [key, group] of acc.crossJurisdiction) {
    const jurisdictions = [...group.jurisdictions].sort();
    if (group.indexes.length < 10 || jurisdictions.length < 2) continue;
    const rows = group.indexes.map((index) => acc.stubs[index]);
    const streams = [...group.streams].sort();
    const entity = mostFrequentFromCounts(group.names) || key;
    const refs = sampleSourceRefs(rows);
    const sourceFreshness = rows.reduce((latest, row) => {
      const value = new Date(row.timestamp || row.ingested_at || 0).getTime();
      return Number.isFinite(value) && value > latest ? value : latest;
    }, 0);
    const factors = [
      { factor_id: 'recurrence_minimum', weight: 0.3, satisfied: true, explanation: `Appears in ${rows.length} observations across ${jurisdictions.length} jurisdictions (declared minimums 10 and 2).` },
      { factor_id: 'wide_recurrence', weight: 0.2, satisfied: jurisdictions.length >= 4, explanation: jurisdictions.length >= 4 ? 'Recurs across at least four jurisdictions.' : 'Recurs across fewer than four jurisdictions.' },
      { factor_id: 'volume', weight: 0.2, satisfied: rows.length >= 50, explanation: `${rows.length} observations in the pattern (declared full-volume mark 50).` },
      { factor_id: 'exact_entity_resolution', weight: 0.3, satisfied: false, explanation: 'Grouping uses a declared normalized name key; exact entity resolution has not succeeded, so this factor is not satisfied and the score is capped until it does.' },
    ];
    const confidence = factors.reduce((sum, factor) => sum + (factor.satisfied ? factor.weight : 0), 0);
    const statistics = {
      records_analyzed: acc.total,
      pattern_count: rows.length,
      jurisdiction_count: jurisdictions.length,
      jurisdictions,
      streams,
      entity_name: entity,
      entity_key: key,
      confidence_factors: factors,
      confidence_semantics: CONFIDENCE_SEMANTICS,
      evidence_sampling: EVIDENCE_SAMPLING,
      evidence_ref_count: refs.length,
    };
    const sourceInputHash = stableHash({ rule_id: CROSS_JURISDICTION_RULE.rule_id, refs, statistics });
    const candidateHash = stableHash({
      rule_id: CROSS_JURISDICTION_RULE.rule_id,
      entity,
      jurisdictions,
      source_input_hash: sourceInputHash,
    });
    const severity = jurisdictions.length >= 8 ? 'high' : 'medium';

    candidates.push({
      candidate_hash: candidateHash,
      rule_id: CROSS_JURISDICTION_RULE.rule_id,
      rule_version: CROSS_JURISDICTION_RULE.rule_version,
      engine_id: ENGINE_ID,
      engine_version: ENGINE_VERSION,
      signal_type: CROSS_JURISDICTION_RULE.signal_type,
      title: `Cross-jurisdiction recurrence: ${entity}`,
      description: `${entity} appears in ${rows.length} observations across ${jurisdictions.length} governed jurisdictions. Grouping uses a declared normalized name key, not resolved identity. This is a recurrence observation, not a finding of wrongdoing.`,
      primary_stream_id: streams[0] || 'unknown',
      source_event_refs: refs,
      entity_ids: [],
      entity_resolution_status: 'unresolved_exact_match_required',
      jurisdiction_id: 'multi_jurisdiction',
      severity,
      confidence_score: Number(confidence.toFixed(6)),
      verification_state: 'unverified',
      supporting_statistics: statistics,
      evidence_refs: refs,
      source_freshness_at: new Date(sourceFreshness || Date.now()).toISOString(),
      detected_at: new Date().toISOString(),
      source_input_hash: sourceInputHash,
    });
  }
  return candidates.sort((a, b) => a.candidate_hash.localeCompare(b.candidate_hash));
}

async function queryReservoirWatermark(atlasClient) {
  const { data: streamRows, error } = await atlasClient.from('streams').select('stream_id');
  if (error) throw new Error(`Domain 3 watermark stream read failed: ${error.message}`);
  const watermark = {};
  for (const { stream_id: streamId } of streamRows || []) {
    const countResult = await atlasClient
      .from('signal_events')
      .select('stream_id', { count: 'exact', head: true })
      .eq('stream_id', streamId)
      .not('event_identity_hash', 'is', null);
    if (countResult.error) throw new Error(`Domain 3 watermark count failed for ${streamId}: ${countResult.error.message}`);
    const maxResult = await atlasClient
      .from('signal_events')
      .select('offset')
      .eq('stream_id', streamId)
      .not('event_identity_hash', 'is', null)
      .order('offset', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (maxResult.error) throw new Error(`Domain 3 watermark max failed for ${streamId}: ${maxResult.error.message}`);
    watermark[streamId] = [countResult.count ?? 0, maxResult.data?.offset ?? null];
  }
  const totalResult = await atlasClient
    .from('signal_events')
    .select('stream_id', { count: 'exact', head: true })
    .not('event_identity_hash', 'is', null);
  if (totalResult.error) throw new Error(`Domain 3 watermark total failed: ${totalResult.error.message}`);
  const sorted = Object.fromEntries(Object.entries(watermark).sort(([a], [b]) => a.localeCompare(b)));
  sorted.__total = totalResult.count ?? 0;
  return sorted;
}

async function readDerivationState(atlasClient) {
  try {
    const { data, error } = await atlasClient
      .from('atlas_derivation_state')
      .select('watermark, rule_set_hash, build, last_run_ids')
      .eq('id', true)
      .maybeSingle();
    if (error) return null;
    return data || null;
  } catch {
    return null;
  }
}

async function writeDerivationState(atlasClient, state) {
  const { error } = await atlasClient
    .from('atlas_derivation_state')
    .upsert({
      id: true,
      watermark: state.watermark,
      rule_set_hash: state.rule_set_hash,
      build: state.build,
      last_run_ids: state.last_run_ids,
      updated_at: new Date().toISOString(),
    });
  if (error) throw new Error(`Domain 3 derivation state write failed: ${error.message}`);
}

export { RULES as DOMAIN3_FULL_REPLAY_RULES, deriveCrossJurisdictionCandidates, loadCanonicalObservations, DERIVATION_BUILD, streamCanonicalObservations, finalizeCrossJurisdictionCandidates };
