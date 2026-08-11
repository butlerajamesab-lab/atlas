import crypto from 'crypto';

const ENGINE_ID = 'atlas.domain3_population_exact';
const ENGINE_VERSION = '1.0.0';
const DEFAULT_OBSERVATION_LIMIT = 20000;
const DEFAULT_CANDIDATE_LIMIT = 100;
const SOURCE_REF_LIMIT = 25;

const RULES = Object.freeze([
  {
    rule_id: 'atlas.domain3.frequency_spike',
    rule_version: '1.0.0',
    signal_type: 'frequency_spike',
    rule_contract: {
      domain: 3,
      detector: 'frequency_spike',
      minimum_records: 10,
      minimum_categories: 2,
      minimum_z_score: 1.5,
      interpretation_boundary: 'population concentration observation; not misconduct, causation, or legal finding',
    },
  },
  {
    rule_id: 'atlas.domain3.geographic_cluster',
    rule_version: '1.0.0',
    signal_type: 'geographic_cluster',
    rule_contract: {
      domain: 3,
      detector: 'geographic_cluster',
      minimum_records: 10,
      minimum_geographies: 2,
      minimum_z_score: 1.5,
      interpretation_boundary: 'geographic concentration observation; not misconduct, causation, or legal finding',
    },
  },
  {
    rule_id: 'atlas.domain3.repeat_entity',
    rule_version: '1.0.0',
    signal_type: 'repeat_entity',
    rule_contract: {
      domain: 3,
      detector: 'repeat_entity',
      minimum_records: 10,
      minimum_entities: 2,
      minimum_z_score: 2,
      entity_resolution: 'candidate remains unverified until exact entity resolution succeeds',
      interpretation_boundary: 'repeat-appearance observation; not misconduct, causation, or legal finding',
    },
  },
  {
    rule_id: 'atlas.domain3.trend_anomaly',
    rule_version: '1.0.0',
    signal_type: 'trend_anomaly',
    rule_contract: {
      domain: 3,
      detector: 'trend_anomaly',
      minimum_prior_year_records: 10,
      minimum_absolute_percent_change: 50,
      interpretation_boundary: 'temporal volume change observation; reporting-practice changes remain unresolved',
    },
  },
  {
    rule_id: 'atlas.domain3.cross_category_entity',
    rule_version: '1.0.0',
    signal_type: 'cross_category_entity',
    rule_contract: {
      domain: 3,
      detector: 'cross_category_entity',
      minimum_records: 10,
      minimum_categories: 3,
      entity_resolution: 'candidate remains unverified until exact entity resolution succeeds',
      interpretation_boundary: 'cross-category appearance observation; not misconduct, causation, or legal finding',
    },
  },
]);

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim().replace(/\s+/g, ' ');
  return normalized.length ? normalized : null;
}

function firstText(...values) {
  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized) return normalized;
  }
  return null;
}

function payloadOf(event) {
  return event?.payload && typeof event.payload === 'object' ? event.payload : {};
}

function spacetimeOf(event) {
  return event?.spacetime && typeof event.spacetime === 'object' ? event.spacetime : {};
}

function rawOf(event) {
  const payload = payloadOf(event);
  return payload?.raw && typeof payload.raw === 'object' ? payload.raw : {};
}

export function categoryOf(event) {
  const payload = payloadOf(event);
  const raw = rawOf(event);
  return firstText(
    payload.normalized_category,
    payload.category,
    payload.issue,
    payload.product,
    payload.subject,
    payload.ntee_code,
    raw.category,
    raw.issue,
    raw.product,
    event.signal_type,
  ) || 'unclassified';
}

export function jurisdictionOf(event) {
  const spacetime = spacetimeOf(event);
  return firstText(
    event.jurisdiction_id,
    spacetime.jurisdiction,
    spacetime.state,
    spacetime.region,
  ) || 'unknown';
}

export function geographyOf(event) {
  const spacetime = spacetimeOf(event);
  return firstText(
    spacetime.city,
    spacetime.county,
    spacetime.county_name,
    spacetime.zip,
    spacetime.zip_code,
    spacetime.region,
  );
}

export function entityOf(event) {
  const payload = payloadOf(event);
  const raw = rawOf(event);
  return firstText(
    payload.canonical_entity_name,
    payload.company,
    payload.company_name,
    payload.organization_name,
    payload.employer_name,
    payload.recipient_name,
    payload.candidate_name,
    payload.agency_name,
    payload.entity_name,
    payload.name,
    raw.company,
    raw.company_name,
    raw.organization_name,
    raw.employer_name,
    raw.recipient_name,
    raw.candidate_name,
    raw.agency_name,
    raw.entity_name,
    raw.name,
  );
}

function sourceRef(event) {
  return {
    stream_id: event.stream_id,
    offset: Number(event.offset),
    event_identity_hash: event.event_identity_hash || null,
  };
}

function meanStd(values) {
  if (!values.length) return { mean: 0, stddev: 0 };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  return { mean, stddev: Math.sqrt(variance) };
}

function severityFromZ(z) {
  if (z >= 3) return 'critical';
  if (z >= 2) return 'high';
  return 'medium';
}

function candidateBase({ ruleId, signalType, title, description, events, jurisdiction, severity, confidence, statistics, entityName = null }) {
  const refs = events
    .slice()
    .sort((a, b) => String(a.stream_id).localeCompare(String(b.stream_id)) || Number(a.offset) - Number(b.offset))
    .slice(0, SOURCE_REF_LIMIT)
    .map(sourceRef);
  const streams = [...new Set(events.map((event) => event.stream_id))].sort();
  const sourceFreshnessAt = events.reduce((latest, event) => {
    const value = new Date(event.timestamp || event.ingested_at || 0).getTime();
    return Number.isFinite(value) && value > latest ? value : latest;
  }, 0);
  const sourceInputHash = stableHash({ ruleId, refs, statistics });
  const candidateHash = stableHash({ ruleId, signalType, jurisdiction, title, sourceInputHash });

  return {
    candidate_hash: candidateHash,
    rule_id: ruleId,
    rule_version: '1.0.0',
    engine_id: ENGINE_ID,
    engine_version: ENGINE_VERSION,
    signal_type: signalType,
    title,
    description,
    primary_stream_id: streams[0] || 'unknown',
    source_event_refs: refs,
    entity_ids: [],
    entity_resolution_status: entityName ? 'unresolved_exact_match_required' : 'not_applicable',
    jurisdiction_id: jurisdiction,
    severity,
    confidence_score: Number(Math.max(0, Math.min(1, confidence)).toFixed(6)),
    verification_state: 'unverified',
    supporting_statistics: { ...statistics, streams, entity_name: entityName },
    evidence_refs: refs,
    source_freshness_at: new Date(sourceFreshnessAt || Date.now()).toISOString(),
    detected_at: new Date().toISOString(),
    source_input_hash: sourceInputHash,
  };
}

function partitionEvents(events) {
  const partitions = new Map();
  for (const event of events) {
    const key = `${event.stream_id}::${jurisdictionOf(event)}`;
    if (!partitions.has(key)) partitions.set(key, []);
    partitions.get(key).push(event);
  }
  return [...partitions.values()];
}

function detectFrequencySpikes(events) {
  const candidates = [];
  for (const partition of partitionEvents(events)) {
    const groups = new Map();
    for (const event of partition) {
      const category = categoryOf(event);
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(event);
    }
    if (groups.size < 2) continue;
    const counts = [...groups.values()].map((rows) => rows.length);
    const { mean, stddev } = meanStd(counts);
    if (stddev <= 0) continue;
    for (const [category, rows] of groups) {
      const z = (rows.length - mean) / stddev;
      if (rows.length < 10 || z < 1.5) continue;
      const jurisdiction = jurisdictionOf(rows[0]);
      const percentage = (rows.length / partition.length) * 100;
      candidates.push(candidateBase({
        ruleId: 'atlas.domain3.frequency_spike',
        signalType: 'frequency_spike',
        title: `Frequency spike: ${category}`,
        description: `${category} accounts for ${rows.length} of ${partition.length} observations (${percentage.toFixed(1)}%), ${z.toFixed(2)} standard deviations above the category mean.`,
        events: rows,
        jurisdiction,
        severity: severityFromZ(z),
        confidence: Math.min(0.95, 0.55 + (z * 0.1)),
        statistics: { records_analyzed: partition.length, pattern_count: rows.length, percentage_affected: Number(percentage.toFixed(2)), z_score: Number(z.toFixed(4)), category_mean: Number(mean.toFixed(4)), category_stddev: Number(stddev.toFixed(4)), category },
      }));
    }
  }
  return candidates;
}

function detectGeographicClusters(events) {
  const candidates = [];
  for (const partition of partitionEvents(events)) {
    const groups = new Map();
    for (const event of partition) {
      const geography = geographyOf(event);
      if (!geography) continue;
      if (!groups.has(geography)) groups.set(geography, []);
      groups.get(geography).push(event);
    }
    if (groups.size < 2) continue;
    const counts = [...groups.values()].map((rows) => rows.length);
    const { mean, stddev } = meanStd(counts);
    if (stddev <= 0) continue;
    for (const [geography, rows] of groups) {
      const z = (rows.length - mean) / stddev;
      if (rows.length < 10 || z < 1.5) continue;
      const jurisdiction = jurisdictionOf(rows[0]);
      const percentage = (rows.length / partition.length) * 100;
      candidates.push(candidateBase({
        ruleId: 'atlas.domain3.geographic_cluster',
        signalType: 'geographic_cluster',
        title: `Geographic concentration: ${geography}`,
        description: `${geography} contains ${rows.length} of ${partition.length} observations (${percentage.toFixed(1)}%), ${z.toFixed(2)} standard deviations above the geography mean.`,
        events: rows,
        jurisdiction,
        severity: severityFromZ(z),
        confidence: Math.min(0.93, 0.5 + (z * 0.1)),
        statistics: { records_analyzed: partition.length, pattern_count: rows.length, percentage_affected: Number(percentage.toFixed(2)), z_score: Number(z.toFixed(4)), geography_mean: Number(mean.toFixed(4)), geography_stddev: Number(stddev.toFixed(4)), geography },
      }));
    }
  }
  return candidates;
}

function detectRepeatEntities(events) {
  const candidates = [];
  for (const partition of partitionEvents(events)) {
    const groups = new Map();
    for (const event of partition) {
      const entity = entityOf(event);
      if (!entity) continue;
      if (!groups.has(entity)) groups.set(entity, []);
      groups.get(entity).push(event);
    }
    if (groups.size < 2) continue;
    const counts = [...groups.values()].map((rows) => rows.length);
    const { mean, stddev } = meanStd(counts);
    if (stddev <= 0) continue;
    for (const [entity, rows] of groups) {
      const z = (rows.length - mean) / stddev;
      if (rows.length < 10 || z < 2) continue;
      const jurisdiction = jurisdictionOf(rows[0]);
      const percentage = (rows.length / partition.length) * 100;
      candidates.push(candidateBase({
        ruleId: 'atlas.domain3.repeat_entity',
        signalType: 'repeat_entity',
        title: `Repeat entity: ${entity}`,
        description: `${entity} appears in ${rows.length} of ${partition.length} observations (${percentage.toFixed(1)}%), ${z.toFixed(2)} standard deviations above the entity mean.`,
        events: rows,
        jurisdiction,
        severity: severityFromZ(z),
        confidence: Math.min(0.92, 0.5 + (z * 0.08)),
        statistics: { records_analyzed: partition.length, pattern_count: rows.length, percentage_affected: Number(percentage.toFixed(2)), z_score: Number(z.toFixed(4)), entity_mean: Number(mean.toFixed(4)), entity_stddev: Number(stddev.toFixed(4)) },
        entityName: entity,
      }));
    }
  }
  return candidates;
}

function detectTrendAnomalies(events) {
  const candidates = [];
  for (const partition of partitionEvents(events)) {
    const years = new Map();
    for (const event of partition) {
      const year = new Date(event.timestamp).getUTCFullYear();
      if (!Number.isFinite(year)) continue;
      if (!years.has(year)) years.set(year, []);
      years.get(year).push(event);
    }
    const ordered = [...years.keys()].sort((a, b) => a - b);
    for (let index = 1; index < ordered.length; index += 1) {
      const priorYear = ordered[index - 1];
      const currentYear = ordered[index];
      if (currentYear !== priorYear + 1) continue;
      const prior = years.get(priorYear);
      const current = years.get(currentYear);
      if (prior.length < 10) continue;
      const percentChange = ((current.length - prior.length) / prior.length) * 100;
      const magnitude = Math.abs(percentChange);
      if (magnitude < 50) continue;
      const jurisdiction = jurisdictionOf(partition[0]);
      const direction = percentChange >= 0 ? 'increase' : 'decrease';
      const severity = magnitude >= 200 ? 'critical' : magnitude >= 100 ? 'high' : 'medium';
      candidates.push(candidateBase({
        ruleId: 'atlas.domain3.trend_anomaly',
        signalType: 'trend_anomaly',
        title: `Year-over-year ${direction}: ${priorYear} → ${currentYear}`,
        description: `Observation volume changed from ${prior.length} in ${priorYear} to ${current.length} in ${currentYear}, a ${magnitude.toFixed(1)}% ${direction}.`,
        events: [...prior, ...current],
        jurisdiction,
        severity,
        confidence: Math.min(0.95, 0.55 + (magnitude / 500)),
        statistics: { prior_year: priorYear, current_year: currentYear, prior_count: prior.length, current_count: current.length, percent_change: Number(percentChange.toFixed(4)), records_analyzed: partition.length },
      }));
    }
  }
  return candidates;
}

function detectCrossCategoryEntities(events) {
  const candidates = [];
  const byJurisdiction = new Map();
  for (const event of events) {
    const jurisdiction = jurisdictionOf(event);
    if (!byJurisdiction.has(jurisdiction)) byJurisdiction.set(jurisdiction, []);
    byJurisdiction.get(jurisdiction).push(event);
  }
  for (const [jurisdiction, rows] of byJurisdiction) {
    const entities = new Map();
    for (const event of rows) {
      const entity = entityOf(event);
      if (!entity) continue;
      if (!entities.has(entity)) entities.set(entity, []);
      entities.get(entity).push(event);
    }
    for (const [entity, entityRows] of entities) {
      const categories = [...new Set(entityRows.map(categoryOf))].sort();
      if (entityRows.length < 10 || categories.length < 3) continue;
      const severity = categories.length >= 7 ? 'critical' : categories.length >= 5 ? 'high' : 'medium';
      candidates.push(candidateBase({
        ruleId: 'atlas.domain3.cross_category_entity',
        signalType: 'cross_category_entity',
        title: `Cross-category entity: ${entity}`,
        description: `${entity} appears in ${entityRows.length} observations across ${categories.length} categories in ${jurisdiction}.`,
        events: entityRows,
        jurisdiction,
        severity,
        confidence: Math.min(0.93, 0.5 + (categories.length * 0.06)),
        statistics: { records_analyzed: rows.length, pattern_count: entityRows.length, category_count: categories.length, categories },
        entityName: entity,
      }));
    }
  }
  return candidates;
}

export function deriveDomain3PopulationCandidates(events) {
  const canonical = (Array.isArray(events) ? events : []).filter((event) => event?.event_identity_hash);
  return [
    ...detectFrequencySpikes(canonical),
    ...detectGeographicClusters(canonical),
    ...detectRepeatEntities(canonical),
    ...detectTrendAnomalies(canonical),
    ...detectCrossCategoryEntities(canonical),
  ].sort((a, b) => a.candidate_hash.localeCompare(b.candidate_hash));
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
      .order('ingested_at', { ascending: false })
      .range(from, to);
    if (error) throw new Error(`Domain 3 observation read failed: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function ensureRules(atlasClient) {
  const rows = RULES.map((rule) => {
    const ruleContract = { ...rule.rule_contract, engine_id: ENGINE_ID, engine_version: ENGINE_VERSION };
    return {
      ...rule,
      engine_id: ENGINE_ID,
      engine_version: ENGINE_VERSION,
      rule_contract: ruleContract,
      rule_contract_hash: stableHash(ruleContract),
      is_active: true,
    };
  });
  const { error } = await atlasClient.schema('atlas').from('live_data_signal_rule').upsert(rows, { onConflict: 'rule_id,rule_version' });
  if (error) throw new Error(`Domain 3 rule registration failed: ${error.message}`);
  return new Map(rows.map((row) => [row.rule_id, row]));
}

async function persistRuleRun({ atlasClient, rule, observationsScanned, candidates }) {
  const runId = crypto.randomUUID();
  const { error: runError } = await atlasClient.schema('atlas').from('live_data_signal_run').insert({
    run_id: runId,
    rule_id: rule.rule_id,
    rule_version: rule.rule_version,
    rule_contract_hash: rule.rule_contract_hash,
    status: 'running',
    canonical_events_scanned: observationsScanned,
    entities_evaluated: candidates.filter((candidate) => candidate.supporting_statistics?.entity_name).length,
    candidates_produced: 0,
    started_at: new Date().toISOString(),
  });
  if (runError) throw new Error(`Domain 3 run start failed for ${rule.rule_id}: ${runError.message}`);

  let produced = 0;
  try {
    for (const candidate of candidates) {
      const { data: existing, error: readError } = await atlasClient.schema('atlas').from('live_data_signal_candidate')
        .select('candidate_id,first_run_id')
        .eq('candidate_hash', candidate.candidate_hash)
        .maybeSingle();
      if (readError) throw readError;
      if (existing) {
        const { error: updateError } = await atlasClient.schema('atlas').from('live_data_signal_candidate')
          .update({
            last_run_id: runId,
            last_replayed_at: new Date().toISOString(),
            detected_at: candidate.detected_at,
            source_freshness_at: candidate.source_freshness_at,
            supporting_statistics: candidate.supporting_statistics,
            source_event_refs: candidate.source_event_refs,
            evidence_refs: candidate.evidence_refs,
          })
          .eq('candidate_id', existing.candidate_id);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await atlasClient.schema('atlas').from('live_data_signal_candidate').insert({
          ...candidate,
          rule_contract_hash: rule.rule_contract_hash,
          first_run_id: runId,
          last_run_id: runId,
        });
        if (insertError) throw insertError;
      }
      produced += 1;
    }

    const { error: finishError } = await atlasClient.schema('atlas').from('live_data_signal_run')
      .update({ status: 'completed', candidates_produced: produced, completed_at: new Date().toISOString() })
      .eq('run_id', runId);
    if (finishError) throw finishError;
    return { run_id: runId, rule_id: rule.rule_id, candidates_produced: produced };
  } catch (error) {
    await atlasClient.schema('atlas').from('live_data_signal_run')
      .update({ status: 'failed', error_message: String(error?.message || error).slice(0, 2000), completed_at: new Date().toISOString() })
      .eq('run_id', runId);
    throw new Error(`Domain 3 persistence failed for ${rule.rule_id}: ${error?.message || error}`);
  }
}

export async function executeDomain3PopulationDetection({
  atlasClient,
  observationLimit = DEFAULT_OBSERVATION_LIMIT,
  candidateLimit = DEFAULT_CANDIDATE_LIMIT,
}) {
  if (!atlasClient) throw new Error('atlasClient is required');
  const observations = await loadCanonicalObservations(atlasClient, observationLimit);
  const rules = await ensureRules(atlasClient);
  const allCandidates = deriveDomain3PopulationCandidates(observations);
  const boundedCandidateLimit = Math.min(1000, Math.max(1, Number(candidateLimit) || DEFAULT_CANDIDATE_LIMIT));
  const candidates = allCandidates.slice(0, boundedCandidateLimit);
  const runs = [];

  for (const rule of rules.values()) {
    const ruleCandidates = candidates.filter((candidate) => candidate.rule_id === rule.rule_id);
    runs.push(await persistRuleRun({ atlasClient, rule, observationsScanned: observations.length, candidates: ruleCandidates }));
  }

  return {
    engine_id: ENGINE_ID,
    engine_version: ENGINE_VERSION,
    observations_scanned: observations.length,
    candidates_derived: allCandidates.length,
    candidates_persisted: candidates.length,
    runs,
  };
}

export { RULES as DOMAIN3_POPULATION_RULES };
