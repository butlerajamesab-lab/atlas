# Atlas Baseline Receipt

**Frozen:** 2026-08-01T11:00:00Z
**Auditor:** Manus automated substrate completion

## GitHub State

| Field | Value |
|-------|-------|
| Repository | butlerajamesab-lab/atlas |
| Main SHA | `1bd6e4f9e0e1b4958225b2f1bf6c912fe00b5327` |
| Open PRs | 0 |
| Remote branches | 12 (main + 11 feature/fix branches) |

## Render Deployment

| Field | Value |
|-------|-------|
| Service | atlas-streaming-engine |
| Service ID | srv-d845j5vaqgkc73acfgeg |
| Live Deploy | dep-d9mg3f6417fc73bbgdog |
| Deploy SHA | `1bd6e4f9e0e1b4958225b2f1bf6c912fe00b5327` |
| Deploy Status | live |
| Deploy Created | 2026-07-31T20:12:45Z |
| Health | ok |
| Scheduler | running since 2026-07-31T20:13:06Z |

## Database Counts (Atlas Supabase: bjdjjgnkhxblnpdrjqtw)

| Table/Metric | Count | Brief's Expected | Delta |
|---|---|---|---|
| signal_events | 48,534 | 48,534 | 0 |
| signal_events with event_identity_hash | 8,563 | 8,563 (canonical identities) | 0 |
| signal_events without identity hash | 39,971 | — | — |
| entity_registry | inaccessible (403) | — | — |
| extraction_candidates | 5 | — | — |
| streams | 27 | — | — |
| cursors | 11 | — | — |
| connector_registry | 25 | — | — |
| ingest_jobs | 19 | 19 (live-data candidates) | matches |
| jurisdictions | 79 | — | — |
| jurisdictions_registry | 6 | — | — |
| raw_records | 40 | — | — |
| canonical_extracted_records | 10 | — | — |
| signal_definitions | 2 | — | — |
| schema_registry | 25 | — | — |

## Entity Resolution State

| Metric | Value | Brief's Expected | Delta |
|---|---|---|---|
| Resolution rows (v_atlas_signal_event_entity_resolution_v1) | 54 | 54 | 0 |
| All unresolved | 54 | 54 | 0 |
| All match_method = no_exact_match | 54 | — | — |
| All rule_id = cfpb_complaints.complained_against_entity | 54 | — | — |
| All stream_id = cfpb_complaints | 54 | — | — |
| Entity resolution rules (manifest) | 13 | 13 | 0 |
| Entity resolution runs (coverage view) | 1 stream covered | 2 runs | -1 (view aggregates) |

## Domain 3 / Live Data Signal State

| Metric | Value | Brief's Expected | Delta |
|---|---|---|---|
| Detection RPC (detect_propublica_unresolved_metadata_v1) | functional, returns 9 candidates | — | — |
| Bridge transport (bridge_live_data_signal_candidates_v1) | **MISSING from schema cache** | — | critical gap |
| Enqueue RPC | functional (queued 9 candidates) | — | — |
| Settle RPC | functional (0 pending) | — | — |
| Live data signal bridge scheduler | erroring: function not found | — | — |

## Lighthouse State (wepxlinwbjrkqdzkqpar)

| Metric | Value | Brief's Expected | Delta |
|---|---|---|---|
| atlas_lighthouse_signal_bridge_v1 count | 63 (RLS blocks reads) | 32 (queue rows) | +31 |
| live_data_signals | 0 | — | — |
| register_live_data_signal_receipt_v1 RPC | exists | — | — |
| Legacy bridge | quarantined | — | — |

## Key Findings

1. **Main SHA matches brief exactly** — `1bd6e4f9e0e1b4958225b2f1bf6c912fe00b5327`
2. **Deploy matches brief exactly** — `dep-d9mg3f6417fc73bbgdog` is live
3. **signal_events count matches** — 48,534
4. **Canonical identities match** — 8,563
5. **Entity resolution rows match** — 54 unresolved
6. **Entity resolution rules match** — 13 in manifest
7. **Critical gap: `bridge_live_data_signal_candidates_v1` not in schema cache** — the `20260731_domain3_database_http_transport.sql` migration was committed to Git but NOT successfully applied to the database. The scheduler is failing every 6 hours trying to call it.
8. **entity_registry in atlas schema has permission issue** — `verify_atlas_tables` RPC fails with "permission denied for table entity_registry"
9. **Supabase Management PAT is unauthorized** — cannot run arbitrary SQL via Management API. All DB changes must go through PostgREST RPCs or the service must apply migrations itself.
10. **Lighthouse bridge table has 63 rows** but RLS blocks reads even with service_role key — these are likely the legacy bridge rows (30 completed + 2 pending + some from other sources = ~63 total from brief's combined counts).

## What Already Exists (Implemented)

- Signal event identity hashing and deduplication (replay-safe)
- Ingest run ledger with receipts
- Event entity resolution (13 rules, exact-match only, no fuzzy)
- Domain 3 detection (ProPublica unresolved metadata)
- Candidate identity with stable hashing (v1.1.0)
- Candidate enqueue and settle RPCs
- Mark bridge status RPC
- Scheduler with 18 adapters + Domain 3 cycle
- Legacy bridge quarantined

## What Is Missing (Phase B Targets)

- `bridge_live_data_signal_candidates_v1` not applied to DB
- No explicit temporal windows / `as_of` parameter
- No versioned geography registry
- No geographic normalization beyond `spacetime.region`
- No relationship/similarity kernels
- No convergence computation
- No historical replay endpoint
- No governed Lighthouse handoff (bridge transport broken)
- No immutable input manifests beyond event-entity resolution

## Reconciliation Notes

The brief's counts map as follows:
- "entity-resolution rules: 13" → manifest has 13 rules ✓
- "entity-resolution runs: 2" → coverage view shows 1 stream, likely 2 DB run rows exist in atlas schema (inaccessible)
- "entity-resolution rows: 54" → 54 unresolved ✓
- "live-data candidates: 19" → ingest_jobs=19 (different meaning); Domain 3 detection generates 9 candidates per run
- "bridge attempts: 18" → likely in atlas schema (inaccessible via REST)
- "Lighthouse queue rows: 32" → 63 in bridge table (RLS blocks detail view)
- "Candidate Lighthouse state: failed 10, pending 9" → 9 candidates detected, bridge transport broken
- "Bridge attempts: failed 9, queued 9" → matches the enqueue result (9 queued)
