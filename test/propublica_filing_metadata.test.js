import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { normalizeProPublicaFiling, normalizeToFiling } from '../src/adapters/proPublicaAdapter.js';

const population = JSON.parse(readFileSync(new URL('./fixtures/propublica_filing_population_20260910.json', import.meta.url), 'utf8'));
const stable_updated = '2026-01-01T00:00:00.000Z';

test('preserves source filing metadata across all 113 captured filings and ten organizations', () => {
  assert.equal(population.rows.length, 113);
  assert.equal(new Set(population.rows.map(row => row.organization.ein)).size, 10);
  assert.equal(population.rows.filter(row => row.filing.formtype === 0).length, 89);
  for (const row of population.rows) {
    const source_before = JSON.stringify(row);
    const signal = normalizeProPublicaFiling(row.filing, { organization: row.organization });
    assert.equal(signal.payload.tax_period, row.filing.tax_prd, row.source_offset);
    assert.equal(signal.spacetime.tax_period, row.filing.tax_prd, row.source_offset);
    assert.equal(signal.payload.form_type, row.filing.formtype, row.source_offset);
    assert.equal(signal.payload.external_id, `${row.organization.ein}-${row.filing.tax_prd}`);
    assert.equal(signal.payload.pdf_url, row.filing.pdf_url);
    assert.equal(signal.provenance.source_url, row.filing.pdf_url || `https://projects.propublica.org/nonprofits/organizations/${row.organization.ein}`);
    assert.equal(signal.timestamp, new Date(row.filing.updated).toISOString());
    assert.deepEqual(signal.payload.raw, row.filing);
    assert.equal(JSON.stringify(row), source_before, 'normalization must not edit the preserved source');
  }
});

test('keeps compatible aliases, explicit submission IDs, and populated financial fields', () => {
  const filing = { sub_id: 'submission-1', tax_period: '202412', form_type: '990', updated: stable_updated, totrevenue: 0, totassetsend: 250 };
  const signal = normalizeToFiling(filing, { ein: '123456789', state: 'WA' });
  assert.equal(signal.payload.external_id, 'submission-1');
  assert.equal(signal.payload.tax_period, '202412');
  assert.equal(signal.payload.form_type, '990');
  assert.equal(signal.payload.total_revenue, 0);
  assert.equal(signal.payload.total_assets, 250);
  assert.equal(signal.spacetime.region, 'WA');
});

test('retains every official form code, including zero, ahead of compatibility aliases', () => {
  for (const formtype of [0, 1, 2]) {
    const signal = normalizeProPublicaFiling({ tax_prd: 202412, tax_period: 202312, formtype, form_type: 'alias', updated: stable_updated });
    assert.equal(signal.payload.tax_period, 202412);
    assert.equal(signal.payload.form_type, formtype);
  }
});

test('missing source metadata remains missing and null official fields permit aliases', () => {
  const missing = normalizeProPublicaFiling({ updated: stable_updated }, { organization: { ein: '123456789' } });
  assert.equal(missing.payload.tax_period, null);
  assert.equal(missing.payload.form_type, null);
  assert.equal(missing.payload.external_id, '123456789-unknown');
  const aliased = normalizeProPublicaFiling({ tax_prd: null, tax_period: 202412, formtype: null, form_type: 0, updated: stable_updated });
  assert.equal(aliased.payload.tax_period, 202412);
  assert.equal(aliased.payload.form_type, 0);
});

test('different filing periods retain different source IDs for the same organization', () => {
  const organization = { ein: '123456789' };
  const ids = [202312, 202412].map(tax_prd => normalizeProPublicaFiling({ tax_prd, formtype: 0, updated: stable_updated }, { organization }).payload.external_id);
  assert.deepEqual(ids, ['123456789-202312', '123456789-202412']);
});
