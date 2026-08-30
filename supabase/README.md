# Atlas Supabase migration boundary

`supabase/migrations/` is the only canonical migration root. It is deliberately
empty and marked `blocked` in `migration-manifest.json`; Atlas does not yet have
a reviewed, production-derived baseline that can rebuild an empty database.
This is a safety state, not a claim that Atlas has no database changes.

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
- Live schema fingerprint SHA-256:
  `c030cce77d6c9d11c4bda304c05902b49f08708eecd687ca042afc7a304b6582`.
- Production extensions include `pgcrypto`, `http`, `pg_net`, `uuid-ossp`,
  `pg_stat_statements`, `supabase_vault`, and `plpgsql`. The baseline must not
  pin extension versions.
- A catalog/FK dependency closure identified 22 foundational relations absent
  from the represented ledger before first use. The closure evidence SHA-256
  is `cd88ccc1e64eb54bccd55274ddd4e74509c8c3060d715d0f90c583eae0b11317`.
  Current catalog state does not prove every historical pre-ledger shape.
- Two ledger rows executed SQL obtained from transient
  `net._http_response` rows. Those response rows no longer exist. Exact source
  payloads were recovered by content hash at
  `src/schema/20260726_event_entity_resolution.sql` and
  `src/schema/20260730_event_entity_resolution_usaspending_extraction_fix.sql`;
  the ledger itself remains non-replayable.
- `pg_net` exists in production and is required by a later ledger migration,
  but no ledger statement creates it.

## Repository classifications

| Root | Classification | Rule |
| --- | --- | --- |
| `supabase/migrations/` | Canonical | Reviewed, timestamped Supabase CLI migrations only |
| `supabase/tests/` | Validation SQL | pgTAP acceptance checks; never schema source |
| `src/schema/` | Noncanonical input | Hash-inventoried legacy SQL, dumps, and verification scripts |
| `sql/openstates/` | Noncanonical input | Duplicate destructive operational cleanup SQL |

Every SQL file and SHA-256 is enumerated in `migration-manifest.json`. Any new
SQL file, hash drift, missing file, duplicate version, reordered migration, or
runtime payload dependency fails `npm run db:validate`.

## Gate behavior

The `database-migration-gate` workflow and job return the stable check name
`database-migration-gate`. It classifies any SQL, Supabase boundary, migration
tooling, or matching workflow change as database-bearing. If Git history is
too shallow or the comparison base is unavailable, classification is
conservatively database-bearing.

For a database-bearing change, the gate requires `canonical.status=ready`, then
uses pinned Supabase CLI 2.116.0 and `major_version = 17` to:

1. start an isolated local Supabase stack;
2. replay every canonical migration from empty;
3. run prerequisite, extension, RLS, and policy assertions;
4. fail on database lint errors;
5. compare the local ledger before and after `supabase migration up --local`
   to prove dirty replay is a no-op; and
6. reset and replay a second time to expose order-dependent state.

With the baseline blocked, non-database PRs can pass the static inventory
check, while database-bearing PRs fail closed before a misleading preview can
be treated as success.

## Baseline closure procedure

No production command was run by this repair. Production remains read-only.
To move the manifest to `ready`, a reviewer must:

1. obtain a complete schema-only export from the Atlas project through an
   explicitly approved, read-only workflow;
2. reconcile catalog-derived DDL, all 49 ledger rows, the two recovered
   transient payloads, foundational extensions, roles, grants, RLS, policies,
   default privileges, triggers, functions, and materialized views;
   do not substitute current final-state Atlas DDL for unknown historical DDL;
3. create the baseline filename with the Supabase CLI (never handcraft the
   timestamp), review it, and record its SHA-256 in the manifest;
4. prove an empty PostgreSQL 17-compatible Supabase reset, a dirty
   `supabase migration up --local` no-op, and a second clean reset;
5. run `supabase test db`, `supabase db lint --local --fail-on error`, and the
   Supabase security advisors; and
6. create a fresh isolated branch preview and confirm local/remote migration
   parity before any merge or deployment.

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

- A complete, reviewable production schema-only export is not yet available.
- The 22-relation dependency closure is inventoried, but original historical
  DDL for Atlas-schema core relations and pre-20260517 policies/grants for
  `public.civic_infrastructure_nodes` remain unknown.
- Production default privileges, all function ownership/search paths, and all
  RLS/grant equivalence have not yet been reconciled into a replayable file.
- Whether anonymous/authenticated execution on the two Lighthouse export RPCs
  remains intended requires a product/security decision.
- No fresh Atlas Supabase preview has passed the canonical chain because that
  chain is intentionally not claimed complete.

References: [Supabase local development workflow](https://supabase.com/docs/guides/local-development/cli-workflows),
[database migrations](https://supabase.com/docs/guides/local-development/database-migrations),
and [PostgreSQL 17 upgrade notes](https://supabase.com/docs/guides/self-hosting/postgres-upgrade-17).
