# Canonical Atlas migration root

Only reviewed, replayable Supabase migrations belong in this directory.

The root is intentionally empty while `../migration-manifest.json` records the
baseline as `blocked`. The current SQL under `src/schema/` and
`sql/openstates/` is incomplete, partly post-baseline, and therefore must not be
copied here piecemeal.

Create migration filenames with the Supabase CLI. Do not handcraft timestamps.
The migration gate requires a production-derived baseline, deterministic
ordering, exact manifest hashes, PostgreSQL 17 replay, and no dependency on
transient database rows or network-fetched SQL.
