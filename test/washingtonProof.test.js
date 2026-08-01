import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from '../src/substrate/canonical.js';
import { buildConvergenceComputation } from '../src/services/convergenceRunner.js';

const geographyPackage = {
  jurisdiction: 'us_wa',
  source_id: 'census_tiger_2024',
  source_version: 'test',
  source_url: 'https://www.census.gov/',
  registry_hash: 'a'.repeat(64),
  records: [
    {
      jurisdiction_id: 'us_wa', source_id: 'census_tiger_2024', source_record_id: 'STATEFP:53',
      name: 'Washington', level: 'state', fips_code: '53', parent_jurisdiction_id: null,
      area_sq_km: 184827, centroid_lat: 47.3826, centroid_lon: -120.4472,
      effective_from: '2024-01-01', effective_to: null, adjacent_to: [],
    },
    {
      jurisdiction_id: 'us_wa_king', source_id: 'census_tiger_2024', source_record_id: 'COUNTYFP:53033',
      name: 'King County', level: 'county', fips_code: '53033', parent_jurisdiction_id: 'us_wa',
      area_sq_km: 5975, centroid_lat: 47.49, centroid_lon: -121.84,
      effective_from: '2024-01-01', effective_to: null, adjacent_to: ['us_wa_pierce'],
    },
    {
      jurisdiction_id: 'us_wa_pierce', source_id: 'census_tiger_2024', source_record_id: 'COUNTYFP:53053',
      name: 'Pierce County', level: 'county', fips_code: '53053', parent_jurisdiction_id: 'us_wa',
      area_sq_km: 4679, centroid_lat: 47.05, centroid_lon: -122.11,
      effective_from: '2024-01-01', effective_to: null, adjacent_to: ['us_wa_king'],
    },
  ],
};

function sourceRow(offset, jurisdiction, payload) {
  return {
    stream_id: 'test_stream',
    offset: String(offset),
    timestamp: `2026-07-0${offset}T00:00:00Z`,
    signal_type: 'consumer_complaint',
    spacetime: {},
    provenance: { source: 'fixture' },
    payload,
    source_id: 'fixture',
    jurisdiction_id: jurisdiction,
    module_hint: 'consumer',
    ingested_at: `2026-07-0${offset}T01:00:00Z`,
    event_identity_hash: sha256({ offset, payload }),
    canonical_identity: { canonical_offset: String(offset), replay_count: '0' },
  };
}

const baseConfiguration = {
  as_of: Date.parse('2026-08-01T00:00:00Z'),
  time_window_ms: 40 * 86400000,
  temporal_bucket_ms: 86400000,
  geography_registry_version: geographyPackage.registry_hash,
  analysis_level: 'state',
  min_signals_for_analysis: 1,
  z_score_threshold: 2,
  persist: false,
};

test('bounded v2.1 proof produces source-bound state receipt', () => {
  const sourcePopulation = [
    sourceRow(1, 'WA', { product: 'mortgage' }),
    sourceRow(2, 'Washington', { product: 'credit_card' }),
  ];
  const computation = buildConvergenceComputation({
    source_population: sourcePopulation,
    geography_package: geographyPackage,
    configuration: baseConfiguration,
    target_geographies: ['US_WA'],
  });

  assert.equal(computation.receipts.length, 1);
  assert.equal(computation.receipts[0].geography_id, 'US_WA');
  assert.match(computation.receipts[0].receipt_identity, /^[a-f0-9]{64}$/);
  assert.equal(computation.receipts[0].source_population_hash, sha256(sourcePopulation));
  assert.equal(computation.output_hash, sha256(computation.complete_output));
});

test('run identity changes when canonical source content changes', () => {
  const first = buildConvergenceComputation({
    source_population: [sourceRow(1, 'WA', { product: 'mortgage' })],
    geography_package: geographyPackage,
    configuration: baseConfiguration,
    target_geographies: ['US_WA'],
  });
  const second = buildConvergenceComputation({
    source_population: [sourceRow(1, 'WA', { product: 'changed' })],
    geography_package: geographyPackage,
    configuration: baseConfiguration,
    target_geographies: ['US_WA'],
  });
  assert.notEqual(first.source_population_hash, second.source_population_hash);
  assert.notEqual(first.run_key, second.run_key);
  assert.notEqual(first.output_hash, second.output_hash);
});

test('every county receives a receipt even when no county signal resolves', () => {
  const computation = buildConvergenceComputation({
    source_population: [sourceRow(1, 'WA', { product: 'mortgage' })],
    geography_package: geographyPackage,
    configuration: { ...baseConfiguration, analysis_level: 'county', min_signals_for_analysis: 1 },
    target_geographies: null,
  });
  assert.equal(computation.receipts.length, 2);
  assert.deepEqual(computation.receipts.map((receipt) => receipt.status), ['below_threshold', 'below_threshold']);
  assert.equal(computation.transform_errors[0].reason, 'geography_level_mismatch');
});
