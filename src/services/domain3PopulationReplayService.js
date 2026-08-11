import crypto from 'crypto';
import {
  DOMAIN3_POPULATION_RULES,
  deriveDomain3PopulationCandidates,
  entityOf,
  jurisdictionOf,
} from './domain3PopulationDetectorService.js';

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
    entity_resolution: 'candidate remains unverified until exact entity resolution succeeds',
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
    const entity = entityOf(event);
    if (!entity) continue;
    if (!byEntity.has(entity)) byEntity.set(entity, []);
    byEntity.get(entity).push(event);
  }

  const candidates = [];
  for (const [entity, rows] of byEntity) {
    const jurisdictions = [...new Set(rows.map(jurisdictionOf).filter((value) => value && value !== 'unknown'))].sort();
    if (rows.length < 10 || jurisdictions.length < 2) continue;
    const streams = [...new Set(rows.map((row) => row.stream_id))].sort();
    const refs = rows
      .slice()
      .sort((a, b) => String(a.stream_id).localeCompare(String(b.stream_id)) || Number(a.offset) - Number(b.offset))
      .slice(0, SOURCE_REF_LIMIT)
      .map(sourceRef);
    const sourceFreshness = rows.reduce((latest, row) => {
      const value = new Date(row.timestamp || row.ingested_at || 0).getTime();
      return Number.isFinite(value) && value > latest ? value : latest;
    }, 0);
    const statistics = {
      records_analyzed: events.length,
      pattern_count: rows.length,
      jurisdiction_count: jurisdictions.length,
      jurisdictions,
      streams,
      entity_name: entity,
    };
    const sourceInputHash = stableHash({ rule_id: CROSS_JURISDICTION_RULE.rule_id, refs, statistics });
    const candidateHash = stableHash({
      rule_id: CROSS_JURISDICTION_RULE.rule_id,
      entity,
      jurisdictions,
      source_input_hash: sourceInputHash,
    });
    const severity = jurisdictions.length >= 8 ? 'critical' : jurisdictions.length >= 4 ? 'high' : 'medium';
    const confidence = Math.min(0.95, 0.5 + (jurisdictions.length * 0.05) + Math.min(rows.length, 100) / 1000);

    candidates.push({
      candidate_hash: candidateHash,
      rule_id: CROSS_JURISDICTION_RULE.rule_id,
      rule_version: CROSS_JURISDICTION_RULE.rule_version,
      engine_id: ENGINE_ID,
      engine_version: ENGINE_VERSION,
      signal_type: CROSS_JURISDICTION_RULE.signal_type,
      title: `Cross-jurisdiction recurrence: ${entity}`,
      description: `${entity} appears in ${rows.length} observations across ${jurisdictions.length} governed jurisdictions. This is a recurrence observation, not a finding of wrongdoing.`,
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
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; from < bounded; from += pageSize) {
    const to = Math.min(from + pageSize - 1, bounded - 1);
    const { data, error } = await atlasClient
      .from('signal_events')
      .select('stream_id,offset,timestamp,signal_type,spacetime,provenance,payload,source_id,jurisdiction_id,module_hint,ingested_at,event_identity_hash')
      .not('event_identity_hash', 'is', null)
      .order('ingested_at', { ascending: true })
      .order('stream_id', { ascending: true })
      .order('offset', { ascending: true })
      .range(from, to);
    if (error) throw new Error(`Domain 3 full replay observation read failed: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

function materializeRuleRows() {
  return RULES.map((rule) => {
    const ruleContract = {
      ...rule.rule_contract,
      engine_id: ENGINE_ID,
      engine_version: ENGINE_VERSION,
    };
    return {
      rule_id: rule.rule_id,
      rule_version: rule.rule_version,
      signal_type: rule.signal_type,
      engine_id: ENGINE_ID,
      engine_version: ENGINE_VERSION,
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
  if (error) {
    throw new Error(`Domain 3 persistence failed for ${rule.rule_id}: ${error.message}`);
  }
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

export async function executeDomain3FullReplay({
  atlasClient,
  observationLimit = DEFAULT_OBSERVATION_LIMIT,
  candidateLimit = DEFAULT_CANDIDATE_LIMIT_PER_RULE,
} = {}) {
  if (!atlasClient) throw new Error('atlasClient is required');

  // Register the governed detector population before the scan so a failed read cannot
  // make the runtime appear to have only the historical ProPublica seed rule.
  const rules = await ensureRules(atlasClient);
  const observations = await loadCanonicalObservations(atlasClient, observationLimit);
  const baseCandidates = deriveDomain3PopulationCandidates(observations).map((candidate) => ({
    ...candidate,
    engine_id: ENGINE_ID,
    engine_version: ENGINE_VERSION,
  }));
  const crossJurisdictionCandidates = deriveCrossJurisdictionCandidates(observations);
  const allCandidates = [...baseCandidates, ...crossJurisdictionCandidates]
    .sort((a, b) => a.rule_id.localeCompare(b.rule_id) || a.candidate_hash.localeCompare(b.candidate_hash));
  const boundedPerRule = Math.min(1000, Math.max(1, Number(candidateLimit) || DEFAULT_CANDIDATE_LIMIT_PER_RULE));
  const runs = [];
  let persisted = 0;

  for (const rule of rules.values()) {
    const ruleCandidates = allCandidates
      .filter((candidate) => candidate.rule_id === rule.rule_id)
      .slice(0, boundedPerRule);
    persisted += ruleCandidates.length;
    runs.push(await persistRuleRun({
      atlasClient,
      rule,
      observationsScanned: observations.length,
      candidates: ruleCandidates,
    }));
  }

  return {
    engine_id: ENGINE_ID,
    engine_version: ENGINE_VERSION,
    replay_scope: 'complete_identity_bound_observation_population',
    observations_scanned: observations.length,
    candidates_derived: allCandidates.length,
    candidates_persisted: persisted,
    candidate_limit_per_rule: boundedPerRule,
    rules_registered: rules.size,
    runs,
  };
}

export { RULES as DOMAIN3_FULL_REPLAY_RULES };
