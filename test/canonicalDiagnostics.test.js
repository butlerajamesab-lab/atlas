import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalJson, sha256 } from '../src/substrate/canonical.js';

test('canonical JSON preserves existing stable hash semantics', () => {
  assert.equal(canonicalJson({ b: 2, a: [true, null] }), '{"a":[true,null],"b":2}');
  assert.match(sha256({ b: 2, a: [true, null] }), /^[a-f0-9]{64}$/);
});

test('canonical JSON identifies the exact undefined object path', () => {
  assert.throws(
    () => canonicalJson({ replay: { registry: { source_version: undefined } } }),
    /undefined at \$\."replay"\."registry"\."source_version"/,
  );
});

test('canonical JSON identifies the exact undefined array path', () => {
  assert.throws(
    () => canonicalJson({ snapshots: [{ records: [1, undefined] }] }),
    /undefined at \$\."snapshots"\[0\]\."records"\[1\]/,
  );
});
