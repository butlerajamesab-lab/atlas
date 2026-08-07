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

const LEGISLATIVE_STREAM_ID = 'civic_genome_legislative_versions';
const FRONTEND_READ_MODEL_VERSION = 'atlas.frontend_read_model.v1.1';
const CONVERGENCE_EXPLORER_READ_MODEL_VERSION = 'atlas.convergence_explorer.v1';
const SHA256 = /^[0-9a-f]{64}$/;

async function exactCount(table, apply = null) {
  let query = supabase.from(table).select('*', { count: 'exact', head: true });
  if (apply) query = apply(query);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
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
      const [streamsResult, readinessResult, totalEvents, legislativeEvents] = await Promise.all([
        supabase
          .from('streams')
          .select('stream_id,source_id,jurisdiction_id,module_hint,throughput_profile,safety_profile,governance_contract_id,status')
          .order('stream_id'),
        supabase
          .from('v_atlas_source_operational_readiness_v1')
          .select('*')
          .order('source_name'),
        exactCount('signal_events'),
        exactCount('signal_events', (query) => query.eq('stream_id', LEGISLATIVE_STREAM_ID)),
      ]);
      if (streamsResult.error) throw streamsResult.error;
      if (readinessResult.error) throw readinessResult.error;

      const streams = streamsResult.data ?? [];
      const sources = (readinessResult.data ?? []).map(safeSourceRow);
      res.json({
        read_model_version: FRONTEND_READ_MODEL_VERSION,
        platform: 'Atlas',
        boundary: 'Deterministic observation, normalization, relationship, convergence, and receipt engine. No legal interpretation or consequence ownership.',
        counts: {
          streams: streams.length,
          active_streams: streams.filter((row) => row.status === 'active').length,
          signal_events: totalEvents,
          legislative_version_observations: legislativeEvents,
          sources: sources.length,
        },
        source_readiness: readinessSummary(sources),
        streams,
        sources,
      });
    } catch (error) {
      apiError(res, 500, 'Atlas frontend overview failed', error instanceof Error ? error.message : String(error));
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

  router.get('/ui-api/convergence', async (req, res) => {
    try {
      const requestedRunKey = String(req.query.run_key ?? '').trim();
      if (requestedRunKey && !SHA256.test(requestedRunKey)) {
        return apiError(res, 400, 'Invalid convergence run key');
      }
      const { data, error } = await supabase.rpc('atlas_convergence_explorer_v1', {
        p_run_key: requestedRunKey || null,
        p_history_limit: 12,
      });
      if (error) throw error;
      if (!data || data.read_model_version !== CONVERGENCE_EXPLORER_READ_MODEL_VERSION) {
        throw new Error('convergence explorer returned an invalid read model');
      }
      if (requestedRunKey && !data.selected) {
        return apiError(res, 404, 'Convergence run not found');
      }
      return res.json(data);
    } catch (error) {
      return apiError(res, 500, 'Atlas convergence explorer read failed', error instanceof Error ? error.message : String(error));
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

export {
  FRONTEND_READ_MODEL_VERSION,
  CONVERGENCE_EXPLORER_READ_MODEL_VERSION,
  LEGISLATIVE_STREAM_ID,
};
