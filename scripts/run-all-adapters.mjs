#!/usr/bin/env node
/**
 * Run All Atlas Adapters
 * 
 * Executes all 15 data stream adapters sequentially, collecting results.
 * Usage: node scripts/run-all-adapters.mjs [--state WA] [--dry-run]
 */
import dotenv from 'dotenv';
dotenv.config();

const STATE = process.argv.find((a, i) => process.argv[i - 1] === '--state') || 'WA';
const DRY_RUN = process.argv.includes('--dry-run');

const adapters = [
  // Existing 4
  { name: 'courtlistener', module: '../src/adapters/courtListenerAdapter.js', fn: 'runIngestCourtListener' },
  { name: 'openstates', module: '../src/adapters/openStatesAdapter.js', fn: 'ingestOpenStatesSignals' },
  { name: 'grants_gov', module: '../src/adapters/grantsGovAdapter.js', fn: 'ingestGrantsGovSignals' },
  { name: 'propublica', module: '../src/adapters/proPublicaAdapter.js', fn: 'runIngestProPublica' },
  // Backbone 5
  { name: 'census_acs', module: '../src/adapters/censusAcsAdapter.js', fn: 'ingestCensusSignals', args: { state: STATE === 'WA' ? '53' : STATE } },
  { name: 'usda_snap', module: '../src/adapters/usdaSnapAdapter.js', fn: 'ingestSnapSignals', args: { state: STATE } },
  { name: 'hud_fmr', module: '../src/adapters/hudHousingAdapter.js', fn: 'ingestHudSignals', args: { stateCode: STATE === 'WA' ? '53' : STATE } },
  { name: 'bls_employment', module: '../src/adapters/blsEmploymentAdapter.js', fn: 'ingestBlsSignals' },
  { name: 'regulations_gov', module: '../src/adapters/regulationsGovAdapter.js', fn: 'ingestRegulationsSignals' },
  // Follow the money 6
  { name: 'fec_campaign_finance', module: '../src/adapters/fecCampaignFinanceAdapter.js', fn: 'ingestFecSignals', args: { state: STATE } },
  { name: 'sec_edgar', module: '../src/adapters/secEdgarAdapter.js', fn: 'ingestSecSignals' },
  { name: 'usa_spending', module: '../src/adapters/usaSpendingAdapter.js', fn: 'ingestUsaSpendingSignals', args: { state: STATE } },
  { name: 'cfpb_complaints', module: '../src/adapters/cfpbComplaintsAdapter.js', fn: 'ingestCfpbSignals', args: { state: STATE } },
  { name: 'epa_echo', module: '../src/adapters/epaEchoAdapter.js', fn: 'ingestEpaSignals', args: { state: STATE } },
  { name: 'irs_exempt_orgs', module: '../src/adapters/irsExemptOrgAdapter.js', fn: 'ingestIrsExemptSignals', args: { state: STATE } },
  { name: 'osha_inspections', module: '../src/adapters/oshaInspectionsAdapter.js', fn: 'ingestOshaSignals', args: { state: STATE } },
  { name: 'opensecrets_lda', module: '../src/adapters/openSecretsAdapter.js', fn: 'ingestOpenSecretsSignals' },
  { name: 'fara_foreign_agents', module: '../src/adapters/faraForeignAgentsAdapter.js', fn: 'ingestFaraSignals' },
];

console.log(`\n═══════════════════════════════════════════════════`);
console.log(`  ATLAS STREAMING ENGINE — ALL ADAPTERS`);
console.log(`  State: ${STATE} | Dry Run: ${DRY_RUN}`);
console.log(`  Adapters: ${adapters.length}`);
console.log(`═══════════════════════════════════════════════════\n`);

const results = [];
let success = 0;
let failed = 0;
let skipped = 0;

for (const adapter of adapters) {
  const start = Date.now();
  try {
    if (DRY_RUN) {
      console.log(`  [DRY] ${adapter.name} — would call ${adapter.fn}()`);
      skipped++;
      results.push({ name: adapter.name, status: 'dry_run' });
      continue;
    }

    const mod = await import(adapter.module);
    const fn = mod[adapter.fn];
    if (!fn) {
      console.log(`  [SKIP] ${adapter.name} — function ${adapter.fn} not found`);
      skipped++;
      results.push({ name: adapter.name, status: 'missing_fn' });
      continue;
    }

    const result = await fn(adapter.args || {});
    const elapsed = Date.now() - start;
    const count = result?.ingested_count ?? result?.accepted ?? '?';
    console.log(`  [OK]   ${adapter.name} — ${count} signals (${elapsed}ms)`);
    success++;
    results.push({ name: adapter.name, status: 'ok', ingested: count, ms: elapsed });
  } catch (e) {
    const elapsed = Date.now() - start;
    console.log(`  [FAIL] ${adapter.name} — ${e.message?.slice(0, 80)} (${elapsed}ms)`);
    failed++;
    results.push({ name: adapter.name, status: 'error', error: e.message?.slice(0, 200), ms: elapsed });
  }
}

console.log(`\n═══════════════════════════════════════════════════`);
console.log(`  RESULTS: ${success} OK | ${failed} FAILED | ${skipped} SKIPPED`);
console.log(`═══════════════════════════════════════════════════\n`);

if (failed > 0) {
  console.log('Failed adapters:');
  results.filter(r => r.status === 'error').forEach(r => {
    console.log(`  - ${r.name}: ${r.error}`);
  });
}

process.exit(failed > 0 ? 1 : 0);
