import crypto from 'crypto';
import {
  CONFIDENCE_SEMANTICS,
  DOMAIN3_POPULATION_RULES,
  deriveDomain3PopulationCandidates,
  entityKeyOf,
  entityOf,
  EVIDENCE_SAMPLING,
  jurisdictionOf,
  sampleSourceRefs,
} from './domain3PopulationDetectorService.js';
import {
  INTEGRITY_PATTERN_RULES,
  deriveIntegrityPatternCandidates,
  summarizeIntegrityPatternReadiness,
} from './integrityPatternDetectorService.js';

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
    const severity = jurisdictions.length >= 8 ? 'high' : jurisdictions.length >= 4 ? 'medium' : 'low';

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

async function loadCanonicalObservations(atlasClient, limit) {
  const bounded = Math.min(100000, Math.max(1, Number(limit) || DEFAULT_OBSERVATION_LIMIT));
  const readLimit = bounded + 1;
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; from < readLimit; from += pageSize) {
    const to = Math.min(from + pageSize - 1, readLimit - 1);
    const { data, error } = await atlasClient
      .from('signal_events')
      .select('stream_id,offset,timestamp,signal_type,spacetime,provenance,payload,source_id,jurisdiction_id,module_hint,ingested_at,event_identity_hash')
      .not('event_identity_hash', 'is', null)
      .order('stream_id', { ascending: true })
      .order('offset', { ascending: true })
      .range(from, to);
    if (error) throw new Error(`Domain 3 full replay observation read failed: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
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

async function persistRuleRun({ atlasClient, rule, observationsScanned, candidates }) {
  const runId = crypto.randomUUID();
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
  observationLimit = DEFAULT_OBSERVATION_LIMIT,
  candidateLimit = DEFAULT_CANDIDATE_LIMIT_PER_RULE,
} = {}) {
  if (!atlasClient) throw new Error('atlasClient is required');

  const rules = await ensureRules(atlasClient);
  const observationScan = await loadCanonicalObservations(atlasClient, observationLimit);
  const observations = observationScan.observations;
  const baseCandidates = deriveDomain3PopulationCandidates(observations).map((candidate) => ({
    ...candidate,
    engine_id: ENGINE_ID,
    engine_version: ENGINE_VERSION,
  }));
  const crossJurisdictionCandidates = deriveCrossJurisdictionCandidates(observations);
  const integrityCandidates = deriveIntegrityPatternCandidates(observations);
  const integrityReadiness = summarizeIntegrityPatternReadiness(observations);
  const allCandidates = [...baseCandidates, ...crossJurisdictionCandidates, ...integrityCandidates]
    .sort((a, b) => a.rule_id.localeCompare(b.rule_id) || a.candidate_hash.localeCompare(b.candidate_hash));
  const boundedPerRule = Math.min(1000, Math.max(1, Number(candidateLimit) || DEFAULT_CANDIDATE_LIMIT_PER_RULE));
  const runs = [];
  const ruleErrors = [];
  const ruleWarnings = [];
  let persisted = 0;

  for (const rule of rules.values()) {
    const completeRuleCandidates = allCandidates.filter((candidate) => candidate.rule_id === rule.rule_id);
    const replayComplete = observationScan.complete
      && completeRuleCandidates.length <= boundedPerRule;
    const ruleCandidates = completeRuleCandidates.slice(0, boundedPerRule);
    try {
      const run = await persistRuleRun({
        atlasClient,
        rule,
        observationsScanned: observations.length,
        candidates: ruleCandidates,
      });
      persisted += ruleCandidates.length;

      let currentness;
      try {
        currentness = await reconcileRuleCurrentness({
          atlasClient,
          rule,
          runId: run.run_id,
          candidates: ruleCandidates,
          replayComplete,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        ruleErrors.push({ rule_id: rule.rule_id, phase: 'currentness_reconciliation', error: errorMessage });
        currentness = { status: 'failed', error: errorMessage, retired: 0 };
      }

      if (!replayComplete) {
        ruleWarnings.push({
          rule_id: rule.rule_id,
          warning: observationScan.complete
            ? 'candidate_limit_truncated_replay_currentness_not_reconciled'
            : 'observation_limit_truncated_replay_currentness_not_reconciled',
          observation_scan_complete: observationScan.complete,
          candidates_derived: completeRuleCandidates.length,
          candidates_persisted: ruleCandidates.length,
        });
      }

      runs.push({
        ...run,
        status: currentness.status === 'failed' ? 'partial' : 'completed',
        candidates_derived: completeRuleCandidates.length,
        replay_complete: replayComplete,
        currentness,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      ruleErrors.push({
        rule_id: rule.rule_id,
        phase: 'persistence',
        candidates_derived: completeRuleCandidates.length,
        error: errorMessage,
      });
      runs.push({
        run_id: null,
        rule_id: rule.rule_id,
        status: 'failed',
        candidates_derived: completeRuleCandidates.length,
        candidates_produced: 0,
        candidates_inserted: 0,
        candidates_replayed: 0,
        replay_complete: replayComplete,
        error: errorMessage,
      });
    }
  }

  return {
    status: ruleErrors.length || ruleWarnings.length ? 'partial' : 'completed',
    engine_id: ENGINE_ID,
    engine_version: ENGINE_VERSION,
    replay_scope: 'complete_identity_bound_observation_population',
    observations_scanned: observations.length,
    observation_scan_complete: observationScan.complete,
    candidates_derived: allCandidates.length,
    candidates_persisted: persisted,
    candidate_limit_per_rule: boundedPerRule,
    rules_registered: rules.size,
    integrity_candidates_derived: integrityCandidates.length,
    integrity_readiness: integrityReadiness,
    rule_errors: ruleErrors,
    rule_warnings: ruleWarnings,
    runs,
  };
}

export { RULES as DOMAIN3_FULL_REPLAY_RULES };
