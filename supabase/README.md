# Atlas Supabase integration boundary

Atlas production uses Supabase project `bjdjjgnkhxblnpdrjqtw`. Its governed SQL
sources currently live in `src/schema/` and are applied through the repository's
explicit management-API scripts or a controlled Supabase migration operation.

This repository does **not** yet contain a complete, executable migration
baseline capable of rebuilding Atlas from an empty database. In particular,
the original creation DDL for core dependencies such as
`public.signal_events`, `atlas.entity_registry`, and `atlas.entity_aliases` is
not represented as an ordered chain under `supabase/migrations/`.

Supabase preview branches start without production data or this historical
schema. Therefore, late migrations from `src/schema/` must not be copied into
`supabase/migrations/` individually. A partial chain can appear complete in the
production database while failing correctly on an empty preview branch.

Before enabling Git-driven database migrations here:

1. Generate and review a complete schema-only baseline from Atlas production.
2. Reconcile that baseline with the existing entries in
   `supabase_migrations.schema_migrations`.
3. Prove an empty preview can apply the baseline and every later migration in
   deterministic order.
4. Preserve service-role-only grants, RLS, pinned function search paths, and
   the separation between normalized observations and governed civic signals.

Until those gates pass, `src/schema/` and the live Supabase migration receipts
remain the authoritative implementation evidence. This directory documents the
integration boundary; it is intentionally not a partial migration history.
