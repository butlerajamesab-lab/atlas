import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import {
  executeConvergenceRun,
  replayConvergenceRun,
  getConvergenceRunStatus,
} from '../services/convergenceRunner.js';
import { sha256, ENGINE_VERSION } from '../substrate/canonical.js';
import { ENGINE_EQUATIONS } from '../substrate/convergence.js';
import { loadWashingtonGeography } from '../substrate/geographyLoader.js';

const router = Router();

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function requireFields(body, fields) {
  const missing = fields.filter((field) => body[field] === undefined || body[field] === null || body[field] === '');
  if (missing.length) throw new Error(`missing required fields: ${missing.join(', ')}`);
}

function validateRunBody(body) {
  requireFields(body, [
    'as_of',
    'time_window_ms',
    'temporal_bucket_ms',
    'geography_registry_version',
    'analysis_level',
    'rule_manifest_hash',
    'engine_version',
    'min_signals_for_analysis',
    'z_score_threshold',
    'persist',
  ]);
  if (!Number.isFinite(body.as_of)) throw new Error('as_of must be a finite epoch-millisecond number');
  if (!Number.isFinite(body.time_window_ms) || body.time_window_ms <= 0) throw new Error('time_window_ms must be positive');
  if (!Number.isFinite(body.temporal_bucket_ms) || body.temporal_bucket_ms <= 0) throw new Error('temporal_bucket_ms must be positive');
  if (!Number.isInteger(body.min_signals_for_analysis) || body.min_signals_for_analysis < 0) {
    throw new Error('min_signals_for_analysis must be a non-negative integer');
  }
  if (!Number.isFinite(body.z_score_threshold)) throw new Error('z_score_threshold must be finite');
  if (typeof body.persist !== 'boolean') throw new Error('persist must be boolean');
  if (body.target_geographies !== undefined && body.target_geographies !== null
      && (!Array.isArray(body.target_geographies) || body.target_geographies.length === 0)) {
    throw new Error('target_geographies must be null or a non-empty array');
  }
  if (body.engine_version !== ENGINE_VERSION) {
    throw new Error(`engine_version mismatch: requested '${body.engine_version}', runtime '${ENGINE_VERSION}'`);
  }
  const expectedRuleHash = sha256(ENGINE_EQUATIONS);
  if (body.rule_manifest_hash !== expectedRuleHash) {
    throw new Error(`rule_manifest_hash mismatch: expected '${expectedRuleHash}'`);
  }
}

router.post('/run', async (req, res) => {
  try {
    validateRunBody(req.body ?? {});
    const result = await executeConvergenceRun({
      supabase: getSupabase(),
      as_of: req.body.as_of,
      time_window_ms: req.body.time_window_ms,
      temporal_bucket_ms: req.body.temporal_bucket_ms,
      geography_registry_version: req.body.geography_registry_version,
      analysis_level: req.body.analysis_level,
      min_signals_for_analysis: req.body.min_signals_for_analysis,
      z_score_threshold: req.body.z_score_threshold,
      target_geographies: req.body.target_geographies ?? null,
      persist: req.body.persist,
    });
    return res.status(result.persistence?.status === 'created' ? 201 : 200).json({
      status: 'completed',
      run_key: result.run_key,
      engine_version: result.engine_version,
      as_of: result.as_of,
      output_hash: result.output_hash,
      source_population_hash: result.source_population_hash,
      total_source_rows: result.total_source_rows,
      total_signals_raw: result.total_signals_raw,
      total_signals_deduplicated: result.total_signals_deduplicated,
      total_geographies: result.total_geographies,
      transform_error_count: result.transform_errors.length,
      receipt_count: result.receipts.length,
      persistence: result.persistence,
      receipts: result.receipts.map((receipt) => ({
        receipt_identity: receipt.receipt_identity,
        geography_id: receipt.geography_id,
        status: receipt.status,
        observed_count: receipt.observed_count,
        expected_count: receipt.expected_count,
        z_score: receipt.z_score,
        convergence_detected: receipt.convergence_detected,
        input_hash: receipt.input_hash,
        output_hash: receipt.output_hash,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const clientError = /required|must be|mismatch|target geography|registry/.test(message);
    return res.status(clientError ? 400 : 500).json({ error: message });
  }
});

router.post('/replay', async (req, res) => {
  try {
    requireFields(req.body ?? {}, ['run_key']);
    const result = await replayConvergenceRun(getSupabase(), req.body.run_key);
    return res.status(result.consistent ? 200 : 409).json(result);
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.get('/status/:run_key', async (req, res) => {
  try {
    const result = await getConvergenceRunStatus(getSupabase(), req.params.run_key);
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(message.includes('not found') ? 404 : 500).json({ error: message });
  }
});

router.get('/registry', (_req, res) => {
  try {
    const washington = loadWashingtonGeography();
    return res.json({
      engine_version: ENGINE_VERSION,
      rule_manifest_hash: sha256(ENGINE_EQUATIONS),
      registries: [{
        jurisdiction_id: 'US_WA',
        registry_hash: washington.registry_hash,
        record_count: washington.record_count,
        source_id: washington.source_id,
        source_version: washington.source_version,
        available_analysis_levels: [...new Set(washington.records.map((record) => record.level))].sort(),
      }],
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
