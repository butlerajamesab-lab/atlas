import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const server = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../src/routes/ui.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/atlas-app.js', import.meta.url), 'utf8');
const drilldown = readFileSync(new URL('../public/atlas-drilldown.js', import.meta.url), 'utf8');

test('Atlas frontend is served by the existing Atlas service before the private control boundary', () => {
  const uiMount = server.indexOf('app.use(atlasUiRouter(routeContext))');
  const staticMount = server.indexOf("app.use(express.static('public'");
  const privateBoundary = server.indexOf('app.use(requireControl)');
  assert.ok(uiMount >= 0 && staticMount > uiMount && privateBoundary > staticMount);
  assert.match(server, /frontend_available: true/);
});

test('public read model exposes only bounded public-safe event detail', () => {
  assert.match(ui, /LEGISLATIVE_STREAM_ID = 'civic_genome_legislative_versions'/);
  assert.match(ui, /Math\.min\(Math\.max\(requested, 1\), 100\)/);
  assert.match(ui, /\.eq\('stream_id', LEGISLATIVE_STREAM_ID\)/);
  assert.doesNotMatch(ui, /auth_config/);
  assert.doesNotMatch(ui, /service_role/i);
  assert.doesNotMatch(ui, /ATLAS_CONTROL_TOKEN/);
});

test('overview exposes source readiness without connector secrets', () => {
  assert.match(ui, /safeSourceRow/);
  assert.match(ui, /operational_readiness_state/);
  assert.match(ui, /freshness_status/);
  assert.match(ui, /schema_status/);
  assert.match(ui, /unknown/);
});

test('frontend preserves Atlas constitutional ownership boundaries', () => {
  assert.match(ui, /atlas: 'source-bound observations, governed civic-signal derivation, domain-space comparison, structural relationships, convergence math, deterministic receipts'/);
  assert.match(ui, /rosetta: 'legal decomposition and source truth'/);
  assert.match(ui, /prism: 'verification and contradiction\/incompleteness receipts'/);
  assert.match(ui, /kaleidoscope: 'generation comparison and consequence projection'/);
  assert.match(app, /Atlas stops before legal interpretation, verification ownership, consequence projection, or action dispatch/);
});

test('frontend provides the planned inspection surfaces', () => {
  for (const view of ['overview','sources','streams','substrate','legislative','contracts','boundary','operations']) {
    assert.match(html, new RegExp(`data-view="${view}"`));
  }
  assert.match(app, /one observation per generation/i);
  assert.match(app, /failed amendments/i);
  assert.match(app, /source-native Prism\/Rosetta states/i);
  assert.match(app, /Observation is not signal/);
});

test('click-through inspection exposes public detail and protected receipts without persisting credentials', () => {
  assert.match(html, /atlas-drilldown\.js/);
  assert.match(drilldown, /INSPECTION RECEIPT/);
  assert.match(drilldown, /\/ui-api\/signal-derivation/);
  assert.match(drilldown, /\/ui-api\/legislative-history/);
  assert.match(drilldown, /\/operator-api\/substrate/);
  assert.match(drilldown, /source_event_refs|candidate evidence/);
  assert.match(drilldown, /action_receipts/);
  assert.doesNotMatch(drilldown, /localStorage/);
  assert.doesNotMatch(drilldown, /sessionStorage/);
});

test('live frontend refreshes retrieved state and never persists the operator token', () => {
  assert.match(app, /cache: 'no-store'/);
  assert.match(app, /setInterval/);
  assert.match(app, /authorization = `Bearer/);
  assert.doesNotMatch(app, /localStorage/);
  assert.doesNotMatch(app, /sessionStorage/);
});
