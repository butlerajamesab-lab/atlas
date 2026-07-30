#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import {
  EVENT_ENTITY_RESOLVER_ID,
  EVENT_ENTITY_RESOLVER_VERSION,
  EVENT_ENTITY_RULE_MANIFEST_HASH,
  drainEventEntityResolution,
  loadResolutionIndex,
  resolveEventBatch,
} from '../src/services/eventEntityResolution.js';

function argumentValue(name) {
  const direct = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return direct ? direct.slice(name.length + 1) : null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function integerArgument(name, fallback, { min, max }) {
  const raw = argumentValue(name);
  const value = raw === null ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function requiredEnvironment(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  throw new Error(`Missing required environment value: ${names.join(' or ')}`);
}

function summarize(rows) {
  const summary = {
    resolution_rows: rows.length,
    resolved: 0,
    ambiguous: 0,
    unresolved: 0,
    ignored: 0,
  };
  for (const row of rows) {
    if (Object.hasOwn(summary, row.resolution_status)) summary[row.resolution_status] += 1;
  }
  return summary;
}

const streamId = argumentValue('--stream') || null;
const batchSize = integerArgument('--batch-size', 500, { min: 1, max: 5000 });
const maxBatches = integerArgument('--max-batches', 200, { min: 1, max: 100000 });
const sampleLimit = integerArgument('--sample-limit', 20, { min: 0, max: 100 });
const afterStreamId = argumentValue('--after-stream') || (streamId ? streamId : null);
const afterOffset = argumentValue('--after-offset') || '-1';
const dryRun = hasFlag('--dry-run');

const supabaseUrl = requiredEnvironment('ATLAS_SUPABASE_URL', 'SUPABASE_URL');
const serviceRoleKey = requiredEnvironment('ATLAS_SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY');
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

try {
  if (dryRun) {
    const index = await loadResolutionIndex(supabase);
    const { data: events, error } = await supabase.rpc('fetch_atlas_signal_events_for_entity_resolution_v1', {
      p_batch_size: batchSize,
      p_stream_id: streamId,
      p_after_stream_id: afterStreamId,
      p_after_offset: afterOffset,
    });
    if (error) throw new Error(`dry-run event fetch failed: ${error.message}`);

    const rows = resolveEventBatch(events ?? [], index);
    const samples = rows.slice(0, sampleLimit).map((row) => ({
      stream_id: row.stream_id,
      event_offset: row.event_offset,
      signal_type: row.signal_type,
      rule_id: row.rule_id,
      entity_role: row.entity_role,
      source_field: row.source_field,
      source_entity_value: row.source_entity_value,
      source_identifier_type: row.source_identifier_type,
      normalized_identifier_value: row.normalized_identifier_value,
      resolution_status: row.resolution_status,
      match_method: row.match_method,
      entity_id: row.entity_id,
      candidate_entity_ids: row.candidate_entity_ids,
      resolution_hash: row.resolution_hash,
    }));

    console.log(JSON.stringify({
      ok: true,
      mode: 'dry_run',
      writes_performed: 0,
      resolver_id: EVENT_ENTITY_RESOLVER_ID,
      resolver_version: EVENT_ENTITY_RESOLVER_VERSION,
      rule_manifest_hash: EVENT_ENTITY_RULE_MANIFEST_HASH,
      entity_index_hash: index.entity_index_hash,
      entity_count: index.entity_count,
      accepted_alias_count: index.alias_count,
      source_event_count: events?.length ?? 0,
      ...summarize(rows),
      samples,
    }, null, 2));
  } else {
    const result = await drainEventEntityResolution({
      supabase,
      streamId,
      batchSize,
      maxBatches,
      afterStreamId,
      afterOffset,
    });
    console.log(JSON.stringify({ ok: true, mode: 'write', ...result }, null, 2));
  }
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    mode: dryRun ? 'dry_run' : 'write',
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
}
