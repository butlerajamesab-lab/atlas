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
const FRONTEND_READ_MODEL_VERSION = 'atlas.frontend_read_model.v2';

const ADAPTERS_BY_STREAM = new Map(ADAPTER_REGISTRY.map((adapter) => [
  ADAPTER_STREAM_IDS[adapter.name],
  adapter,
]));

function safeRuntimeStream(row) {
  const adapter = ADAPTERS_BY_STREAM.get(row.stream_id);
  return {
    ...row,
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

export function atlasUiRouter({ apiError }) {
  const router = express.Router();

  router.get('/ui-api/overview', async (_req, res) => {
    try {
      const { data, error } = await supabase
        .from('v_atlas_ui_overview_v2')
        .select('*')
        .single();
      if (error) throw error;

      const streams = (data.streams ?? []).map(safeRuntimeStream);
      const sources = (data.sources ?? []).map(safeSourceRow);
      const substrate = data.substrate;
      const legislativeStream = streams.find((row) => row.stream_id === LEGISLATIVE_STREAM_ID);
      res.json({
        read_model_version: FRONTEND_READ_MODEL_VERSION,
        platform: 'Atlas',
        observed_at: substrate.observed_at,
        boundary: 'Deterministic observation, normalization, relationship, convergence, and receipt engine. No legal interpretation or consequence ownership.',
        counts: {
          streams: streams.length,
          active_streams: streams.filter((row) => row.status === 'active').length,
          runnable_streams: streams.filter((row) => row.runnable).length,
          producing_streams: Number(substrate.producing_streams ?? 0),
          zero_event_streams: streams.filter((row) => Number(row.event_count) === 0).length,
          signal_events: Number(substrate.signal_events ?? 0),
          identity_bound_events: Number(substrate.identity_bound_events ?? 0),
          signal_types: Number(substrate.signal_types ?? 0),
          prime_patterns: Number(substrate.prime_patterns ?? 0),
          investigative_jobs: Number(substrate.investigative_jobs ?? 0),
          legislative_version_observations: Number(legislativeStream?.event_count ?? 0),
          sources: sources.length,
        },
        latest_signal_at: substrate.latest_signal_at,
        latest_ingested_at: substrate.latest_ingested_at,
        source_readiness: readinessSummary(sources),
        streams,
        sources,
      });
    } catch (error) {
      apiError(res, 500, 'Atlas frontend overview failed', error instanceof Error ? error.message : String(error));
    }
  });

  router.get('/ui-api/streams', async (_req, res) => {
    try {
      const { data, error } = await supabase
        .from('v_atlas_stream_runtime_summary_v1')
        .select('*')
        .order('stream_id');
      if (error) throw error;
      const streams = (data ?? []).map(safeRuntimeStream);
      return res.json({
        read_model_version: FRONTEND_READ_MODEL_VERSION,
        observed_at: new Date().toISOString(),
        streams,
        semantics: 'Registered is a database contract. Runnable means a compiled adapter is bound. Producing means at least one canonical signal event exists. None of these states is inferred from another.',
      });
    } catch (error) {
      return apiError(res, 500, 'Atlas stream runtime read failed', error instanceof Error ? error.message : String(error));
    }
  });

  router.get('/ui-api/signal-substrate', async (_req, res) => {
    try {
      const { data, error } = await supabase
        .from('v_atlas_ui_signal_substrate_v2')
        .select('*')
        .single();
      if (error) throw error;
      return res.json({
        read_model_version: FRONTEND_READ_MODEL_VERSION,
        summary: data.summary,
        signal_types: data.signal_types ?? [],
        semantics: 'Signal events are observations. Prime patterns are persisted deterministic investigation outputs. Neither is a legal interpretation or projected consequence.',
      });
    } catch (error) {
      return apiError(res, 500, 'Atlas signal substrate read failed', error instanceof Error ? error.message : String(error));
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
        atlas: 'observations, domain-space comparison, structural relationships, convergence math, deterministic receipts',
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
