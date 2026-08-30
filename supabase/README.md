# Atlas Supabase migration boundary

`supabase/migrations/` is the only canonical migration root. It contains a
generated 51-version `ready` chain: one current production-derived schema
squash at the existing first production-ledger version, 48 historical ledger
receipts, and two preview-accepted forward repairs (operational hardening and
explicit PostgreSQL 17 function-lint repairs). `ready` means the chain passed
isolated replay and hosted-preview acceptance; it does not mean the draft PR
was merged or either repair was applied to production.

## Retrieved production observations (2026-08-30)

- Project: `bjdjjgnkhxblnpdrjqtw` (`Atlas`, `us-east-1`), PostgreSQL 17.6.
- Production ledger: 49 unique versions from `20260513203455` through
  `20260822082205`; ordered ledger SHA-256
  `278e15ff6dddc371e0484145c4aaa2fefb82913b83e28acf5729e35cd009af7f`.
- A durable statement-free receipt of all 49 ordered version/name and
  statement/rollback hashes is checked in at
  `supabase/evidence/production-migration-ledger.json` (file SHA-256
  `7bb1cad2173705e1ff645132484e9c4bdca63c44cb9d2baa82da2e9b73d08c07`).
  The validator recomputes its ordered digest on every run.
- The complete read-only catalog capture covers 3 application schemas, 209
  relations, 2,514 columns, 425 constraints, 451 indexes, 34 sequences, 96
  functions, 61 views, 20 triggers, 45 policies, and 114 comments. The
  deterministic evidence-root SHA-256 is
  `5af30282c1b0e3a09de8370e0cac86bf7db78a6d7bdaa36cd2e216db799b7f26`.
- Production extensions include `pgcrypto`, `http`, `pg_net`, `uuid-ossp`,
  `pg_stat_statements`, `supabase_vault`, and `plpgsql`. The baseline must not
  pin extension versions.
- A catalog/FK dependency closure identified 22 foundational relations absent
  from the represented ledger before first use. The closure evidence SHA-256
  is `cd88ccc1e64eb54bccd55274ddd4e74509c8c3060d715d0f90c583eae0b11317`.
  Lost pre-ledger shapes are explicitly represented as a current-state squash,
  not fabricated history.
- Two ledger rows executed SQL obtained from transient
  `net._http_response` rows. Those response rows no longer exist. Exact source
  payloads were recovered by content hash at
  `src/schema/20260726_event_entity_resolution.sql` and
  `src/schema/20260730_event_entity_resolution_usaspending_extraction_fix.sql`;
  neither transient row nor runtime fetch is used by the canonical chain.
- The baseline declares `pg_net` without pinning its version before
  any dependent function.
- Eighteen retired, invalid, or unsupported runtime functions and four bridge
  triggers are intentionally excluded. The `atlas` schema and four sensitive
  bridge/export functions are tightened to `service_role` only. These are
  reviewed target differences from the captured production catalog, not
  accidental drift.
- Platform-owned `supabase_admin` default ACLs are evidence only and are not
  replayed by the unprivileged hosted migration role. Future postgres-owned
  objects in `atlas`, `public`, and `private` default to `service_role` access;
  existing public table/view grants and RLS policies remain represented unless
  an object is explicitly listed as hardened.

## Repository classifications

| Root | Classification | Rule |
| --- | --- | --- |
| `supabase/migrations/` | Canonical | Deterministically generated baseline and ledger receipts |
| `supabase/tests/` | Validation SQL | pgTAP acceptance checks; never schema source |
| `src/schema/` | Noncanonical input | Hash-inventoried legacy SQL, dumps, and verification scripts |
| `sql/openstates/` | Noncanonical input | Duplicate destructive operational cleanup SQL |

Every SQL file and SHA-256 is enumerated in `migration-manifest.json`. Any new
SQL file, hash drift, missing file, duplicate version, reordered migration, or
runtime payload dependency fails `npm run db:validate`.

## Gate behavior

The workflow separates immutable candidate evidence from the stable required
check. `database-replay-evidence` runs the full database proof, while
`database-migration-gate` verifies the accepted candidate ancestry and receipt
before requiring `ready`. It classifies any SQL, Supabase boundary, migration
tooling, or matching workflow change as database-bearing. If Git history is too
shallow or the comparison base is unavailable, classification is
conservatively database-bearing.

For a database-bearing change, `candidate` and `ready` states use pinned
Supabase CLI 2.116.0 and `major_version = 17` to:

1. start an isolated local Supabase stack;
2. replay every canonical migration from empty;
3. run prerequisite, extension, RLS, and policy assertions;
4. fail on database lint errors;
5. compare the local ledger before and after `supabase migration up --local`
   to prove dirty replay is a no-op; and
6. reset and replay a second time to expose order-dependent state; and
7. require `canonical.status=ready` as the final step.

The candidate replay job can succeed while the stable gate remains red. The
ready metadata commit must be exactly one child of the accepted candidate and
may change only the manifest, acceptance receipt, and this README. The stable
gate verifies the recorded candidate run and all five replay phases through the
GitHub API before it can turn green. Deleted migration-boundary files are
included in path classification.

## Baseline closure procedure

Production remained read-only. Candidate commit
`e4daf550d983c11250558bbae19ee2ea651d86ae` passed GitHub run
`33336833312`, replay-evidence job `99325144249`: empty PostgreSQL 17 replay,
56/56 pgTAP assertions, zero-error lint, dirty no-op replay, and a second clean
replay. The isolated hosted preview `pfslrupnskktspdaayfq` independently proved
the exact 51-version ledger on PostgreSQL 17.6, the expected catalog counts,
the intended retired-object exclusions and grants, and fresh advisors with 26
INFO, 0 WARN, and 0 ERROR findings. The hash-bound receipt is
`supabase/evidence/hosted-preview-acceptance.json`.

Production is still at its original 49-row ledger. The two forward repairs are
preview-only, the PR remains draft and unmerged, and Render was not deployed.

Supabase's current workflow documentation recommends `supabase db pull` when
adopting an existing project because it creates a baseline and records it as
applied remotely. That remote-ledger write requires separate approval here;
this repository repair does not perform it.

## Legacy direct SQL path

`scripts/apply-sql-management-api.mjs` no longer selects production by default.
It is retained only as explicit break-glass compatibility: it requires a typed
acknowledgement, explicit project reference, exact reviewed SHA-256, and a file
already present in the noncanonical manifest. It still bypasses the migration
ledger and is not an acceptable normal deployment path.

## Current unknowns

- Original pre-ledger history is irrecoverable. The accepted operational model
  is a transparent current production-derived squash, and must always be
  described that way.
- Platform-owned `supabase_admin` default ACLs remain outside this migration's
  authority. Application DDL must remain `postgres`-owned or receive a renewed
  ACL review.
- The production Data API exposed-schema setting still requires direct
  verification; the accepted chain nevertheless revokes `atlas` usage from
  anonymous and authenticated roles.

References: [Supabase local development workflow](https://supabase.com/docs/guides/local-development/cli-workflows),
[database migrations](https://supabase.com/docs/guides/local-development/database-migrations),
and [PostgreSQL 17 upgrade notes](https://supabase.com/docs/guides/self-hosting/postgres-upgrade-17).
