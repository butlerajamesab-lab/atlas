import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../src/schema/20260822_domain3_integrity_projection_identity.sql', import.meta.url),
  'utf8',
);

test('Atlas projects its immutable candidate identity and evidence without promotion', () => {
  assert.match(migration, /'atlas_candidate_id', v_candidate\.candidate_id/);
  assert.match(migration, /'atlas_candidate_hash', v_candidate\.candidate_hash/);
  assert.match(migration, /'atlas_semantic_key', v_candidate\.semantic_key/);
  assert.match(migration, /'evidence_refs', v_candidate\.evidence_refs/);
  assert.match(migration, /'governance_status', 'observation_candidate'/);
  assert.doesNotMatch(migration, /'governance_status', 'promoted'/);
});

test('candidate bridge remains scoped to the service role', () => {
  assert.match(
    migration,
    /revoke all on function public\.bridge_live_data_signal_candidates_v1\(uuid, integer\)[\s\S]*from public, anon, authenticated/,
  );
  assert.match(
    migration,
    /grant execute on function public\.bridge_live_data_signal_candidates_v1\(uuid, integer\)[\s\S]*to service_role/,
  );
});
