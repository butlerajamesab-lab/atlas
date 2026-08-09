import express from 'express';
import { supabase } from '../lib/supabaseClient.js';
import { listDomainSpaceRules } from '../domain-space/domainSpace.js';
import {
  DEFAULT_HARDENED_FILTERS,
  listAtlasFilters,
  FILTER_REGISTRY_VERSION,
} from '../filters/filterStack.js';
import {
  listStructuralLenses,
  STRUCTURAL_LENS_REGISTRY_VERSION,
} from '../lenses/structuralLenses.js';
import { ATLAS_MODULE_CONTRACT_VERSION } from '../modules/moduleDefinition.js';
import { ADAPTER_REGISTRY, ADAPTER_STREAM_IDS } from '../services/scheduler.js';

const LEGISLATIVE_STREAM_ID = 'civic_genome_legislative_versions';
const FRONTEND_READ_MODEL_VERSION = 'atlas.frontend_read_model.v3';
const PUBLIC_READ_CACHE_TTL_MS = 15_000;

const ADAPTERS_BY_STREAM = new Map(ADAPTER_REGISTRY.map((adapter) => [
  ADAPTER_STREAM_IDS[adapter.name],
  adapter,
]));

function safeRuntimeStream(row) {
  const adapter = ADAPTERS_BY_STREAM.get(row.stream_id);
  return {
    stream_id: row.stream_id,
    source_id: row.source_id,
    jurisdiction_id: row.jurisdiction_id,
    module_hint: row.module_hint,
    throughput_profile: row.throughput_profile,
    safety_profile: row.safety_profile,
    governance_contract_id: row.governance_contract_id,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    observation_count: Number(row.event_count ?? 0),
    identity_bound_observation_count: Number(row.identity_count ?? 0),
    observation_classification_count: Number(row.signal_type_count ?? 0),
    first_observed_at: row.first_event_at,
    latest_observed_at: row.latest_event_at,
    latest_ingested_at: row.latest_ingested_at,
    runnable: Boolean(adapter),
    adapter_name: adapter?.name ?? null,
    schedule_priority: adapter?.priority ?? null,
    interval_hours: adapter ? Math.round(adapter.intervalMs / 3600_000) : null,
  };
}

function readinessSummary(rows) {
  const summary = {
    total: rows.length,
    ready: 0,
    degraded: 0,
    blocked: 0,
    unknown: 0,
    not_active: 0,
  };
  for (const row of rows) {
    const key = row.operational_readiness_state;
    if (Object.hasOwn(summary, key)) summary[key] += 1;
  }
  return summary;
}

function safeSourceRow(row) {
  return {
    connector_id: row.connector_id,
    source_name: row.source_name,
    adapter_class: row.adapter_class,
    connector_active: row.connector_active,
    schema_id: row.schema_id,
    schema_name: row.schema_name,
    schema_version: row.schema_version,
    schema_active: row.schema_active,
    health_observed_at: row.health_observed_at,
    health_status: row.health_status,
    freshness_status: row.freshness_status,
    schema_status: row.schema_status,
    latency_ms: row.latency_ms,
    error_rate: row.error_rate,
    duplicate_rate: row.duplicate_rate,
    missing_required_field_rate: row.missing_required_field_rate,
    records_observed: row.records_observed,
    active_fallback_count: row.active_fallback_count,
    operational_readiness_state: row.operational_readiness_state,
  };
}

function createPublicReadCache(ttlMs = PUBLIC_READ_CACHE_TTL_MS) {
  const entries = new Map();
  return async function cachedRead(key, loader) {
    const existing = entries.get(key);
    if (existing && (existing.expiresAt === null || existing.expiresAt > Date.now())) {
      return existing.promise;
    }
    const entry = { expiresAt: null, promise: null };
    entry.promise = Promise.resolve()
      .then(loader)
      .then((value) => {
        entry.expiresAt = Date.now() + ttlMs;
        return value;
      })
      .catch((error) => {
        if (entries.get(key) === entry) entries.delete(key);
        throw error;
      });
    entries.set(key, entry);
    return entry.promise;
  };
}

export function atlasUiRouter({ apiError }) {
  const router = express.Router();
  const cachedRead = createPublicReadCache();

  async function signalDerivationRead() {
    return cachedRead('signal-derivation', async () => {
      const { data, error } = await supabase
        .from('v_atlas_ui_signal_derivation_v3')
        .select('*')
        .single();
      if (error) throw error;
      return {
        read_model_version: FRONTEND_READ_MODEL_VERSION,
        summary: data.summary,
        observation_classifications: data.observation_classifications ?? [],
        canonical_signal_types: data.canonical_signal_types ?? [],
        candidate_rules: data.candidate_rules ?? [],
        convergence_runs: data.convergence_runs ?? [],
        semantics: {
          observations: 'Rows in the legacy-named public.signal_events store are normalized source observations. An observation is not automatically a civic signal.',
          signals: 'A civic signal exists only after a declared, versioned derivation with source identity, rule identity, provenance, and a reproducible output.',
          candidates: 'Signal candidates remain distinct from canonical atlas.signals and from Lighthouse-governed findings.',
          convergence: 'Convergence receipts record the bounded source population, transformed signal population, deduplicated signal population, rules, configuration, and output hash.',
          legacy_outputs: 'Legacy prime_patterns are shown separately. Stream-health alerts are operational diagnostics, not civic convergence conclusions.',
        },
      };
    });
  }

  router.get('/ui-api/overview', async (_req, res) => {
    try {
      const payload = await cachedRead('overview', async () => {
        const { data, error } = await supabase
          .from('v_atlas_ui_overview_v3')
          .select('*')
          .single();
        if (error) throw error;

        const streams = (data.streams ?? []).map(safeRuntimeStream);
        const sources = (data.sources ?? []).map(safeSourceRow);
        const derivation = data.derivation;
        const legislativeStream = streams.find((row) => row.stream_id === LEGISLATIVE_STREAM_ID);
        return {
          read_model_version: FRONTEND_READ_MODEL_VERSION,
          platform: 'Atlas',
          observed_at: derivation.observed_at,
          boundary: 'Deterministic source observation, governed signal derivation, relationship, convergence, and receipt engine. No legal interpretation or consequence ownership.',
          counts: {
            streams: streams.length,
            active_streams: streams.filter((row) => row.status === 'active').length,
            runnable_streams: streams.filter((row) => row.runnable).length,
            streams_with_observations: Number(derivation.streams_with_observations ?? 0),
            zero_observation_streams: streams.filter((row) => row.observation_count === 0).length,
            normalized_observations: Number(derivation.normalized_observations ?? 0),
            identity_bound_observations: Number(derivation.identity_bound_observations ?? 0),
            observation_classifications: Number(derivation.observation_classifications ?? 0),
            canonical_signals: Number(derivation.canonical_signals ?? 0),
            canonical_signal_types: Number(derivation.canonical_signal_types ?? 0),
            receipted_canonical_signals: Number(derivation.receipted_canonical_signals ?? 0),
            unreceipted_canonical_signals: Number(derivation.unreceipted_canonical_signals ?? 0),
            signal_candidates: Number(derivation.signal_candidates ?? 0),
            verified_signal_candidates: Number(derivation.verified_signal_candidates ?? 0),
            active_signal_rules: Number(derivation.active_signal_rules ?? 0),
            convergence_runs: Number(derivation.convergence_runs ?? 0),
            convergence_receipts: Number(derivation.convergence_receipts ?? 0),
            convergence_events: Number(derivation.convergence_events ?? 0),
            legacy_investigation_outputs: Number(derivation.legacy_investigation_outputs ?? 0),
            stream_health_alerts: Number(derivation.stream_health_alerts ?? 0),
            legacy_investigation_jobs: Number(derivation.legacy_investigation_jobs ?? 0),
            legislative_version_observations: Number(legislativeStream?.observation_count ?? 0),
            sources: sources.length,
          },
          latest_observation_at: derivation.latest_observation_at,
          latest_observation_ingested_at: derivation.latest_observation_ingested_at,
          latest_canonical_signal_at: derivation.latest_canonical_signal_at,
          latest_signal_candidate_at: derivation.latest_signal_candidate_at,
          latest_convergence_at: derivation.latest_convergence_at,
          source_readiness: readinessSummary(sources),
          streams,
          sources,
        };
      });
      res.json(payload);
    } catch (error) {
      apiError(res, 500, 'Atlas frontend overview failed', error instanceof Error ? error.message : String(error));
    }
  });

  router.get('/ui-api/streams', async (_req, res) => {
    try {
      const payload = await cachedRead('streams', async () => {
        const { data, error } = await supabase
          .from('v_atlas_stream_runtime_summary_v1')
          .select('*')
          .order('stream_id');
        if (error) throw error;
        return {
          read_model_version: FRONTEND_READ_MODEL_VERSION,
          observed_at: new Date().toISOString(),
          streams: (data ?? []).map(safeRuntimeStream),
          semantics: 'Registered is a database contract. Runnable means a compiled adapter is bound. Observed means at least one normalized source observation exists. Signal derivation is measured separately and is never inferred from observation volume.',
        };
      });
      return res.json(payload);
    } catch (error) {
      return apiError(res, 500, 'Atlas stream runtime read failed', error instanceof Error ? error.message : String(error));
    }
  });

  router.get('/ui-api/signal-derivation', async (_req, res) => {
    try {
      return res.json(await signalDerivationRead());
    } catch (error) {
      return apiError(res, 500, 'Atlas signal derivation read failed', error instanceof Error ? error.message : String(error));
    }
  });

  router.get('/ui-api/signal-substrate', async (_req, res) => {
    try {
      return res.json({
        ...(await signalDerivationRead()),
        deprecated_alias: '/ui-api/signal-substrate',
        canonical_route: '/ui-api/signal-derivation',
      });
    } catch (error) {
      return apiError(res, 500, 'Atlas signal derivation compatibility read failed', error instanceof Error ? error.message : String(error));
    }
  });

  router.get('/ui-api/legislative-history', async (req, res) => {
    try {
      const requested = Number.parseInt(String(req.query.limit ?? '100'), 10);
      const limit = Number.isSafeInteger(requested) ? Math.min(Math.max(requested, 1), 100) : 100;
      const { data, error } = await supabase
        .from('signal_events')
        .select('stream_id,offset,timestamp,signal_type,spacetime,provenance,payload,source_id,jurisdiction_id,module_hint,ingested_at,event_identity_hash')
        .eq('stream_id', LEGISLATIVE_STREAM_ID)
        .order('offset', { ascending: true })
        .limit(limit);
      if (error) throw error;
      const rows = data ?? [];
      const states = {};
      for (const row of rows) {
        const state = row.payload?.version?.processing_state ?? 'unknown';
        states[state] = (states[state] ?? 0) + 1;
      }
      res.json({
        read_model_version: FRONTEND_READ_MODEL_VERSION,
        stream_id: LEGISLATIVE_STREAM_ID,
        observation_count: rows.length,
        processing_state_counts: states,
        observations: rows,
        semantics: 'One Atlas observation per governed Civic Genome bill version. Failed amendments remain observations; source-native Prism/Rosetta states are preserved rather than collapsed.',
      });
    } catch (error) {
      apiError(res, 500, 'Atlas legislative history read failed', error instanceof Error ? error.message : String(error));
    }
  });

  router.get('/ui-api/contracts', (_req, res) => {
    res.json({
      read_model_version: FRONTEND_READ_MODEL_VERSION,
      domain_space_rules: listDomainSpaceRules(),
      filter_registry_version: FILTER_REGISTRY_VERSION,
      filters: listAtlasFilters(),
      default_hardened_filters: DEFAULT_HARDENED_FILTERS,
      structural_lens_registry_version: STRUCTURAL_LENS_REGISTRY_VERSION,
      structural_lenses: listStructuralLenses(),
      module_contract_version: ATLAS_MODULE_CONTRACT_VERSION,
      ownership_boundary: {
        atlas: 'source-bound observations, governed civic-signal derivation, domain-space comparison, structural relationships, convergence math, deterministic receipts',
        docket: 'official legislative retrieval and history',
        rosetta: 'legal decomposition and source truth',
        civic_genome: 'bill/family identity, versions, lineage, events, momentum',
        prism: 'verification and contradiction/incompleteness receipts',
        kaleidoscope: 'generation comparison and consequence projection',
        lighthouse: 'presentation and civic operating environment',
      },
    });
  });

  return router;
}

export { FRONTEND_READ_MODEL_VERSION, LEGISLATIVE_STREAM_ID };
