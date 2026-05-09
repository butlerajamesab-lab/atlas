import express from 'express';
import { customAlphabet } from 'nanoid';
import { supabase } from '../lib/supabaseClient.js';
import { assertInvestigationTrigger } from '../lib/validators.js';
import { evaluateStreamHealth, luminariStreamHealthManifest } from '../services/streamHealthInvestigation.js';
import { triggerBridgeForPattern } from '../services/bridgeHook.js';
import { requireStream, toPublicSignalEvent } from '../services/streamStore.js';

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 14);

export function investigationsRouter({ apiError }) {
  const router = express.Router();

  router.post('/internal/investigations/run', async (req, res) => {
    const createdAt = new Date().toISOString();
    let job = null;

    try {
      const errors = assertInvestigationTrigger(req.body);
      if (errors.length) return apiError(res, 400, 'Invalid InvestigationTrigger', errors);

      const trigger = req.body.trigger;
      const stream = await requireStream(trigger.stream_id);
      if (!stream) return apiError(res, 404, 'Stream not found');

      job = {
        job_id: `job_${nanoid()}`,
        job_type: 'stream_health',
        stream_id: trigger.stream_id,
        cursor_id: trigger.cursor_id ?? null,
        status: 'pending',
        params: { trigger, manifest: luminariStreamHealthManifest },
        function_id: luminariStreamHealthManifest.function_id,
        created_at: createdAt,
        completed_at: null,
      };

      const { data: insertedJob, error: insertError } = await supabase.from('investigative_jobs').insert(job).select('*').single();
      if (insertError) throw insertError;
      job = insertedJob;

      await supabase.from('investigative_jobs').update({ status: 'running' }).eq('job_id', job.job_id);

      const { data: eventRows, error: eventError } = await supabase
        .from('signal_events')
        .select('*')
        .eq('stream_id', trigger.stream_id)
        .gte('offset', trigger.from_offset)
        .lte('offset', trigger.to_offset)
        .order('offset', { ascending: true });
      if (eventError) throw eventError;

      const events = (eventRows ?? []).map(toPublicSignalEvent);
      const { alert, patterns } = evaluateStreamHealth({
        stream,
        events,
        fromOffset: trigger.from_offset,
        toOffset: trigger.to_offset,
      });

      const patternsWithJob = patterns.map((pattern) => ({ ...pattern, job_id: job.job_id }));
      const bridgeResults = [];
      if (patternsWithJob.length) {
        const { error: patternError } = await supabase.from('prime_patterns').insert(patternsWithJob);
        if (patternError) throw patternError;

        for (const pattern of patternsWithJob) {
          bridgeResults.push(await triggerBridgeForPattern(pattern, job.job_id, trigger.stream_id));
        }
      }

      const completedAt = new Date().toISOString();
      const result = { alert, emitted_patterns: patternsWithJob.length, bridge_results: bridgeResults };
      const { data: completedJob, error: updateError } = await supabase
        .from('investigative_jobs')
        .update({ status: 'completed', completed_at: completedAt, result })
        .eq('job_id', job.job_id)
        .select('*')
        .single();
      if (updateError) throw updateError;

      return res.status(202).json(completedJob);
    } catch (error) {
      if (job?.job_id) {
        await supabase
          .from('investigative_jobs')
          .update({ status: 'failed', completed_at: new Date().toISOString(), error: error.message })
          .eq('job_id', job.job_id);
      }
      return apiError(res, error.status || 500, error.message, error.details);
    }
  });

  return router;
}
