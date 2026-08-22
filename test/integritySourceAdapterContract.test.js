import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const fec = readFileSync(new URL('../src/adapters/fecCampaignFinanceAdapter.js', import.meta.url), 'utf8');
const lda = readFileSync(new URL('../src/adapters/openSecretsAdapter.js', import.meta.url), 'utf8');
const fara = readFileSync(new URL('../src/adapters/faraForeignAgentsAdapter.js', import.meta.url), 'utf8');

test('FEC adapter preserves exact source IDs and never labels a committee as dark money', () => {
  assert.match(fec, /canonical_entity_id: exactCommitteeId/);
  assert.match(fec, /recipient_committee_id/);
  assert.match(fec, /kind: 'financial_transfer'/);
  assert.match(fec, /disclosure_review_reasons/);
  assert.doesNotMatch(fec, /signal_type:\s*isDarkMoney/);
  assert.doesNotMatch(fec, /Math\.random\(/);
});

test('Senate LDA adapter emits a transfer only when exact client and registrant IDs exist', () => {
  assert.match(lda, /clientId && registrantId && amount > 0 && filingDate/);
  assert.match(lda, /senate_lda:client:/);
  assert.match(lda, /senate_lda:registrant:/);
  assert.match(lda, /missing_exact_client_id/);
  assert.match(lda, /missing_exact_registrant_id/);
});

test('FARA adapter binds registrations to their exact source registration number', () => {
  assert.match(fara, /fara:registrant:/);
  assert.match(fara, /fara_registration_number/);
  assert.match(fara, /kind: 'entity_registration'/);
});
