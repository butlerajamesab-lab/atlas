// National backfill for the CMS nursing-home streams
// (Alexander's direction 2026-11-08: "we want the whole country").
//
// The WA family (cms_nh_* under us_state_WA) landed first. This
// script legs every other state into the national family
// (cms_nh_*_national under cms_nh / us_federal) through the SAME
// governed ingest door the adapter uses — same resolver, same
// dedupe, same receipts; a backfilled record is indistinguishable
// from a scheduled one. Washington is never in the leg list: it
// already lives in the WA family, and the whole country is the
// union of the two families with zero double-count.
//
// Execution: one-off Render jobs in the Atlas service's own
// environment (ATLAS_INGEST_TOKEN lives there; the CMS API itself
// needs no key). Inside a job there is no local server, so posts
// go to the service's public URL (ATLAS_PUBLIC_URL, defaulting to
// the Atlas custom domain), token-gated as usual. The script is
// inert in the deployed service: nothing imports it; only an
// explicit job runs it.
//
// Resumability: the leg unit is the state. Dedupe absorbs any
// overlap, so a failed or interrupted state restarts safely by
// simply naming it again. A state whose draw throws is logged and
// SKIPPED — the run continues with the next state and reports the
// failures in its summary; re-leg the failed states to close them
// out. Per-state receipts print as each state completes, and a
// JSON summary prints at the end (states_completed,
// states_failed, exhausted: true when the named list ran out).
//
// Usage:
//   node scripts/backfillCmsNational.mjs --state OR
//   node scripts/backfillCmsNational.mjs --states CA,TX,FL
//   node scripts/backfillCmsNational.mjs --from-state NY
//        (canonical order from NY to the end of the list)
//   node scripts/backfillCmsNational.mjs
//        (the full canonical list — every state + DC + territories
//        except WA; a long run, leg it instead)

import { pathToFileURL } from 'node:url';

import { ingestCmsStateSignals } from '../src/adapters/cmsNursingHomeAdapter.js';

// Canonical leg order: states roughly west-to-east after the WA
// anchor, then DC and the territories. WA is absent by design.
export const CMS_BACKFILL_STATES = Object.freeze([
  'OR', 'CA', 'NV', 'ID', 'MT', 'WY', 'UT', 'AZ', 'CO', 'NM', 'AK', 'HI',
  'ND', 'SD', 'NE', 'KS', 'OK', 'TX', 'MN', 'IA', 'MO', 'AR',
  'LA', 'WI', 'IL', 'MS', 'MI', 'IN', 'KY', 'TN', 'AL', 'OH',
  'GA', 'FL', 'SC', 'NC', 'VA', 'WV', 'PA', 'NY', 'VT', 'ME',
  'NH', 'MA', 'RI', 'CT', 'NJ', 'DE', 'MD', 'DC',
  'AS', 'GU', 'MP', 'PR', 'VI',
]);

export function parseBackfillArgs(argv) {
  const args = { states: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--state' && value) { args.states = [value.toUpperCase()]; i += 1; }
    else if (flag === '--states' && value) { args.states = value.split(',').map((v) => v.trim().toUpperCase()).filter(Boolean); i += 1; }
    else if (flag === '--from-state' && value) {
      const start = CMS_BACKFILL_STATES.indexOf(value.toUpperCase());
      if (start === -1) throw new Error(`backfill_cms_unknown_state: ${value} is not in the canonical leg list`);
      args.states = CMS_BACKFILL_STATES.slice(start);
      i += 1;
    } else if (flag.startsWith('--')) {
      throw new Error(`backfill_cms_unknown_flag: ${flag}`);
    }
  }
  if (!args.states) args.states = [...CMS_BACKFILL_STATES];
  for (const state of args.states) {
    if (state === 'WA') throw new Error('backfill_cms_wa_excluded: WA lives in the us_state_WA family and is never legged into the national streams');
    if (!CMS_BACKFILL_STATES.includes(state)) throw new Error(`backfill_cms_unknown_state: ${state} is not in the canonical leg list`);
  }
  return args;
}

function summarize(results) {
  const totals = { ingested_count: 0, replayed_count: 0, records_failed: 0 };
  for (const key of ['providers', 'health_deficiencies', 'fire_safety', 'penalties']) {
    const r = results?.[key] ?? {};
    totals.ingested_count += r.ingested_count ?? 0;
    totals.replayed_count += r.replayed_count ?? 0;
    totals.records_failed += r.records_failed ?? 0;
  }
  return totals;
}

export async function runBackfill({ states, apiBaseUrl, ingestState = ingestCmsStateSignals, log = console.log }) {
  const completed = [];
  const failed = [];
  for (const state of states) {
    try {
      const results = await ingestState(state, { apiBaseUrl });
      const totals = summarize(results);
      completed.push({ state, ...totals });
      log(`[cms-backfill] ${state} done: ${JSON.stringify(totals)}`);
    } catch (error) {
      failed.push({ state, error: String(error?.message ?? error).slice(0, 300) });
      log(`[cms-backfill] ${state} FAILED: ${String(error?.message ?? error).slice(0, 300)} — continuing`);
    }
  }
  return {
    ok: failed.length === 0,
    source: 'cms_nh',
    family: 'national',
    states_completed: completed,
    states_failed: failed,
    exhausted: true,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseBackfillArgs(process.argv.slice(2));
  const apiBaseUrl = process.env.ATLAS_PUBLIC_URL || 'https://atlas.columbiacitycustomllc.com';
  console.log(`[cms-backfill] legging ${args.states.length} states: ${args.states.join(' ')}`);
  const summary = await runBackfill({ states: args.states, apiBaseUrl });
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exitCode = 1;
}
