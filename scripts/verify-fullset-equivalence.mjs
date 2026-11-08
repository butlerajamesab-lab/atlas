// One-off verification for the 2026-11-08 full-set replay correction.
// Runs inside the Atlas service environment (Render one-off job), where
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY live.
//
// Phase 1 (equivalence): derives candidates over the SAME bounded window
// through the old array path and the new streaming-accumulator path and
// diffs them. Any difference beyond population detected_at (wall clock)
// fails the check.
// Phase 2 (full-set rehearsal): streams the complete reservoir through
// the accumulators and reports per-rule candidate counts, wall time, and
// peak heap — the costing receipt for the first live full derivation.
//
// Prints exactly one receipt line: FULLSET_VERIFY {json}
import { createClient } from '@supabase/supabase-js';
import {
  accumulatePopulationEvent,
  createPopulationAccumulator,
  deriveDomain3PopulationCandidates,
  finalizePopulationCandidates,
} from '../src/services/domain3PopulationDetectorService.js';
import {
  accumulateIntegrityEvent,
  createIntegrityAccumulator,
  deriveIntegrityPatternCandidates,
  deriveIntegrityPatternCandidatesFromInput,
  summarizeIntegrityPatternReadiness,
  summarizeIntegrityPatternReadinessFromInput,
} from '../src/services/integrityPatternDetectorService.js';
import {
  deriveCrossJurisdictionCandidates,
  finalizeCrossJurisdictionCandidates,
  loadCanonicalObservations,
  streamCanonicalObservations,
} from '../src/services/domain3PopulationReplayService.js';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]),
  );
}

function stripWallClock(candidates) {
  return candidates.map((candidate) => {
    const copy = { ...candidate };
    delete copy.detected_at;
    return copy;
  });
}

function diffCandidates(label, oldOnes, newOnes) {
  const oldCanon = canonical(stripWallClock(oldOnes));
  const newCanon = canonical(stripWallClock(newOnes));
  const oldByHash = new Map(oldCanon.map((c) => [c.candidate_hash, JSON.stringify(c)]));
  const newByHash = new Map(newCanon.map((c) => [c.candidate_hash, JSON.stringify(c)]));
  let mismatches = 0;
  const samples = [];
  for (const [hash, text] of oldByHash) {
    if (!newByHash.has(hash)) { mismatches += 1; if (samples.length < 3) samples.push({ hash, side: 'old_only' }); }
    else if (newByHash.get(hash) !== text) { mismatches += 1; if (samples.length < 3) samples.push({ hash, side: 'content_diff' }); }
  }
  for (const hash of newByHash.keys()) {
    if (!oldByHash.has(hash)) { mismatches += 1; if (samples.length < 3) samples.push({ hash, side: 'new_only' }); }
  }
  return { label, old_count: oldOnes.length, new_count: newOnes.length, mismatches, samples };
}

const started = Date.now();
const report = { ok: false, phases: {} };
try {
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Phase 1 — equivalence over the bounded window.
  const windowScan = await loadCanonicalObservations(client, 100000);
  const events = windowScan.observations;
  const oldPopulation = deriveDomain3PopulationCandidates(events);
  const oldCross = deriveCrossJurisdictionCandidates(events);
  const oldIntegrity = deriveIntegrityPatternCandidates(events);
  const oldReadiness = summarizeIntegrityPatternReadiness(events);

  const popAcc = createPopulationAccumulator();
  const intAcc = createIntegrityAccumulator();
  for (const event of events) {
    accumulatePopulationEvent(popAcc, event);
    accumulateIntegrityEvent(intAcc, event);
  }
  const newPopulation = finalizePopulationCandidates(popAcc);
  const newCross = finalizeCrossJurisdictionCandidates(popAcc);
  const newIntegrity = deriveIntegrityPatternCandidatesFromInput(intAcc.input);
  const newReadiness = summarizeIntegrityPatternReadinessFromInput(intAcc.input, intAcc.scanned);

  const diffs = [
    diffCandidates('population', oldPopulation, newPopulation),
    diffCandidates('cross_jurisdiction', oldCross, newCross),
    diffCandidates('integrity', oldIntegrity, newIntegrity),
  ];
  const readinessEqual = JSON.stringify(canonical(oldReadiness)) === JSON.stringify(canonical(newReadiness));
  report.phases.equivalence = {
    window_events: events.length,
    window_complete: windowScan.complete,
    diffs,
    readiness_equal: readinessEqual,
    heap_mb_after_window: Math.round(process.memoryUsage().heapUsed / 1048576),
  };

  // Phase 2 — full-set rehearsal (derive only; nothing persists).
  const fullPop = createPopulationAccumulator();
  const fullInt = createIntegrityAccumulator();
  const fullStarted = Date.now();
  const total = await streamCanonicalObservations(client, (event) => {
    accumulatePopulationEvent(fullPop, event);
    accumulateIntegrityEvent(fullInt, event);
  });
  const fullCandidates = [
    ...finalizePopulationCandidates(fullPop),
    ...finalizeCrossJurisdictionCandidates(fullPop),
    ...deriveIntegrityPatternCandidatesFromInput(fullInt.input),
  ];
  const perRule = {};
  for (const candidate of fullCandidates) {
    perRule[candidate.rule_id] = (perRule[candidate.rule_id] || 0) + 1;
  }
  report.phases.fullset = {
    events_streamed: total,
    wall_ms: Date.now() - fullStarted,
    candidates_derived: fullCandidates.length,
    per_rule: perRule,
    heap_mb_peak: Math.round(process.memoryUsage().heapUsed / 1048576),
  };

  report.ok = diffs.every((diff) => diff.mismatches === 0) && readinessEqual;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
}
report.wall_ms_total = Date.now() - started;
console.log(`FULLSET_VERIFY ${JSON.stringify(report)}`);
process.exit(report.ok ? 0 : 1);
