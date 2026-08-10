import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migrationPairs = [
  [
    '../src/schema/20260726_event_entity_resolution.sql',
    '../supabase/migrations/20260730194805_20260726_event_entity_resolution.sql',
  ],
  [
    '../src/schema/20260730_event_entity_resolution_usaspending_extraction_fix.sql',
    '../supabase/migrations/20260730195601_20260730_event_entity_resolution_usaspending_extraction_fix.sql',
  ],
  [
    '../src/schema/20260809_signal_ontology_read_model.sql',
    '../supabase/migrations/20260809170900_atlas_signal_ontology_read_model.sql',
  ],
  [
    '../src/schema/20260809_signal_ontology_read_model_privileges.sql',
    '../supabase/migrations/20260809171314_atlas_signal_ontology_read_model_privileges.sql',
  ],
];

function sha256(path) {
  return createHash('sha256').update(readFileSync(new URL(path, import.meta.url))).digest('hex');
}

test('Supabase integration migrations are byte-identical to the deployed Atlas schema sources', () => {
  for (const [source, integration] of migrationPairs) {
    assert.equal(sha256(integration), sha256(source), `${integration} drifted from ${source}`);
  }
});
