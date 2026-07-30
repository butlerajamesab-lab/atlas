import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  EVENT_ENTITY_RESOLVER_ID,
  EVENT_ENTITY_RESOLVER_VERSION,
  EVENT_ENTITY_RULE_MANIFEST,
  EVENT_ENTITY_RULE_MANIFEST_HASH,
  sha256Text,
  stableStringify,
} from '../src/services/eventEntityResolution.js';

const manifestPath = new URL('../src/schema/event_entity_rule_manifest.json', import.meta.url);
const migrationPath = new URL('../src/schema/20260726_event_entity_resolution.sql', import.meta.url);

test('machine-readable rule manifest is byte-contract equivalent to the resolver', async () => {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(manifest.resolver_id, EVENT_ENTITY_RESOLVER_ID);
  assert.equal(manifest.resolver_version, EVENT_ENTITY_RESOLVER_VERSION);
  assert.equal(manifest.rule_manifest_hash, EVENT_ENTITY_RULE_MANIFEST_HASH);
  assert.equal(manifest.rules.length, EVENT_ENTITY_RULE_MANIFEST.length);

  const strippedRules = manifest.rules.map(({ rule_contract_hash, ...rule }) => {
    assert.equal(rule_contract_hash, sha256Text(stableStringify(rule)));
    return rule;
  });
  assert.deepEqual(strippedRules, EVENT_ENTITY_RULE_MANIFEST);
});

test('migration embeds the same locked rule manifest and every per-rule contract hash', async () => {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const migration = await readFile(migrationPath, 'utf8');
  assert.match(migration, new RegExp(manifest.rule_manifest_hash));
  for (const rule of manifest.rules) {
    assert.match(migration, new RegExp(rule.rule_id.replaceAll('.', '\\.')));
    assert.match(migration, new RegExp(rule.rule_contract_hash));
  }
});
