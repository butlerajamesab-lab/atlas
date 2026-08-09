import express from 'express';
import { supabase } from '../lib/supabaseClient.js';
import { recordActionReceipt } from '../services/actionReceiptService.js';
import {
  ADAPTER_REGISTRY,
  ADAPTER_STREAM_IDS,
  getSchedulerStatus,
  triggerAdapterNow,
  triggerLiveDataSignalBridgeNow,
} from '../services/scheduler.js';
import { reconcileIngestJobSourceHealth } from '../services/sourceHealthReceiptService.js';

const STREAM_STATUSES = new Set(['active', 'degraded', 'quarantined', 'paused']);
const THROUGHPUT_PROFILES = new Set(['low', 'medium', 'high', 'ultra']);
const SAFETY_PROFILES = new Set(['default', 'restricted', 'critical']);
const SAFE_ID = /^[a-z0-9][a-z0-9_-]{1,99}$/;

function requiredText(value, field, pattern = null) {
  const text = String(value ?? '').trim();
  if (!text) throw Object.assign(new Error(`${field}_required`), { status: 400 });
  if (pattern && !pattern.test(text)) throw Object.assign(new Error(`${field}_invalid`), { status: 400 });
  return text;
}

async function substrateDetail() {
  const [summaryResult, streamResult, typeResult, patternResult, jobResult, receiptResult] = await Promise.all([
    supabase.from('v_atlas_signal_substrate_summary_v1').select('*').single(),
    supabase.from('v_atlas_stream_runtime_summary_v1').select('*').order('stream_id'),
    supabase.from('v_atlas_signal_type_summary_v1').select('*').order('event_count', { ascending: false }).limit(250),
    supabase
      .from('prime_patterns')
      .select('pattern_id,pattern_type,module,jurisdiction,stream_id,job_id,confidence,severity,detected_at,summary,created_at')
      .order('detected_at', { ascending: false })
      .limit(100),
    supabase
      .from('investigative_jobs')
      .select('job_id,job_type,stream_id,status,function_id,created_at,completed_at,error,result')
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('atlas_action_receipt')
      .select('action_receipt_hash,action_type,initiator,target_id,requested_at,completed_at,outcome_status,before_event_count,after_event_count,event_delta,result_json,engine_version')
      .order('completed_at', { ascending: false })
      .limit(100),
  ]);
  for (const result of [summaryResult, streamResult, typeResult, patternResult, jobResult, receiptResult]) {
    if (result.error) throw result.error;
  }
  return {
    summary: summaryResult.data,
    streams: streamResult.data ?? [],
    signal_types: typeResult.data ?? [],
    prime_patterns: patternResult.data ?? [],
    investigative_jobs: jobResult.data ?? [],
    action_receipts: receiptResult.data ?? [],
    observed_at: new Date().toISOString(),
  };
}

export function atlasOperatorRouter({ apiError }) {
  const router = express.Router();

  router.get('/operator-api/status', async (_req, res) => {
    try {
      const { data, error } = await supabase
        .from('atlas_action_receipt')
        .select('action_receipt_hash,action_type,initiator,target_id,completed_at,outcome_status,event_delta,result_json')
        .order('completed_at', { ascending: false })
        .limit(25);
      if (error) throw error;
      return res.json({
        authenticated: true,
        scheduler: getSchedulerStatus(),
        recent_receipts: data ?? [],
        observed_at: new Date().toISOString(),
      });
    } catch (error) {
      return apiError(res, 500, 'Atlas operator status failed', error instanceof Error ? error.message : String(error));
    }
  });

  router.get('/operator-api/substrate', async (_req, res) => {
    try {
      return res.json(await substrateDetail());
    } catch (error) {
      return apiError(res, 500, 'Atlas operator substrate read failed', error instanceof Error ? error.message : String(error));
    }
  });

  router.post('/operator-api/streams/:adapterName/run', async (req, res) => {
    try {
      const adapterName = requiredText(req.params.adapterName, 'adapter_name', SAFE_ID);
      const result = await triggerAdapterNow(adapterName, { initiator: 'operator' });
      return res.status(result.status === 'error' ? 502 : 202).json(result);
    } catch (error) {
      return apiError(res, error.status || 400, 'Atlas adapter run failed', error instanceof Error ? error.message : String(error));
    }
  });

  router.post('/operator-api/live-data-signals/run', async (_req, res) => {
    const requestedAt = new Date().toISOString();
    try {
      const result = await triggerLiveDataSignalBridgeNow();
      const completedAt = new Date().toISOString();
      const outcomeStatus = result?.status === 'error' ? 'failed' : result?.status === 'already_running' ? 'skipped' : 'completed';
      const receipt = await recordActionReceipt({
        actionType: 'live_data_signal_bridge_run',
        initiator: 'operator',
        targetId: 'atlas.live_data_signal_exact@1.0.0',
        requestedAt,
        completedAt,
        outcomeStatus,
        request: {},
        result,
      });
      return res.status(outcomeStatus === 'failed' ? 502 : 202).json({ ...result, action_receipt_hash: receipt.action_receipt_hash });
    } catch (error) {
      return apiError(res, 500, 'Atlas live-data signal run failed', error instanceof Error ? error.message : String(error));
    }
  });

  router.post('/operator-api/source-health/reconcile', async (req, res) => {
    const requestedAt = new Date().toISOString();
    try {
      const requestedLimit = Number.parseInt(String(req.body?.limit ?? '1000'), 10);
      const limit = Number.isSafeInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 10000) : 1000;
      const result = await reconcileIngestJobSourceHealth({ limit });
      const summary = {
        jobs_seen: result.jobs_seen,
        receipts_processed: result.receipts_processed,
        persisted_count: result.persisted_count,
        idempotent_count: result.idempotent_count,
      };
      const completedAt = new Date().toISOString();
      const receipt = await recordActionReceipt({
        actionType: 'source_health_reconcile',
        initiator: 'operator',
        targetId: 'canonical_ingest_jobs',
        requestedAt,
        completedAt,
        outcomeStatus: 'completed',
        request: { limit },
        result: summary,
      });
      return res.status(202).json({ ...summary, action_receipt_hash: receipt.action_receipt_hash });
    } catch (error) {
      return apiError(res, error.status || 500, 'Atlas source-health reconciliation failed', error instanceof Error ? error.message : String(error));
    }
  });

  router.post('/operator-api/streams', async (req, res) => {
    const requestedAt = new Date().toISOString();
    try {
      const adapterName = requiredText(req.body?.adapter_name, 'adapter_name', SAFE_ID);
      const adapter = ADAPTER_REGISTRY.find((candidate) => candidate.name === adapterName);
      if (!adapter) return apiError(res, 400, 'Stream adapter is not compiled into this Atlas runtime');
      const canonicalStreamId = ADAPTER_STREAM_IDS[adapterName];
      const streamId = requiredText(req.body?.stream_id ?? canonicalStreamId, 'stream_id', SAFE_ID);
      if (streamId !== canonicalStreamId) return apiError(res, 400, `Compiled adapter ${adapterName} is bound to ${canonicalStreamId}`);

      const throughputProfile = requiredText(req.body?.throughput_profile, 'throughput_profile');
      const safetyProfile = requiredText(req.body?.safety_profile, 'safety_profile');
      if (!THROUGHPUT_PROFILES.has(throughputProfile)) return apiError(res, 400, 'throughput_profile_invalid');
      if (!SAFETY_PROFILES.has(safetyProfile)) return apiError(res, 400, 'safety_profile_invalid');

      const row = {
        stream_id: streamId,
        source_id: requiredText(req.body?.source_id, 'source_id', SAFE_ID),
        jurisdiction_id: requiredText(req.body?.jurisdiction_id, 'jurisdiction_id'),
        module_hint: requiredText(req.body?.module_hint, 'module_hint', SAFE_ID),
        throughput_profile: throughputProfile,
        safety_profile: safetyProfile,
        governance_contract_id: requiredText(req.body?.governance_contract_id, 'governance_contract_id'),
        status: 'active',
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await supabase.from('streams').upsert(row, { onConflict: 'stream_id' }).select('*').single();
      if (error) throw error;
      const completedAt = new Date().toISOString();
      const receipt = await recordActionReceipt({
        actionType: 'stream_register',
        initiator: 'operator',
        targetId: streamId,
        requestedAt,
        completedAt,
        outcomeStatus: 'completed',
        request: { adapter_name: adapterName, ...row },
        result: { stream_id: data.stream_id, status: data.status },
      });
      return res.status(201).json({ stream: data, action_receipt_hash: receipt.action_receipt_hash });
    } catch (error) {
      return apiError(res, error.status || 500, 'Atlas stream registration failed', error instanceof Error ? error.message : String(error));
    }
  });

  router.patch('/operator-api/streams/:streamId/status', async (req, res) => {
    const requestedAt = new Date().toISOString();
    try {
      const streamId = requiredText(req.params.streamId, 'stream_id', SAFE_ID);
      const status = requiredText(req.body?.status, 'status');
      if (!STREAM_STATUSES.has(status)) return apiError(res, 400, 'stream_status_invalid');
      const { data: before, error: beforeError } = await supabase.from('streams').select('stream_id,status').eq('stream_id', streamId).maybeSingle();
      if (beforeError) throw beforeError;
      if (!before) return apiError(res, 404, 'Stream not found');
      const { data, error } = await supabase.from('streams').update({ status, updated_at: new Date().toISOString() }).eq('stream_id', streamId).select('*').single();
      if (error) throw error;
      const completedAt = new Date().toISOString();
      const receipt = await recordActionReceipt({
        actionType: 'stream_status_change',
        initiator: 'operator',
        targetId: streamId,
        requestedAt,
        completedAt,
        outcomeStatus: 'completed',
        request: { previous_status: before.status, requested_status: status },
        result: { stream_id: streamId, status: data.status },
      });
      return res.json({ stream: data, action_receipt_hash: receipt.action_receipt_hash });
    } catch (error) {
      return apiError(res, error.status || 500, 'Atlas stream status update failed', error instanceof Error ? error.message : String(error));
    }
  });

  return router;
}
