// Senate LDA activity-detail contract (2026-11-08): a lobbying
// filing's substance is the per-activity free-text description and
// the entities lobbied, both present in the LDA API response. The
// normalizer must preserve them; keeping only the general issue
// codes leaves a category label with nothing researchable behind
// it (stream-substance audit, 2026-11-08).

import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeLobbyingFiling } from '../src/adapters/openSecretsAdapter.js';

const filing = {
  filing_uuid: 'eec7578c-428f-43bc-901b-e17ca25b8283',
  registrant_name: 'HEIDEMAN NUDELMAN & KALIK, PC',
  client_name: 'AMERICAN VICTIMS OF SUDAN TERROR',
  income: '0',
  dt_posted: '2026-11-06T16:30:09-05:00',
  filing_type: 'Q3',
  registrant: { id: 314113 },
  client: { id: 207546 },
  lobbying_activities: [
    {
      general_issue_code: 'FOR',
      general_issue_code_display: 'Foreign Relations',
      description: 'Advocacy concerning compensation for victims of state-sponsored terrorism, including outreach on pending claims legislation.',
      government_entities: [{ name: 'Senate' }, { name: 'House of Representatives' }],
    },
    {
      general_issue_code: 'GOV',
      general_issue_code_display: 'Government Issues',
      description: 'Monitoring of executive branch actions relating to terrorism victim compensation funds.',
      government_entities: [{ name: 'Executive Office of the President' }],
    },
  ],
};

test('per-activity descriptions survive normalization verbatim', () => {
  const signal = normalizeLobbyingFiling(filing);
  assert.equal(signal.payload.activity_details.length, 2);
  assert.equal(
    signal.payload.activity_details[0].description,
    'Advocacy concerning compensation for victims of state-sponsored terrorism, including outreach on pending claims legislation.',
  );
  assert.equal(signal.payload.activity_details[0].general_issue_code, 'FOR');
  assert.deepEqual(
    signal.payload.activity_details[0].government_entities,
    ['Senate', 'House of Representatives'],
  );
  // The legacy category field is unchanged.
  assert.equal(signal.payload.issues, 'FOR, GOV');
});

test('filing-level government entities fall back to the union of activity entities', () => {
  const signal = normalizeLobbyingFiling(filing);
  assert.equal(
    signal.payload.government_entities,
    'Executive Office of the President, House of Representatives, Senate',
  );
});

test('a filing without activities still normalizes with an empty detail list', () => {
  const bare = { ...filing, lobbying_activities: undefined, specific_issues: 'TRD' };
  const signal = normalizeLobbyingFiling(bare);
  assert.deepEqual(signal.payload.activity_details, []);
  assert.equal(signal.payload.government_entities, null);
  assert.equal(signal.payload.issues, 'TRD');
});
