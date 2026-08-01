/**
 * ATLAS CONVERGENCE ENDPOINT v2.1.0
 *
 * Controlled endpoint for governed convergence runs.
 * Requires explicit parameters — no defaults from wall-clock.
 * Protected by ATLAS_CONTROL_TOKEN (same as scheduler).
 *
 * POST /v1/convergence/run
 *   Requires: as_of, time_window_ms, temporal_bucket_ms,
 *             geography_registry_version, rule_manifest_hash, engine_version
 *   Optional: target_geographies, min_signals_for_analysis, z_score_threshold, persist
 *
 * POST /v1/convergence/replay
 *   Requires: run_key
 *
 * GET /v1/convergence/status/:run_key
 *   Returns the persisted run manifest and receipts.
 */

import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import {
  executeConvergenceRun,
  replayConvergenceRun,
} from '../services/convergenceRunner.js';
import { sha256, ENGINE_VERSION } from '../substrate/canonical.js';
import { ENGINE_EQUATIONS } from '../substrate/convergence.js';
import { loadWashingtonGeography } from '../substrate/geographyLoader.js';

const router = Router();

/**
 * Auth middleware: requires ATLAS_CONTROL_TOKEN.
 */
function requireControlToken(req, res, next) {
  const token = process.env.ATLAS_CONTROL_TOKEN;
  if (!token) return res.status(503).json({ error: 'ATLAS_CONTROL_TOKEN not configured' });
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${token}`) {
    return res.status(401).json({ error: 'unauthorized — requires ATLAS_CONTROL_TOKEN' });
  }
  next();
}

/**
 * Get a Supabase client with service_role key.
 */
function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  return createClient(url, key);
}

/**
 * POST /v1/convergence/run
 *
 * Execute a governed convergence run with explicit parameters.
 */
router.post('/run', requireControlToken, async (req, res) => {
  try {
    const {
      as_of,
      time_window_ms,
      temporal_bucket_ms,
      geography_registry_version,
      rule_manifest_hash,
      engine_version,
      target_geographies,
      min_signals_for_analysis,
      z_score_threshold,
      persist,
    } = req.body;

    // Validate all required explicit parameters
    if (!as_of) return res.status(400).json({ error: 'as_of is required (epoch ms)' });
    if (!time_window_ms) return res.status(400).json({ error: 'time_window_ms is required' });
    if (!temporal_bucket_ms) return res.status(400).json({ error: 'temporal_bucket_ms is required' });
    if (!geography_registry_version) return res.status(400).json({ error: 'geography_registry_version is required' });
    if (!rule_manifest_hash) return res.status(400).json({ error: 'rule_manifest_hash is required' });
    if (!engine_version) return res.status(400).json({ error: 'engine_version is required' });

    // Verify engine version matches
    if (engine_version !== ENGINE_VERSION) {
      return res.status(400).json({
        error: `engine_version mismatch: requested '${engine_version}' but this Atlas runs '${ENGINE_VERSION}'`,
      });
    }

    // Verify rule manifest hash matches
    const expectedRuleHash = sha256(ENGINE_EQUATIONS);
    if (rule_manifest_hash !== expectedRuleHash) {
      return res.status(400).json({
        error: `rule_manifest_hash mismatch: requested '${rule_manifest_hash}' but current ENGINE_EQUATIONS hash is '${expectedRuleHash}'`,
      });
    }

    const supabase = getSupabase();

    const result = await executeConvergenceRun({
      supabase,
      as_of,
      time_window_ms,
      temporal_bucket_ms,
      geography_registry_version,
      min_signals_for_analysis: min_signals_for_analysis ?? 1,
      z_score_threshold: z_score_threshold ?? 2.0,
      target_geographies: target_geographies || null,
      persist: persist !== false,
    });

    // Return the run receipt (not the full payload — that's persisted)
    res.json({
      status: 'completed',
      run_key: result.run_key,
      engine_version: result.engine_version,
      as_of: result.as_of,
      output_hash: result.output_hash,
      total_signals_raw: result.total_signals_raw,
      total_signals_deduplicated: result.total_signals_deduplicated,
      total_geographies: result.total_geographies,
      transform_errors: result.transform_errors,
      receipt_count: result.receipts.length,
      persistence: result.persistence,
      receipts: result.receipts.map(r => ({
        geography_id: r.geography_id,
        status: r.status,
        observed_count: r.observed_count,
        expected_count: r.expected_count,
        z_score: r.z_score,
        convergence_detected: r.convergence_detected,
        input_hash: r.input_hash,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: process.env.NODE_ENV === 'development' ? err.stack : undefined });
  }
});

/**
 * POST /v1/convergence/replay
 *
 * Replay a persisted run from its snapshots and verify determinism.
 */
router.post('/replay', requireControlToken, async (req, res) => {
  try {
    const { run_key } = req.body;
    if (!run_key) return res.status(400).json({ error: 'run_key is required' });

    const supabase = getSupabase();
    const result = await replayConvergenceRun(supabase, run_key);

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /v1/convergence/status/:run_key
 *
 * Get the status of a persisted run.
 */
router.get('/status/:run_key', requireControlToken, async (req, res) => {
  try {
    const supabase = getSupabase();
    const { run_key } = req.params;

    const { data: manifest, error: manifestErr } = await supabase
      .from('convergence_run_manifest')
      .select('*')
      .eq('run_key', run_key)
      .single();

    if (manifestErr || !manifest) {
      return res.status(404).json({ error: `Run ${run_key} not found` });
    }

    const { data: receipts } = await supabase
      .from('convergence_receipt')
      .select('geography_id, status, observed_count, expected_count, z_score, convergence_detected, input_hash')
      .eq('run_key', run_key);

    res.json({
      manifest,
      receipts: receipts || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /v1/convergence/registry
 *
 * Get the current geography registry metadata (not the full data).
 */
router.get('/registry', requireControlToken, async (req, res) => {
  try {
    const wa = loadWashingtonGeography();
    res.json({
      jurisdictions: [{
        jurisdiction_id: 'us_wa',
        name: 'Washington State',
        registry_hash: wa.registry_hash,
        runtime_version: wa.runtime.version,
        record_count: wa.record_count,
        source_id: wa.source_id,
        source_version: wa.source_version,
      }],
      engine_version: ENGINE_VERSION,
      rule_manifest_hash: sha256(ENGINE_EQUATIONS),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
