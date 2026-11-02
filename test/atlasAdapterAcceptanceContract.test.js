import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { assertCompleteAdapterReceipt, evaluateAdapterCliReceipt, formatAdapterRunFailure } from '../src/services/adapterReceiptAcceptance.js';
import { toIsoTimestamp } from '../src/adapters/ingestClient.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const scheduler = read('../src/services/scheduler.js');
const runner = read('../scripts/run-all-adapters.mjs');
const hud = read('../src/adapters/hudHousingAdapter.js');

test('completed, replay-only, and explicitly empty source receipts are eligible', () => {
  for (const receipt of [
    { accepted: true, status: 'completed', ingested_count: 5, records_failed: 0, partial_completion: false },
    { accepted: true, status: 'completed', ingested_count: 0, replayed_count: 5, records_failed: 0 },
    { accepted: true, status: 'source_empty', ingested_count: 0 },
  ]) assert.equal(assertCompleteAdapterReceipt(receipt), receipt);
});

test('partial, failed, missing and invalid receipts cannot report success', () => {
  for (const receipt of [
    null, undefined, {}, { accepted: false, status: 'completed' },
    { accepted: true, status: 'failed' },
    { accepted: true, status: 'error' },
    { accepted: true, status: 'partial' },
    { accepted: true, status: 'completed', partial_completion: true },
    { accepted: true, status: 'completed', records_failed: 1 },
    { accepted: true, status: 'completed', records_failed: 'unknown' },
  ]) assert.throws(() => assertCompleteAdapterReceipt(receipt), /atlas_adapter_(missing|incomplete|invalid)_receipt/);
});

test('scheduler and runner both enforce transport acceptance', () => {
  assert.match(scheduler, /assertCompleteAdapterReceipt\(adapterResult\)/);
  assert.match(runner, /assertCompleteAdapterReceipt\(result\)/);
  assert.match(runner, /failed > 0 \|\| \(skipped > 0 && !DRY_RUN\)/);
});

test('manual runner names match every scheduled adapter name', () => {
  const start = scheduler.indexOf('const ADAPTER_REGISTRY = [');
  const end = scheduler.indexOf('const ADAPTER_STREAM_IDS', start);
  assert.ok(start >= 0 && end > start);
  const scheduledNames = [...scheduler.slice(start, end).matchAll(/name:\s*'([^']+)'/g)].map(m => m[1]).sort();
  const manualNames = [...runner.slice(runner.indexOf('const adapters = ['), runner.indexOf('];')).matchAll(/name:\s*'([^']+)'/g)].map(m => m[1]).sort();
  assert.deepEqual(manualNames, scheduledNames);
});

test('HUD missing credentials and malformed source responses fail closed', () => {
  assert.match(hud, /throw new Error\('hud_credentials_missing:/);
  assert.match(hud, /throw new Error\('hud_unexpected_response_shape:/);
  assert.doesNotMatch(hud, /Skipping fetch/);
});

test('source event time must come from the provider, never current ingest time', () => {
  assert.equal(toIsoTimestamp('2026-10-31'), '2026-10-31T00:00:00.000Z');
  assert.throws(() => toIsoTimestamp(), /atlas_source_timestamp_missing/);
  assert.throws(() => toIsoTimestamp(null, ''), /atlas_source_timestamp_missing/);
  assert.throws(() => toIsoTimestamp('not-a-timestamp'), /atlas_source_timestamp_invalid/);
  assert.doesNotMatch(read('../src/services/streamStore.js'), /incoming\.timestamp \?\? new Date\(\)/);
  assert.match(read('../src/services/streamStore.js'), /atlas_source_timestamp_missing_or_invalid/);
});

test('provider unavailability cannot be reported as an empty successful source response', () => {
  const regulations = read('../src/adapters/regulationsGovAdapter.js');
  const fara = read('../src/adapters/faraForeignAgentsAdapter.js');
  const senate = read('../src/adapters/openSecretsAdapter.js');
  const sec = read('../src/adapters/secEdgarAdapter.js');
  assert.match(regulations, /throw new Error\('regulations_gov_credentials_missing:/);
  assert.match(fara, /throw new Error\(`fara_source_request_failed/);
  assert.match(senate, /throw new Error\(`senate_lda_request_failed/);
  assert.match(sec, /throw new Error\(`sec_edgar_rss_fallback_failed/);
});

import { normalizeProPublicaFiling, prepareProPublicaSignals, ingestProPublicaSignals } from '../src/adapters/proPublicaAdapter.js';

test('ProPublica source-dated filings use official tax_prd and stable EIN-period identity', () => {
  const filing = { ein: 123456789, tax_prd: 202412, updated: '2025-03-11T08:20:00Z', totrevenue: 200, totassetsend: 700 };
  const result = normalizeProPublicaFiling(filing, { organization: { ein: 123456789, name: 'Example' } });
  assert.equal(result.timestamp, '2025-03-11T08:20:00.000Z');
  assert.equal(result.payload.tax_period, 202412);
  assert.equal(result.payload.external_id, '123456789:202412');
  assert.equal(result.payload.total_revenue, 200);
  assert.throws(() => normalizeProPublicaFiling({ ein: 123456789, tax_prd: 202412 }), /atlas_source_timestamp_missing/);
  assert.throws(() => normalizeProPublicaFiling({ updated: '2025-03-11' }), /propublica_filing_identity_missing/);
});

test('ProPublica undated organization search hits are held rather than timestamped', async () => {
  const organizations = [{ ein: 123456789, name: 'Example', subseccd: 3 }];
  const filings = [{ organization: organizations[0], filings_with_data: [{ ein: 123456789, tax_prd: 202412, updated: '2025-03-11T08:20:00Z' }] }];
  const prepared = prepareProPublicaSignals({ organizations, filings });
  assert.equal(prepared.signals.length, 1);
  assert.equal(prepared.held.length, 1);
  assert.match(prepared.held[0].source_record_json_sha256, /^[0-9a-f]{64}$/);
  assert.equal(prepared.held[0].reason, 'atlas_source_timestamp_missing');
  let posted = 0;
  const result = await ingestProPublicaSignals({
    organizations, filings,
    postSignals: async ({signals}) => {
      posted++;
      assert.equal(signals.length, 1);
      return { accepted: true, status: 'completed', ingested_count: 1, records_failed: 0 };
    },
  });
  assert.equal(posted, 0, 'mixed source batch must not produce partial candidate inputs');
  assert.equal(result.status, 'held_source_metadata');
  assert.equal(result.ingested_count, 0);
  assert.equal(result.source_hold.held_count, 1);
  assert.throws(() => assertCompleteAdapterReceipt(result), /atlas_adapter_missing_receipt/);
});

test('undated-only ProPublica batches never issue an ingest write', async () => {
  let posted = 0;
  const result = await ingestProPublicaSignals({
    organizations: [{ ein: 123456789, name: 'Example' }],
    postSignals: async () => { posted++; throw Error('unreachable'); },
  });
  assert.equal(posted, 0);
  assert.equal(result.status, 'held_source_metadata');
  assert.equal(result.accepted, false);
  assert.throws(() => assertCompleteAdapterReceipt(result), /atlas_adapter_missing_receipt/);
});

import { searchNonprofits, fetchOrgDetail } from '../src/adapters/proPublicaAdapter.js';

test('ProPublica search and detail reject unexpected API payloads without inventing an empty response', async () => {
  await assert.rejects(searchNonprofits('WA', 0, '', async () => ({ data: {} })), /propublica_search_unexpected_shape/);
  await assert.rejects(fetchOrgDetail('123456789', async () => ({ data: {} })), /propublica_detail_unexpected_shape/);
  const page = await searchNonprofits('WA', 0, '', async () => ({
    data: { organizations: [{ein:123456789}], num_pages:3 },
  }));
  assert.equal(page.num_pages, 3);
  assert.equal(page.organizations.length, 1);
});

test('source holds and incomplete source windows fail closed even when transport says completed', () => {
  assert.throws(() => assertCompleteAdapterReceipt({
    accepted: true, status: 'completed', source_hold_count: 2,
  }), /source_hold_count=2/);
  assert.throws(() => assertCompleteAdapterReceipt({
    accepted: true, status: 'completed', source_window_incomplete: true,
  }), /source_window_incomplete=true/);
  assert.throws(() => assertCompleteAdapterReceipt({
    accepted: true, status: 'completed', source_hold_count: 'invalid',
  }), /atlas_adapter_invalid_receipt/);
});

test('incomplete ProPublica search never requests details or posts observations', async () => {
  const { runIngestProPublica } = await import('../src/adapters/proPublicaAdapter.js');
  let searchCalls = 0, details = 0, posts = 0;
  const receipt = await runIngestProPublica(null, 'WA', {
    search: async () => { searchCalls++; return { organizations: [{ ein: 123456789 }], num_pages: 2 }; },
    getDetail: async () => { details++; throw Error('unexpected source detail request'); },
    postSignals: async () => { posts++; throw Error('unexpected Atlas write'); },
  });
  assert.equal(searchCalls, 1);
  assert.equal(details, 0);
  assert.equal(posts, 0);
  assert.equal(receipt.ingested_count, 0);
  assert.equal(receipt.source_hold.reason, 'source_window_incomplete');
  assert.throws(() => assertCompleteAdapterReceipt(receipt), /atlas_adapter_missing_receipt/);
});

test('adapter source holds survive rejection as structured evidence', () => {
  const hold = { accepted: false, status: 'held', source_hold: {
    source:'open_states', reason:'source_window_incomplete', records_seen:20,
  } };
  assert.throws(() => assertCompleteAdapterReceipt(hold), error => {
    assert.match(error.message,/atlas_adapter_missing_receipt/);
    assert.deepEqual(error.source_hold,hold.source_hold);
    return true;
  });
  const partial = { accepted: true, status:'partial', source_hold_count:1, source_holds:[
    {source_record_id:'123456789',reason:'atlas_source_timestamp_missing'},
  ]};
  assert.throws(() => assertCompleteAdapterReceipt(partial), error => {
    assert.equal(error.source_hold.held_count,1);
    return true;
  });
  assert.throws(() => assertCompleteAdapterReceipt({accepted:true,status:'held'}), /atlas_adapter_incomplete_receipt/);
  assert.match(scheduler,/source_hold: error\?\.source_hold \?\? null/);
});

test('standalone adapter CLI reports holds and partial source windows as exit code 1', () => {
  const hold = {accepted:false,status:'held',ingested_count:0,source_hold:{source:'court_listener',reason:'source_window_incomplete'}};
  const result = evaluateAdapterCliReceipt(hold);
  assert.equal(result.ok,false);
  assert.equal(result.exit_code,1);
  assert.deepEqual(result.source_hold,hold.source_hold);
  assert.equal(evaluateAdapterCliReceipt({accepted:true,status:'partial',records_failed:1}).exit_code,1);
  assert.equal(evaluateAdapterCliReceipt({accepted:true,status:'completed',records_failed:0}).exit_code,0);
  for (const p of ['courtListenerAdapter.js','openStatesAdapter.js','proPublicaAdapter.js']) {
    const code = read('../src/adapters/' + p);
    assert.match(code, /evaluateAdapterCliReceipt\(result\)/);
    assert.match(code, /process\.exitCode = cli\.exit_code/);
    assert.doesNotMatch(code, /JSON\.stringify\(\{ ok: true, source:/);
  }
});

test('manual aggregate adapter failure output retains structured source hold identifiers', () => {
  const source = {source:'pro_publica',reason:'source_metadata_unverified',
    held_count:1,held_refs:[{source_record_json_sha256:'a'.repeat(64),reason:'atlas_source_timestamp_missing'}]};
  let thrown;
  try { assertCompleteAdapterReceipt({accepted:false,status:'held_source_metadata',source_hold:source}); }
  catch (e) { thrown=e; }
  const failure = formatAdapterRunFailure('propublica',thrown,25);
  assert.equal(failure.status,'error');
  assert.equal(failure.source_hold.reason,'source_metadata_unverified');
  assert.equal(failure.source_hold.held_refs[0].source_record_json_sha256,'a'.repeat(64));
  assert.match(runner, /formatAdapterRunFailure\(adapter\.name, e, elapsed\)/);
  assert.match(runner, /\[HOLD\]/);
  assert.match(runner, /source_hold=\$\{JSON\.stringify\(r\.source_hold\)\}/);
});
