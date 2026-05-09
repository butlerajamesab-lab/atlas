import express from 'express';
import { customAlphabet } from 'nanoid';
import { supabase } from '../lib/supabaseClient.js';
import { assertCreateCursorRequest, validateSchema } from '../lib/validators.js';
import { requireStream, toPublicSignalEvent } from '../services/streamStore.js';

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 14);
const DEFAULT_CREATED_BY = process.env.DEFAULT_CURSOR_CREATED_BY || 'atlas-local';

export function streamsRouter({ apiError }) {
  const router = express.Router();

  router.get('/v1/streams/:stream_id/events', async (req, res) => {
    try {
      const streamId = req.params.stream_id;
      const stream = await requireStream(streamId);
      if (!stream) return apiError(res, 404, 'Stream not found');

      const limit = Math.min(Math.max(Number(req.query.limit || 1000), 1), 5000);
      let cursor = null;
      let fromOffset = req.query.from_offset !== undefined ? Number(req.query.from_offset) : null;

      if (req.query.cursor_id) {
        const { data, error } = await supabase
          .from('cursors')
          .select('*')
          .eq('cursor_id', String(req.query.cursor_id))
          .eq('stream_id', streamId)
          .maybeSingle();
        if (error) throw error;
        if (!data) return apiError(res, 404, 'Cursor not found for stream');
        cursor = data;
        if (fromOffset === null || Number.isNaN(fromOffset)) fromOffset = Number(cursor.current_offset);
      }

      let query = supabase.from('signal_events').select('*').eq('stream_id', streamId).order('offset', { ascending: true }).limit(limit);
      if (fromOffset !== null && !Number.isNaN(fromOffset)) query = query.gte('offset', fromOffset);
      if (req.query.from_timestamp) query = query.gte('timestamp', String(req.query.from_timestamp));

      const { data, error } = await query;
      if (error) throw error;

      const events = (data ?? []).map(toPublicSignalEvent);
      const nextOffset = events.length ? Number(events.at(-1).offset) + 1 : fromOffset;

      if (cursor && nextOffset !== null && !Number.isNaN(nextOffset)) {
        await supabase.from('cursors').update({ current_offset: nextOffset }).eq('cursor_id', cursor.cursor_id);
      }

      return res.json({
        stream_id: streamId,
        cursor_id: cursor?.cursor_id ?? null,
        from_offset: fromOffset,
        next_offset: nextOffset,
        events,
      });
    } catch (error) {
      return apiError(res, 500, error.message);
    }
  });

  router.post('/v1/streams/:stream_id/cursors', async (req, res) => {
    try {
      const streamId = req.params.stream_id;
      const errors = assertCreateCursorRequest(req.body);
      if (errors.length) return apiError(res, 400, 'Invalid CreateCursorRequest', errors);

      const stream = await requireStream(streamId);
      if (!stream) return apiError(res, 404, 'Stream not found');

      let currentOffset = Number.isInteger(req.body.from_offset) ? req.body.from_offset : 0;
      if (req.body.from_timestamp) {
        const { data, error } = await supabase
          .from('signal_events')
          .select('offset')
          .eq('stream_id', streamId)
          .gte('timestamp', req.body.from_timestamp)
          .order('offset', { ascending: true })
          .limit(1);
        if (error) throw error;
        if (data?.length) currentOffset = Number(data[0].offset);
      }

      const now = new Date().toISOString();
      const cursor = {
        cursor_id: `cur_${nanoid()}`,
        stream_id: streamId,
        name: req.body.name,
        current_offset: currentOffset,
        created_by: req.body.created_by ?? DEFAULT_CREATED_BY,
        created_at: now,
        updated_at: now,
      };

      const validation = validateSchema('cursor.json', cursor);
      if (!validation.ok) return apiError(res, 400, 'Cursor schema validation failed', validation.errors);

      const { data, error } = await supabase.from('cursors').upsert(cursor, { onConflict: 'stream_id,name' }).select('*').single();
      if (error) throw error;
      return res.json(data);
    } catch (error) {
      return apiError(res, 500, error.message);
    }
  });

  return router;
}
