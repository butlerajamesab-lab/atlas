import crypto from 'crypto';

const ENGINE_ID = 'atlas.domain3_population_exact';
const ENGINE_VERSION = '1.0.0';
const SOURCE_REF_LIMIT = 25;

export const CONFIDENCE_SEMANTICS = 'weighted_declared_factor_score_not_probability';
export const EVIDENCE_SAMPLING = 'evenly_spaced_sample_over_stream_offset_order_including_first_and_last';

const RULES = Object.freeze([
  {
    rule_id: 'atlas.domain3.frequency_spike',
    rule_version: '1.0.0',
    signal_type: 'frequency_spike',
    rule_contract: {
      domain: 3,
      detector: 'frequency_spike',
      baseline: 'location_quotient_vs_scan_wide_share',
      minimum_records: 10,
      minimum_partition_categorized_records: 20,
      minimum_location_quotient: 2,
      confidence: CONFIDENCE_SEMANTICS,
      evidence_sampling: EVIDENCE_SAMPLING,
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
      baseline: 'location_quotient_vs_scan_wide_share',
      minimum_records: 10,
      minimum_partition_geography_records: 20,
      minimum_location_quotient: 2,
      confidence: CONFIDENCE_SEMANTICS,
      evidence_sampling: EVIDENCE_SAMPLING,
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
      baseline: 'location_quotient_vs_scan_wide_share',
      minimum_records: 10,
      minimum_partition_entity_records: 20,
      minimum_location_quotient: 3,
      entity_grouping: 'declared_normalized_name_key_not_identity',
      entity_resolution: 'candidate remains unverified until exact entity resolution succeeds',
      confidence: CONFIDENCE_SEMANTICS,
      evidence_sampling: EVIDENCE_SAMPLING,
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
      baseline: 'own_prior_year_volume',
      minimum_prior_year_records: 10,
      minimum_absolute_percent_change: 50,
      confidence: CONFIDENCE_SEMANTICS,
      evidence_sampling: EVIDENCE_SAMPLING,
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
      entity_grouping: 'declared_normalized_name_key_not_identity',
      entity_resolution: 'candidate remains unverified until exact entity resolution succeeds',
      confidence: CONFIDENCE_SEMANTICS,
      evidence_sampling: EVIDENCE_SAMPLING,
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

const ENTITY_SUFFIXES = new Set(['inc', 'llc', 'llp', 'corp', 'corporation', 'company', 'co', 'ltd']);

export function normalizeEntityKey(value) {
  const text = normalizeText(value);
  if (!text) return null;
  let key = text.toLowerCase().replace(/\s+/g, ' ').replace(/[.,]+$/g, '').trim();
  const tokens = key.split(' ');
  if (tokens.length > 1 && ENTITY_SUFFIXES.has(tokens[tokens.length - 1].replace(/[.,]/g, ''))) {
    tokens.pop();
    key = tokens.join(' ').replace(/[.,]+$/g, '').trim();
  }
  return key.length ? key : null;
}

export function entityKeyOf(event) {
  return normalizeEntityKey(entityOf(event));
}

function mostFrequentText(values) {
  const counts = new Map();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  let best = null;
  let bestCount = -1;
  for (const [value, count] of counts) {
    if (count > bestCount || (count === bestCount && (best === null || value < best))) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function countBy(values) {
  const counts = new Map();
  for (const value of values) {
    if (value === null || value === undefined) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return counts;
}

function locationQuotient(localCount, localTotal, globalCount, globalTotal) {
  if (!localTotal || !globalTotal || !globalCount) return 0;
  return (localCount / localTotal) / (globalCount / globalTotal);
}

function factorScore(factors) {
  const total = factors.reduce((sum, factor) => sum + factor.weight, 0);
  const met = factors.reduce((sum, factor) => sum + (factor.satisfied ? factor.weight : 0), 0);
  return {
    score: total > 0 ? Number((met / total).toFixed(6)) : 0,
    factors: factors.map((factor) => ({ ...factor, satisfied: Boolean(factor.satisfied) })),
  };
}

function unresolvedResolutionFactor() {
  return {
    factor_id: 'exact_entity_resolution',
    weight: 0.3,
    satisfied: false,
    explanation: 'Grouping uses a declared normalized name key; exact entity resolution has not succeeded, so this factor is not satisfied and the score is capped until it does.',
  };
}

export function sampleSourceRefs(events, limit = SOURCE_REF_LIMIT) {
  const sorted = events
    .slice()
    .sort((a, b) => String(a.stream_id).localeCompare(String(b.stream_id)) || Number(a.offset) - Number(b.offset));
  if (sorted.length <= limit) return sorted.map(sourceRef);
  const picked = [];
  const seen = new Set();
  for (let i = 0; i < limit; i += 1) {
    const index = Math.round((i * (sorted.length - 1)) / (limit - 1));
    if (seen.has(index)) continue;
    seen.add(index);
    picked.push(sorted[index]);
  }
  return picked.map(sourceRef);
}

function sourceRef(event) {
  return {
    stream_id: event.stream_id,
    offset: Number(event.offset),
    event_identity_hash: event.event_identity_hash || null,
  };
}

function candidateBase({ ruleId, signalType, title, description, events, jurisdiction, severity, factors, statistics, entityName = null, entityKey = null }) {
  const refs = sampleSourceRefs(events);
  const streams = [...new Set(events.map((event) => event.stream_id))].sort();
  const sourceFreshnessAt = events.reduce((latest, event) => {
    const value = new Date(event.timestamp || event.ingested_at || 0).getTime();
    return Number.isFinite(value) && value > latest ? value : latest;
  }, 0);
  const { score, factors: scoredFactors } = factorScore(factors);
  const fullStatistics = {
    ...statistics,
    streams,
    entity_name: entityName,
    ...(entityKey ? { entity_key: entityKey } : {}),
    confidence_factors: scoredFactors,
    confidence_semantics: CONFIDENCE_SEMANTICS,
    evidence_sampling: EVIDENCE_SAMPLING,
    evidence_ref_count: refs.length,
  };
  const sourceInputHash = stableHash({ ruleId, refs, statistics: fullStatistics });
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
    confidence_score: score,
    verification_state: 'unverified',
    supporting_statistics: fullStatistics,
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
  const categorized = events.filter((event) => categoryOf(event) !== 'unclassified');
  const globalCounts = countBy(categorized.map((event) => categoryOf(event)));
  const scanTotal = categorized.length;
  const candidates = [];
  for (const partition of partitionEvents(events)) {
    const bearing = partition.filter((event) => categoryOf(event) !== 'unclassified');
    if (bearing.length < 20) continue;
    const groups = new Map();
    for (const event of bearing) {
      const category = categoryOf(event);
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(event);
    }
    for (const [category, rows] of groups) {
      const localShare = rows.length / bearing.length;
      const globalShare = (globalCounts.get(category) || 0) / scanTotal;
      const quotient = locationQuotient(rows.length, bearing.length, globalCounts.get(category) || 0, scanTotal);
      if (rows.length < 10 || quotient < 2) continue;
      const jurisdiction = jurisdictionOf(rows[0]);
      const percentage = localShare * 100;
      candidates.push(candidateBase({
        ruleId: 'atlas.domain3.frequency_spike',
        signalType: 'frequency_spike',
        title: `Frequency spike: ${category}`,
        description: `${category} accounts for ${rows.length} of ${bearing.length} categorized observations in this stream and jurisdiction (${percentage.toFixed(1)}%), ${quotient.toFixed(2)}x its rate across the full scanned population (${(globalShare * 100).toFixed(1)}%). Concentration observation; not misconduct, causation, or a legal finding.`,
        events: rows,
        jurisdiction,
        severity: quotient >= 4 && rows.length >= 50 ? 'high' : 'medium',
        factors: [
          { factor_id: 'local_elevation', weight: 0.45, satisfied: quotient >= 2, explanation: `Local share is ${quotient.toFixed(2)}x the scan-wide rate (declared minimum 2x).` },
          { factor_id: 'strong_elevation', weight: 0.2, satisfied: quotient >= 4, explanation: quotient >= 4 ? 'Local share is at least 4x the scan-wide rate.' : 'Local share is below 4x the scan-wide rate.' },
          { factor_id: 'volume', weight: 0.2, satisfied: rows.length >= 25, explanation: `${rows.length} observations in the pattern (declared full-volume mark 25).` },
          { factor_id: 'partition_share', weight: 0.15, satisfied: localShare >= 0.1, explanation: `Pattern is ${(localShare * 100).toFixed(1)}% of its partition (declared share mark 10%).` },
        ],
        statistics: { records_analyzed: partition.length, pattern_count: rows.length, percentage_affected: Number(percentage.toFixed(2)), location_quotient: Number(quotient.toFixed(4)), local_share: Number(localShare.toFixed(6)), global_share: Number(globalShare.toFixed(6)), category },
      }));
    }
  }
  return candidates;
}

function detectGeographicClusters(events) {
  const bearingAll = events.filter((event) => geographyOf(event));
  const globalCounts = countBy(bearingAll.map((event) => geographyOf(event)));
  const scanTotal = bearingAll.length;
  const candidates = [];
  for (const partition of partitionEvents(events)) {
    const bearing = partition.filter((event) => geographyOf(event));
    if (bearing.length < 20) continue;
    const groups = new Map();
    for (const event of bearing) {
      const geography = geographyOf(event);
      if (!groups.has(geography)) groups.set(geography, []);
      groups.get(geography).push(event);
    }
    for (const [geography, rows] of groups) {
      const localShare = rows.length / bearing.length;
      const globalShare = (globalCounts.get(geography) || 0) / scanTotal;
      const quotient = locationQuotient(rows.length, bearing.length, globalCounts.get(geography) || 0, scanTotal);
      if (rows.length < 10 || quotient < 2) continue;
      const jurisdiction = jurisdictionOf(rows[0]);
      const percentage = localShare * 100;
      candidates.push(candidateBase({
        ruleId: 'atlas.domain3.geographic_cluster',
        signalType: 'geographic_cluster',
        title: `Geographic concentration: ${geography}`,
        description: `${geography} contains ${rows.length} of ${bearing.length} geography-bearing observations in this stream and jurisdiction (${percentage.toFixed(1)}%), ${quotient.toFixed(2)}x its rate across the full scanned population (${(globalShare * 100).toFixed(1)}%). Concentration observation; not misconduct, causation, or a legal finding.`,
        events: rows,
        jurisdiction,
        severity: quotient >= 4 && rows.length >= 50 ? 'high' : 'medium',
        factors: [
          { factor_id: 'local_elevation', weight: 0.45, satisfied: quotient >= 2, explanation: `Local share is ${quotient.toFixed(2)}x the scan-wide rate (declared minimum 2x).` },
          { factor_id: 'strong_elevation', weight: 0.2, satisfied: quotient >= 4, explanation: quotient >= 4 ? 'Local share is at least 4x the scan-wide rate.' : 'Local share is below 4x the scan-wide rate.' },
          { factor_id: 'volume', weight: 0.2, satisfied: rows.length >= 25, explanation: `${rows.length} observations in the pattern (declared full-volume mark 25).` },
          { factor_id: 'partition_share', weight: 0.15, satisfied: localShare >= 0.1, explanation: `Pattern is ${(localShare * 100).toFixed(1)}% of its partition (declared share mark 10%).` },
        ],
        statistics: { records_analyzed: partition.length, pattern_count: rows.length, percentage_affected: Number(percentage.toFixed(2)), location_quotient: Number(quotient.toFixed(4)), local_share: Number(localShare.toFixed(6)), global_share: Number(globalShare.toFixed(6)), geography },
      }));
    }
  }
  return candidates;
}

function detectRepeatEntities(events) {
  const bearingAll = events.filter((event) => entityKeyOf(event));
  const globalCounts = countBy(bearingAll.map((event) => entityKeyOf(event)));
  const scanTotal = bearingAll.length;
  const candidates = [];
  for (const partition of partitionEvents(events)) {
    const bearing = partition.filter((event) => entityKeyOf(event));
    if (bearing.length < 20) continue;
    const groups = new Map();
    for (const event of bearing) {
      const key = entityKeyOf(event);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(event);
    }
    for (const [key, rows] of groups) {
      const localShare = rows.length / bearing.length;
      const globalShare = (globalCounts.get(key) || 0) / scanTotal;
      const quotient = locationQuotient(rows.length, bearing.length, globalCounts.get(key) || 0, scanTotal);
      if (rows.length < 10 || quotient < 3) continue;
      const display = mostFrequentText(rows.map((event) => entityOf(event))) || key;
      const jurisdiction = jurisdictionOf(rows[0]);
      const percentage = localShare * 100;
      const spread = new Set(rows.map((event) => jurisdictionOf(event))).size >= 2
        || new Set(rows.map((event) => categoryOf(event))).size >= 3;
      candidates.push(candidateBase({
        ruleId: 'atlas.domain3.repeat_entity',
        signalType: 'repeat_entity',
        title: `Repeat entity: ${display}`,
        description: `${display} appears in ${rows.length} of ${bearing.length} entity-bearing observations in this stream and jurisdiction (${percentage.toFixed(1)}%), ${quotient.toFixed(2)}x its rate across the full scanned population (${(globalShare * 100).toFixed(1)}%). Grouping uses a declared normalized name key, not resolved identity. Repeat-appearance observation; not misconduct, causation, or a legal finding.`,
        events: rows,
        jurisdiction,
        severity: quotient >= 6 && rows.length >= 50 ? 'high' : 'medium',
        factors: [
          { factor_id: 'local_elevation', weight: 0.3, satisfied: quotient >= 3, explanation: `Local share is ${quotient.toFixed(2)}x the scan-wide rate (declared minimum 3x).` },
          { factor_id: 'strong_elevation', weight: 0.15, satisfied: quotient >= 6, explanation: quotient >= 6 ? 'Local share is at least 6x the scan-wide rate.' : 'Local share is below 6x the scan-wide rate.' },
          { factor_id: 'volume', weight: 0.15, satisfied: rows.length >= 25, explanation: `${rows.length} observations in the pattern (declared full-volume mark 25).` },
          { factor_id: 'spread', weight: 0.1, satisfied: spread, explanation: spread ? 'Appearances span at least two jurisdictions or at least three categories.' : 'Appearances sit inside one jurisdiction and fewer than three categories.' },
          unresolvedResolutionFactor(),
        ],
        statistics: { records_analyzed: partition.length, pattern_count: rows.length, percentage_affected: Number(percentage.toFixed(2)), location_quotient: Number(quotient.toFixed(4)), local_share: Number(localShare.toFixed(6)), global_share: Number(globalShare.toFixed(6)) },
        entityName: display,
        entityKey: key,
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
      candidates.push(candidateBase({
        ruleId: 'atlas.domain3.trend_anomaly',
        signalType: 'trend_anomaly',
        title: `Year-over-year ${direction}: ${priorYear} \u2192 ${currentYear}`,
        description: `Observation volume changed from ${prior.length} in ${priorYear} to ${current.length} in ${currentYear}, a ${magnitude.toFixed(1)}% ${direction}.`,
        events: [...prior, ...current],
        jurisdiction,
        severity: magnitude >= 200 ? 'high' : 'medium',
        factors: [
          { factor_id: 'threshold_change', weight: 0.4, satisfied: true, explanation: `Volume changed ${magnitude.toFixed(1)}% year over year, at or beyond the declared 50% band.` },
          { factor_id: 'prior_year_volume', weight: 0.3, satisfied: prior.length >= 50, explanation: `${prior.length} observations in the prior year (declared full-volume mark 50).` },
          { factor_id: 'current_year_volume', weight: 0.3, satisfied: current.length >= 50, explanation: `${current.length} observations in the current year (declared full-volume mark 50).` },
        ],
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
      const key = entityKeyOf(event);
      if (!key) continue;
      if (!entities.has(key)) entities.set(key, []);
      entities.get(key).push(event);
    }
    for (const [key, entityRows] of entities) {
      const categories = [...new Set(entityRows.map(categoryOf).filter((category) => category !== 'unclassified'))].sort();
      if (entityRows.length < 10 || categories.length < 3) continue;
      const display = mostFrequentText(entityRows.map((event) => entityOf(event))) || key;
      candidates.push(candidateBase({
        ruleId: 'atlas.domain3.cross_category_entity',
        signalType: 'cross_category_entity',
        title: `Cross-category entity: ${display}`,
        description: `${display} appears in ${entityRows.length} observations across ${categories.length} categories in ${jurisdiction}. Grouping uses a declared normalized name key, not resolved identity. Cross-category appearance observation; not misconduct, causation, or a legal finding.`,
        events: entityRows,
        jurisdiction,
        severity: categories.length >= 7 ? 'high' : 'medium',
        factors: [
          { factor_id: 'minimum_breadth', weight: 0.3, satisfied: categories.length >= 3, explanation: `Appears across ${categories.length} categories (declared minimum 3).` },
          { factor_id: 'wide_breadth', weight: 0.2, satisfied: categories.length >= 5, explanation: categories.length >= 5 ? 'Appears across at least five categories.' : 'Appears across fewer than five categories.' },
          { factor_id: 'volume', weight: 0.2, satisfied: entityRows.length >= 25, explanation: `${entityRows.length} observations in the pattern (declared full-volume mark 25).` },
          unresolvedResolutionFactor(),
        ],
        statistics: { records_analyzed: rows.length, pattern_count: entityRows.length, category_count: categories.length, categories },
        entityName: display,
        entityKey: key,
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

export { RULES as DOMAIN3_POPULATION_RULES };

// ---------------------------------------------------------------------------
// Streaming accumulation (2026-11-08 full-set replay correction).
//
// The array detectors above group the whole event array in memory, which
// capped the replay at 100,000 observations. The accumulator below consumes
// events one at a time in loader order (stream_id, offset) and retains only
// counters, sets, name-frequency maps, and 5-field event stubs
// ({stream_id, offset, event_identity_hash, timestamp, ingested_at}) — the
// exact fields candidateBase consumes. finalizePopulationCandidates must
// produce candidates identical to deriveDomain3PopulationCandidates over the
// same events (modulo detected_at); the equivalence contract test and the
// production verification script enforce that.
// ---------------------------------------------------------------------------

export function mostFrequentFromCounts(counts) {
  let best = null;
  let bestCount = -1;
  for (const [value, count] of counts) {
    if (count > bestCount || (count === bestCount && (best === null || value < best))) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function pushIndex(map, key, index) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(index);
}

function bumpCount(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function bumpNameCount(map, key, raw) {
  if (!map.has(key)) map.set(key, new Map());
  bumpCount(map.get(key), raw);
}

export function createPopulationAccumulator() {
  return {
    total: 0,
    stubs: [],
    categorizedTotal: 0,
    categoryGlobal: new Map(),
    geographyTotal: 0,
    geographyGlobal: new Map(),
    entityTotal: 0,
    entityGlobal: new Map(),
    partitions: new Map(),
    crossCategory: new Map(),
    crossJurisdiction: new Map(),
  };
}

export function accumulatePopulationEvent(acc, event) {
  if (!event?.event_identity_hash) return;
  const index = acc.stubs.length;
  acc.stubs.push({
    stream_id: event.stream_id,
    offset: event.offset,
    event_identity_hash: event.event_identity_hash,
    timestamp: event.timestamp,
    ingested_at: event.ingested_at,
  });
  acc.total += 1;

  const category = categoryOf(event);
  const geography = geographyOf(event);
  const rawEntity = entityOf(event);
  const entityKey = normalizeEntityKey(rawEntity);
  const jurisdiction = jurisdictionOf(event);
  const partitionKey = `${event.stream_id}::${jurisdiction}`;

  if (!acc.partitions.has(partitionKey)) {
    acc.partitions.set(partitionKey, {
      stream_id: event.stream_id,
      jurisdiction,
      total: 0,
      categorized: 0,
      geographyBearing: 0,
      entityBearing: 0,
      byCategory: new Map(),
      byGeography: new Map(),
      byEntity: new Map(),
      byYear: new Map(),
      entityNames: new Map(),
      entityJurisdictions: new Map(),
      entityCategories: new Map(),
    });
  }
  const partition = acc.partitions.get(partitionKey);
  partition.total += 1;

  if (category !== 'unclassified') {
    acc.categorizedTotal += 1;
    bumpCount(acc.categoryGlobal, category);
    partition.categorized += 1;
    pushIndex(partition.byCategory, category, index);
  }
  if (geography) {
    acc.geographyTotal += 1;
    bumpCount(acc.geographyGlobal, geography);
    partition.geographyBearing += 1;
    pushIndex(partition.byGeography, geography, index);
  }
  if (entityKey) {
    acc.entityTotal += 1;
    bumpCount(acc.entityGlobal, entityKey);
    partition.entityBearing += 1;
    pushIndex(partition.byEntity, entityKey, index);
    bumpNameCount(partition.entityNames, entityKey, rawEntity);
    if (!partition.entityJurisdictions.has(entityKey)) partition.entityJurisdictions.set(entityKey, new Set());
    partition.entityJurisdictions.get(entityKey).add(jurisdiction);
    if (!partition.entityCategories.has(entityKey)) partition.entityCategories.set(entityKey, new Set());
    partition.entityCategories.get(entityKey).add(category);

    if (!acc.crossJurisdiction.has(entityKey)) {
      acc.crossJurisdiction.set(entityKey, { indexes: [], jurisdictions: new Set(), streams: new Set(), names: new Map() });
    }
    const crossJur = acc.crossJurisdiction.get(entityKey);
    crossJur.indexes.push(index);
    if (jurisdiction && jurisdiction !== 'unknown') crossJur.jurisdictions.add(jurisdiction);
    crossJur.streams.add(event.stream_id);
    bumpCount(crossJur.names, rawEntity);

    if (!acc.crossCategory.has(jurisdiction)) acc.crossCategory.set(jurisdiction, { total: 0, byEntity: new Map() });
    const crossCat = acc.crossCategory.get(jurisdiction);
    if (!crossCat.byEntity.has(entityKey)) crossCat.byEntity.set(entityKey, { indexes: [], categories: new Set(), names: new Map() });
    const crossEntity = crossCat.byEntity.get(entityKey);
    crossEntity.indexes.push(index);
    if (category !== 'unclassified') crossEntity.categories.add(category);
    bumpCount(crossEntity.names, rawEntity);
  }
  if (!acc.crossCategory.has(jurisdiction)) acc.crossCategory.set(jurisdiction, { total: 0, byEntity: new Map() });
  acc.crossCategory.get(jurisdiction).total += 1;

  const year = new Date(event.timestamp).getUTCFullYear();
  if (Number.isFinite(year)) pushIndex(partition.byYear, year, index);
}

function stubsAt(acc, indexes) {
  return indexes.map((index) => acc.stubs[index]);
}

export function finalizePopulationCandidates(acc) {
  const candidates = [];

  // frequency_spike + geographic_cluster + repeat_entity share the
  // partition/concentration shape; each block mirrors its array detector.
  for (const partition of acc.partitions.values()) {
    if (partition.categorized >= 20) {
      for (const [category, indexes] of partition.byCategory) {
        const rows = stubsAt(acc, indexes);
        const localShare = rows.length / partition.categorized;
        const globalShare = (acc.categoryGlobal.get(category) || 0) / acc.categorizedTotal;
        const quotient = locationQuotient(rows.length, partition.categorized, acc.categoryGlobal.get(category) || 0, acc.categorizedTotal);
        if (rows.length < 10 || quotient < 2) continue;
        const jurisdiction = partition.jurisdiction;
        const percentage = localShare * 100;
        candidates.push(candidateBase({
          ruleId: 'atlas.domain3.frequency_spike',
          signalType: 'frequency_spike',
          title: `Frequency spike: ${category}`,
          description: `${category} accounts for ${rows.length} of ${partition.categorized} categorized observations in this stream and jurisdiction (${percentage.toFixed(1)}%), ${quotient.toFixed(2)}x its rate across the full scanned population (${(globalShare * 100).toFixed(1)}%). Concentration observation; not misconduct, causation, or a legal finding.`,
          events: rows,
          jurisdiction,
          severity: quotient >= 4 && rows.length >= 50 ? 'high' : 'medium',
          factors: [
            { factor_id: 'local_elevation', weight: 0.45, satisfied: quotient >= 2, explanation: `Local share is ${quotient.toFixed(2)}x the scan-wide rate (declared minimum 2x).` },
            { factor_id: 'strong_elevation', weight: 0.2, satisfied: quotient >= 4, explanation: quotient >= 4 ? 'Local share is at least 4x the scan-wide rate.' : 'Local share is below 4x the scan-wide rate.' },
            { factor_id: 'volume', weight: 0.2, satisfied: rows.length >= 25, explanation: `${rows.length} observations in the pattern (declared full-volume mark 25).` },
            { factor_id: 'partition_share', weight: 0.15, satisfied: localShare >= 0.1, explanation: `Pattern is ${(localShare * 100).toFixed(1)}% of its partition (declared share mark 10%).` },
          ],
          statistics: { records_analyzed: partition.total, pattern_count: rows.length, percentage_affected: Number(percentage.toFixed(2)), location_quotient: Number(quotient.toFixed(4)), local_share: Number(localShare.toFixed(6)), global_share: Number(globalShare.toFixed(6)), category },
        }));
      }
    }

    if (partition.geographyBearing >= 20) {
      for (const [geography, indexes] of partition.byGeography) {
        const rows = stubsAt(acc, indexes);
        const localShare = rows.length / partition.geographyBearing;
        const globalShare = (acc.geographyGlobal.get(geography) || 0) / acc.geographyTotal;
        const quotient = locationQuotient(rows.length, partition.geographyBearing, acc.geographyGlobal.get(geography) || 0, acc.geographyTotal);
        if (rows.length < 10 || quotient < 2) continue;
        const jurisdiction = partition.jurisdiction;
        const percentage = localShare * 100;
        candidates.push(candidateBase({
          ruleId: 'atlas.domain3.geographic_cluster',
          signalType: 'geographic_cluster',
          title: `Geographic concentration: ${geography}`,
          description: `${geography} contains ${rows.length} of ${partition.geographyBearing} geography-bearing observations in this stream and jurisdiction (${percentage.toFixed(1)}%), ${quotient.toFixed(2)}x its rate across the full scanned population (${(globalShare * 100).toFixed(1)}%). Concentration observation; not misconduct, causation, or a legal finding.`,
          events: rows,
          jurisdiction,
          severity: quotient >= 4 && rows.length >= 50 ? 'high' : 'medium',
          factors: [
            { factor_id: 'local_elevation', weight: 0.45, satisfied: quotient >= 2, explanation: `Local share is ${quotient.toFixed(2)}x the scan-wide rate (declared minimum 2x).` },
            { factor_id: 'strong_elevation', weight: 0.2, satisfied: quotient >= 4, explanation: quotient >= 4 ? 'Local share is at least 4x the scan-wide rate.' : 'Local share is below 4x the scan-wide rate.' },
            { factor_id: 'volume', weight: 0.2, satisfied: rows.length >= 25, explanation: `${rows.length} observations in the pattern (declared full-volume mark 25).` },
            { factor_id: 'partition_share', weight: 0.15, satisfied: localShare >= 0.1, explanation: `Pattern is ${(localShare * 100).toFixed(1)}% of its partition (declared share mark 10%).` },
          ],
          statistics: { records_analyzed: partition.total, pattern_count: rows.length, percentage_affected: Number(percentage.toFixed(2)), location_quotient: Number(quotient.toFixed(4)), local_share: Number(localShare.toFixed(6)), global_share: Number(globalShare.toFixed(6)), geography },
        }));
      }
    }

    if (partition.entityBearing >= 20) {
      for (const [key, indexes] of partition.byEntity) {
        const rows = stubsAt(acc, indexes);
        const localShare = rows.length / partition.entityBearing;
        const globalShare = (acc.entityGlobal.get(key) || 0) / acc.entityTotal;
        const quotient = locationQuotient(rows.length, partition.entityBearing, acc.entityGlobal.get(key) || 0, acc.entityTotal);
        if (rows.length < 10 || quotient < 3) continue;
        const display = mostFrequentFromCounts(partition.entityNames.get(key) || new Map()) || key;
        const jurisdiction = partition.jurisdiction;
        const percentage = localShare * 100;
        const spread = (partition.entityJurisdictions.get(key)?.size || 0) >= 2
          || (partition.entityCategories.get(key)?.size || 0) >= 3;
        candidates.push(candidateBase({
          ruleId: 'atlas.domain3.repeat_entity',
          signalType: 'repeat_entity',
          title: `Repeat entity: ${display}`,
          description: `${display} appears in ${rows.length} of ${partition.entityBearing} entity-bearing observations in this stream and jurisdiction (${percentage.toFixed(1)}%), ${quotient.toFixed(2)}x its rate across the full scanned population (${(globalShare * 100).toFixed(1)}%). Grouping uses a declared normalized name key, not resolved identity. Repeat-appearance observation; not misconduct, causation, or a legal finding.`,
          events: rows,
          jurisdiction,
          severity: quotient >= 6 && rows.length >= 50 ? 'high' : 'medium',
          factors: [
            { factor_id: 'local_elevation', weight: 0.3, satisfied: quotient >= 3, explanation: `Local share is ${quotient.toFixed(2)}x the scan-wide rate (declared minimum 3x).` },
            { factor_id: 'strong_elevation', weight: 0.15, satisfied: quotient >= 6, explanation: quotient >= 6 ? 'Local share is at least 6x the scan-wide rate.' : 'Local share is below 6x the scan-wide rate.' },
            { factor_id: 'volume', weight: 0.15, satisfied: rows.length >= 25, explanation: `${rows.length} observations in the pattern (declared full-volume mark 25).` },
            { factor_id: 'spread', weight: 0.1, satisfied: spread, explanation: spread ? 'Appearances span at least two jurisdictions or at least three categories.' : 'Appearances sit inside one jurisdiction and fewer than three categories.' },
            unresolvedResolutionFactor(),
          ],
          statistics: { records_analyzed: partition.total, pattern_count: rows.length, percentage_affected: Number(percentage.toFixed(2)), location_quotient: Number(quotient.toFixed(4)), local_share: Number(localShare.toFixed(6)), global_share: Number(globalShare.toFixed(6)) },
          entityName: display,
          entityKey: key,
        }));
      }
    }

    // trend_anomaly
    const orderedYears = [...partition.byYear.keys()].sort((a, b) => a - b);
    for (let i = 1; i < orderedYears.length; i += 1) {
      const priorYear = orderedYears[i - 1];
      const currentYear = orderedYears[i];
      if (currentYear !== priorYear + 1) continue;
      const prior = stubsAt(acc, partition.byYear.get(priorYear));
      const current = stubsAt(acc, partition.byYear.get(currentYear));
      if (prior.length < 10) continue;
      const percentChange = ((current.length - prior.length) / prior.length) * 100;
      const magnitude = Math.abs(percentChange);
      if (magnitude < 50) continue;
      const jurisdiction = partition.jurisdiction;
      const direction = percentChange >= 0 ? 'increase' : 'decrease';
      candidates.push(candidateBase({
        ruleId: 'atlas.domain3.trend_anomaly',
        signalType: 'trend_anomaly',
        title: `Year-over-year ${direction}: ${priorYear} \u2192 ${currentYear}`,
        description: `Observation volume changed from ${prior.length} in ${priorYear} to ${current.length} in ${currentYear}, a ${magnitude.toFixed(1)}% ${direction}.`,
        events: [...prior, ...current],
        jurisdiction,
        severity: magnitude >= 200 ? 'high' : 'medium',
        factors: [
          { factor_id: 'threshold_change', weight: 0.4, satisfied: true, explanation: `Volume changed ${magnitude.toFixed(1)}% year over year, at or beyond the declared 50% band.` },
          { factor_id: 'prior_year_volume', weight: 0.3, satisfied: prior.length >= 50, explanation: `${prior.length} observations in the prior year (declared full-volume mark 50).` },
          { factor_id: 'current_year_volume', weight: 0.3, satisfied: current.length >= 50, explanation: `${current.length} observations in the current year (declared full-volume mark 50).` },
        ],
        statistics: { prior_year: priorYear, current_year: currentYear, prior_count: prior.length, current_count: current.length, percent_change: Number(percentChange.toFixed(4)), records_analyzed: partition.total },
      }));
    }
  }

  // cross_category_entity
  for (const [jurisdiction, crossCat] of acc.crossCategory) {
    for (const [key, group] of crossCat.byEntity) {
      const categories = [...group.categories].sort();
      if (group.indexes.length < 10 || categories.length < 3) continue;
      const rows = stubsAt(acc, group.indexes);
      const display = mostFrequentFromCounts(group.names) || key;
      candidates.push(candidateBase({
        ruleId: 'atlas.domain3.cross_category_entity',
        signalType: 'cross_category_entity',
        title: `Cross-category entity: ${display}`,
        description: `${display} appears in ${group.indexes.length} observations across ${categories.length} categories in ${jurisdiction}. Grouping uses a declared normalized name key, not resolved identity. Cross-category appearance observation; not misconduct, causation, or a legal finding.`,
        events: rows,
        jurisdiction,
        severity: categories.length >= 7 ? 'high' : 'medium',
        factors: [
          { factor_id: 'minimum_breadth', weight: 0.3, satisfied: categories.length >= 3, explanation: `Appears across ${categories.length} categories (declared minimum 3).` },
          { factor_id: 'wide_breadth', weight: 0.2, satisfied: categories.length >= 5, explanation: categories.length >= 5 ? 'Appears across at least five categories.' : 'Appears across fewer than five categories.' },
          { factor_id: 'volume', weight: 0.2, satisfied: group.indexes.length >= 25, explanation: `${group.indexes.length} observations in the pattern (declared full-volume mark 25).` },
          unresolvedResolutionFactor(),
        ],
        statistics: { records_analyzed: crossCat.total, pattern_count: group.indexes.length, category_count: categories.length, categories },
        entityName: display,
        entityKey: key,
      }));
    }
  }

  return candidates.sort((a, b) => a.candidate_hash.localeCompare(b.candidate_hash));
}

