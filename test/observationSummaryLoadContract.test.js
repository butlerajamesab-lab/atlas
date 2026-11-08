import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// scheduler.js builds its Supabase client at import time; give it
// inert values so the pure delay helper can be imported directly.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const { adapterInitialDelayMs } = await import('../src/services/scheduler.js');

const schedulerSource = readFileSync(new URL('../src/services/scheduler.js', import.meta.url), 'utf8');
const schemaSource = readFileSync(new URL('../src/schema/20261108_observation_summary_materialization.sql', import.meta.url), 'utf8');

test('adapter first runs keep the tier bases and spread within each tier', () => {
  assert.equal(adapterInitialDelayMs('high', 0), 30_000);
  assert.equal(adapterInitialDelayMs('medium', 0), 120_000);
  assert.equal(adapterInitialDelayMs('low', 0), 300_000);
  assert.equal(adapterInitialDelayMs('high', 5), 130_000);
  assert.equal(adapterInitialDelayMs('medium', 6), 240_000);
  assert.equal(adapterInitialDelayMs('low', 9), 480_000);
  // No two adapters in a tier share a first-run second.
  for (const priority of ['high', 'medium', 'low']) {
    const delays = new Set(Array.from({ length: 10 }, (_, i) => adapterInitialDelayMs(priority, i)));
    assert.equal(delays.size, 10);
  }
  // Unknown priorities fall back to the low base and still spread.
  assert.equal(adapterInitialDelayMs('whenever', 2), 340_000);
});

test('scheduler wires the observation summary refresh ahead of the projection', () => {
  assert.match(schedulerSource, /supabase\.rpc\('refresh_atlas_observation_type_summary_v1'\)/);
  assert.match(schedulerSource, /observationSummaryInitialDelayMs = 45_000/);
  assert.match(schedulerSource, /observationSummaryIntervalMs = 15 \* 60 \* 1000/);
  assert.match(schedulerSource, /streamProjectionInitialDelayMs = 75_000/);
});

test('domain 3 first replay no longer lands inside the boot bursts', () => {
  assert.match(schedulerSource, /domain3InitialDelayMs = 12 \* 60 \* 1000/);
});

test('materialization schema: table, refresh function, view repointed with identical columns', () => {
  assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS public\.atlas_observation_type_summary_mat/);
  assert.match(schemaSource, /CREATE OR REPLACE FUNCTION public\.refresh_atlas_observation_type_summary_v1\(\)/);
  assert.match(schemaSource, /FROM public\.signal_events[\s\S]*GROUP BY stream_id, signal_type, module_hint, jurisdiction_id/);
  assert.match(schemaSource, /CREATE OR REPLACE VIEW public\.v_atlas_observation_type_summary_v1 AS[\s\S]*FROM public\.atlas_observation_type_summary_mat/);
});
