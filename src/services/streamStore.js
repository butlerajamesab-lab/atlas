import { supabase } from '../lib/supabaseClient.js';
import { normalizeConfidence, validateSchema } from '../lib/validators.js';

export function toPublicSignalEvent(row) {
  return {
    stream_id: row.stream_id,
    offset: Number(row.offset),
    timestamp: row.timestamp,
    signal_type: row.signal_type,
    spacetime: row.spacetime,
    provenance: row.provenance,
    payload: row.payload,
  };
}

export async function requireStream(streamId) {
  const { data, error } = await supabase.from('streams').select('*').eq('stream_id', streamId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function findStream({ stream_id, source_id, jurisdiction_id, module_hint }) {
  if (stream_id) return requireStream(stream_id);
  const { data, error } = await supabase
    .from('streams')
    .select('*')
    .eq('source_id', source_id)
    .eq('jurisdiction_id', jurisdiction_id)
    .eq('module_hint', module_hint)
    .limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function nextOffsetForStream(streamId) {
  const { data, error } = await supabase
    .from('signal_events')
    .select('offset')
    .eq('stream_id', streamId)
    .order('offset', { ascending: false })
    .limit(1);
  if (error) throw error;
  if (!data?.length) return 0;
  return Number(data[0].offset) + 1;
}

export async function buildRowsForIngest(body) {
  const rows = [];
  const nextOffsets = new Map();

  for (const [index, incoming] of body.signals.entries()) {
    const stream = await findStream({
      stream_id: incoming.stream_id,
      source_id: body.source_id,
      jurisdiction_id: body.jurisdiction_id,
      module_hint: body.module_hint,
    });

    if (!stream) {
      throw Object.assign(new Error(`No registered stream found for signal index ${index}`), { status: 404 });
    }

    const timestamp = incoming.timestamp ?? new Date().toISOString();
    const incomingSpacetime = incoming.spacetime ?? {};
    const spacetime = {
      ...incomingSpacetime,
      region: incomingSpacetime.region ?? incomingSpacetime.jurisdiction ?? body.jurisdiction_id,
    };
    const provenance = {
      channel: incoming.provenance?.channel ?? 'external',
      confidence: normalizeConfidence(incoming.provenance?.confidence ?? incoming.payload?.confidence ?? 0.75),
      source_system: incoming.provenance?.source_system ?? body.source_id,
      ...incoming.provenance,
    };
    provenance.confidence = normalizeConfidence(provenance.confidence);

    let offset = incoming.offset;
    if (!Number.isInteger(offset)) {
      if (!nextOffsets.has(stream.stream_id)) {
        nextOffsets.set(stream.stream_id, await nextOffsetForStream(stream.stream_id));
      }
      offset = nextOffsets.get(stream.stream_id);
      nextOffsets.set(stream.stream_id, offset + 1);
    }

    const normalized = {
      stream_id: stream.stream_id,
      offset,
      timestamp,
      signal_type: incoming.signal_type ?? `${body.source_id}.signal`,
      spacetime,
      provenance,
      payload: {
        ...(incoming.payload ?? {}),
        provenance_tracking: {
          source_id: body.source_id,
          jurisdiction_id: body.jurisdiction_id,
          module_hint: body.module_hint,
          ingested_via: 'atlas-streaming-engine',
          received_at: new Date().toISOString(),
        },
      },
    };

    const validation = validateSchema('signal_event.json', normalized);
    if (!validation.ok) {
      throw Object.assign(new Error(`Signal index ${index} failed schema validation`), { status: 400, details: validation.errors });
    }

    rows.push({
      ...normalized,
      source_id: body.source_id,
      jurisdiction_id: body.jurisdiction_id,
      module_hint: body.module_hint,
    });
  }

  return rows;
}
