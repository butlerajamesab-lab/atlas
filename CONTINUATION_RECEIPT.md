# Atlas Mathematical-Substrate Verification Receipt v2.1.0

**Branch:** `feature/mathematical-substrate-completion`
**Reviewed implementation head:** `c5465ffe70df38c859fd3a01aed9b001e179c5c5`
**Verification receipt head:** `79e11576760af75689fda641d5a47940fa6f7140`
**Base:** `1bd6e4f9e0e1b4958225b2f1bf6c912fe00b5327`
**Acceptance state:** **REJECTED — DO NOT MERGE OR DEPLOY**

## Verified progress

- Canonical recursive serialization and SHA-256 hashing are present.
- Area-weighted Poisson convergence code is present.
- A production runner, controlled route, replay implementation, and persistence migration are present in source.
- Existing GitHub workflows remain green for their pre-existing test scopes.

## Blocking defects

1. The new substrate suites are not part of `npm test` or the production build check.
2. `test/washingtonProof.test.js` imports a nonexistent `src/substrate/fingerprint.js` and also targets obsolete pre-v2.1 APIs.
3. The production population loader reads only `public.signal_events`; it does not join `atlas.signal_event_identity`, does not paginate, and therefore does not prove a complete population.
4. The persisted "raw" snapshot contains transformed signal objects rather than complete canonical source-event rows.
5. The run key does not bind the source-population hash, permitting the same run identity to be recomputed against later backfills.
6. Per-geography `receipt_identity` is persisted as `input_hash`; it does not bind the computed output.
7. The migration creates tables in schema `atlas`, while runner/status queries use default-schema `.from(...)` calls.
8. Zero-signal registry geographies are not evaluated unless explicitly requested, so not every governed outcome receives a receipt.
9. The route supplies default thresholds despite the explicit governed-input contract.
10. The migration uses SECURITY DEFINER functions without fixed `search_path`, grants broad `service_role` policies, and exposes manifests/results/receipts to `authenticated` without an established read contract.
11. The completion RPC can return a supplied output hash even when an existing result payload prevented insertion, so it does not prove idempotent equality.
12. Production route/runner/persistence/replay tests are environment-gated and currently skipped; no live persistence or replay receipt exists.
13. The Atlas migration is not applied, the exact branch is not deployed, and the Lighthouse handoff is not active.
14. A Render API credential appeared in ancestor commit `6bcfeaa70971f859d03f4ddf35c6be0cab7e3fe2`; deleting it from the current file does not remove it from history. The credential must be revoked and rotated.

## Required acceptance sequence

1. Rotate the exposed Render credential.
2. Replace the obsolete Washington proof with v2.1 tests and wire all substrate tests into CI/build.
3. Repair complete-population loading, source snapshots, run identity, receipt identity, schema-qualified persistence, and zero-outcome receipts.
4. Harden the migration: fixed search paths, least privilege, complete immutable-field enforcement, and strict idempotency checks.
5. Add permanent unit and integration coverage for the runner, route, migration contracts, replay, backfill mutation, pagination, and receipt conflicts.
6. Apply the accepted migration through the governed Atlas Supabase path.
7. Deploy the exact accepted commit to Render.
8. Execute a bounded real Washington run, persist all receipts, replay from snapshots, and prove identical output and receipt identities.
9. Activate the governed Lighthouse handoff only after Atlas production receipts pass.

No completion or activation claim is accepted until every step above has a production receipt.
