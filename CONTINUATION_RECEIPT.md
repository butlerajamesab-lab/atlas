# Atlas Mathematical-Substrate Release Candidate Receipt v2.1.0

**Branch:** `feature/mathematical-substrate-completion`
**Release-candidate head:** `9cfa7f267615da564bb4031e06a7615cc4383b9a`
**Base:** `1bd6e4f9e0e1b4958225b2f1bf6c912fe00b5327`
**Acceptance state:** **SOURCE AND DATABASE GATES PASSED — PRODUCTION DEPLOYMENT ACCEPTANCE PENDING**

## Verified source state

- Canonical recursive JSON serialization rejects undefined and non-finite values.
- Run identity binds the complete canonical source-population hash, rule manifest, registry version and hash, configuration, engine version, and explicit `as_of`.
- Area-weighted Poisson convergence uses a single declared analysis-level geography partition.
- Every governed geography receives a resolved, unresolved, or below-threshold receipt.
- Receipt identity binds both complete input and complete output hashes.
- Canonical source loading joins `public.signal_events` to `atlas.signal_event_identity` and paginates by `(stream_id, offset)`.
- Source, transformed, and deduplicated populations are preserved as separate immutable snapshots.
- Persistence uses one atomic, advisory-locked RPC with strict idempotency comparison.
- Replay rebuilds from the persisted source snapshot and compares run key, complete output hash, and the complete receipt-identity manifest.
- The direct Atlas-to-Lighthouse service-role fallback was removed; Domain 3 remains database-owned.

## Permanent CI

GitHub Actions run `30723871332` passed on Node 18, 20, and 22. The production build syntax-checks all convergence runtime files. The test command includes legacy contracts, substrate mathematics, migration contracts, route contracts, canonical pagination, atomic persistence, Washington proofs, and the fixed-input deployment acceptance runner.

The four credential-dependent Washington production tests remain intentionally skipped in GitHub Actions and must pass against the deployed service and production database.

## Production database

Migration `20260801233925 atlas_convergence_v21_atomic_persistence` is applied to Atlas Supabase project `bjdjjgnkhxblnpdrjqtw`.

Verified database properties:

- five convergence tables have forced RLS;
- all five tables have immutable update/delete triggers;
- browser roles and `service_role` have no direct table privileges;
- four `SECURITY DEFINER` RPCs pin `search_path = pg_catalog, public, atlas`;
- only `service_role` can execute the convergence RPCs;
- the source-population RPC returns canonical identity-bound rows.

## Remaining production gates

1. Merge and deploy the exact accepted source to Atlas Render service `srv-d845j5vaqgkc73acfgeg`.
2. Run the fixed-input Washington acceptance at `as_of = 1785542400000`.
3. Persist the run, all snapshots, the per-geography receipt, and complete result payload.
4. Replay from persisted snapshots and prove identical output and receipt identities.
5. Activate and verify the governed Lighthouse handoff.
6. Revoke and rotate the Render API credential exposed in ancestor commit `6bcfeaa70971f859d03f4ddf35c6be0cab7e3fe2`.

Atlas v2.1 is not declared fully activated until the deployment, replay, and Lighthouse receipts exist.
