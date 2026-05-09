import express from 'express';
import { supabase } from '../lib/supabaseClient.js';

export function patternsRouter({ apiError }) {
  const router = express.Router();

  router.get('/v1/patterns/prime', async (req, res) => {
    try {
      let query = supabase.from('prime_patterns').select('*').order('detected_at', { ascending: false }).limit(1000);
      if (req.query.module) query = query.eq('module', String(req.query.module));
      if (req.query.jurisdiction) query = query.eq('jurisdiction', String(req.query.jurisdiction));
      if (req.query.since) query = query.gte('detected_at', String(req.query.since));

      const { data, error } = await query;
      if (error) throw error;
      return res.json({ patterns: data ?? [], next_cursor: null });
    } catch (error) {
      return apiError(res, 500, error.message);
    }
  });

  return router;
}
