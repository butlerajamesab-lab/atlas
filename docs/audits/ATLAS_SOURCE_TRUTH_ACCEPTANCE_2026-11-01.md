# Atlas source-truth acceptance checkpoint — 2026-11-01 PT / 2026-11-02 UTC

**Audit state:** production reads only. Draft PR #87, base deployed Atlas SHA `d1970f2e66b7e7b740ea84293f1a4a6f7f645d34`. This file documents a snapshot, not source certification or approval to deploy.

## Canonical boundaries (verified in live database and source)

1. External API adapters normalize provider records and POST to Atlas `/v1/ingest/signals`.
2. Atlas `public.streams` is the canonical stream registration; 29 registered streams, 22 scheduled adapter entries in `src/services/scheduler.js` (not all 29 runnable).
3. `public.signal_events` contains observation rows, **not verified civic facts**. `atlas.signal_event_ingest_run` and `atlas.signal_event_identity` contain ingestion and replay receipts.
4. `atlas.live_data_signal_candidate` contains rule-derived candidates. `verification_state='verified'` is a candidate/rule-level classification, **not independent provider-record authenticity certification**.
5. Lighthouse `public.atlas_stream_runtime_projection_v1` mirrors stream health/counts. It is not a mirror of original source bytes or a legal-knowledge import. `public.knowledge_entries` is a separate historical Knowledge Backbone collection.
6. Civic Genome/Rosetta publication remains quarantined. Do not repopulate zero outputs merely to satisfy coverage indicators.

## Exact production snapshot (read-only, Nov 1 PT)

Atlas: 725,947 observation rows; 3,921 derived candidate rows; 119 candidates marked current; 9 current candidates marked verified (ProPublica-specific rule). Lighthouse: 29 stream runtime projection rows, 2,416 `knowledge_entries`. These populations are distinct.

| Source | Atlas stream | Observation count | Source meaning / caveat |
|---|---|---:|---|
| CourtListener | `court_listener` | 40 | opinions; v3 adapter fetches one 20-row page per run; complete pagination unproven |
| OpenStates | `open_states` | 104 | bill/actions; one-page default, completeness unproven |
| ProPublica | `pro_publica` | 54,998 | nonprofit search organizations and IRS-derived 990 filing data; **not direct IRS API** |
| CFPB | `cfpb_complaints` | 8,702 | consumer complaints |
| WA AG | `wa_ag_consumer_complaints` | 26,718 | data.wa.gov complaints |
| Oregon DOJ | `or_doj_consumer_complaints` | 4,977 | data.oregon.gov complaints |
| NYC 311 | `nyc_311_service_requests` | 400,002 | municipal service request observations |
| Chicago 311 | `chicago_311_service_requests` | 216,162 | municipal service request observations |
| Regulations.gov | `regulations_gov` | 906 | rulemaking document references |
| Grants.gov | `grants_gov` | 4,086 | grant opportunity search summaries |
| DOL/OSHA | `osha_inspections` | 100 | DOL Open Data API v4 OSHA inspections |
| EPA | `epa_echo` | 100 | DMAP-EF ICIS-NPDES facility-level aggregates, not an original enforcement case-file archive |
| Census ACS | `census_acs` | 91 | county demographic aggregates |
| USDA SNAP | `usda_snap` | 1 | historical placeholder/observation; current source pull failure |
| HUD FMR | `hud_housing` | 54 | county fair market rents |
| BLS | `bls_employment` | 77 | labor statistics series |
| FEC | `fec_campaign_finance` | 200 | committee and Schedule B disbursement observations; latest HTTP 504 |
| SEC EDGAR | `sec_edgar` | 6,655 | securities filing references |
| USAspending | `usa_spending` | 50 | historical observations; latest HTTP 400 |
| IRS-labeled | `irs_exempt_orgs` | 109 | presently reads ProPublica 501(c)(4), not direct IRS |
| OpenSecrets-labeled | `open_secrets` | 1,515 | Senate LDA API, not paid OpenSecrets |
| FARA | `fara_foreign_agents` | 232 | foreign agent registrations |

Seven more registered streams lack scheduled adapters. In particular `dol_whd_violations` has no execution binding. A zero in such a stream is not evidence of a failed provider pull.

## Source-identity defect established

ProPublica `nonprofit_registry_record`: 18,925 rows, only 31 distinct payload contents after removing `provenance_tracking`; none of the stored search-hit `raw` records have `updated`, `ruling_date`, or `created_at`. 18,900 source timestamps are within two minutes of ingestion, consistent with the former `toIsoTimestamp` fallback to `new Date()`. An event-identity hash includes source timestamp, so the fallback can manufacture distinct event identities for unchanged source content. This is proven code behavior; individual historical record authenticity still requires source comparison. **Do not rewrite or delete these rows without explicit approval.**

ProPublica filing rows: 36,048 historical `nonprofit_990_filing` rows; all inspected raw filing payloads use `tax_prd` and `updated`, while the earlier adapter read `tax_period`. PR #87 uses `tax_prd`, requires an actual source update timestamp, and holds undated organization search hits. It does not invent a new source-date for them. Page zero of ProPublica search is not a full-corpus scan; incomplete page coverage is surfaced in partial run receipts.

Grants.gov is a separate legacy replay case: 4,086 rows, 4,042 without event identity hashes (historical), and 44 with distinct hashes. Do not conflate this with the ProPublica identity bug. The current ingestion RPC deduplicates against `atlas.signal_event_identity`.

## PR #87 proposed corrections (not deployed)

- Fail-closed HUD missing credential and unexpected shape; fail-closed Regulations.gov, Senate LDA, FARA, and SEC complete HTTP fallback failures.
- Preserve all linked facilities for EPA CWA enforcement and inspection activity aggregates.
- Reject partial/failed transport results in scheduler and manual runner; include 22 entries in runner parity.
- Reject invented/invalid source timestamps in normalizers and central ingress.
- ProPublica: source-dated filing observation with EIN+tax_prd identity; undated search records held (without timestamps); malformed search/detail JSON fails; multipage search marked incomplete. Source holds and page truncation remain visible in the adapter failure receipt.
- Tests: `test/atlasAdapterAcceptanceContract.test.js` and `test/epaDmapAdapterContract.test.js`; verified by GitHub CI **only when the current exact head passes**.

## Acceptance gates still OPEN

1. **Original source comparison**: verify real provider response bytes against stored payloads, source IDs, field transforms, and precise source dates; fixture tests are necessary but insufficient.
2. **CourtListener & OpenStates paging**: their current code fetches the first page. Need separately bounded/pinned cursor or pagination contract; do not claim source-wide coverage or run additional paid pulls blindly.
3. **ProPublica search completeness**: current runner reads page zero only. The new partial receipt makes that explicit; durable source hold/write isolation needs independent review.
4. **Source-specific failures**: Chicago 311 page-4 timeout; WA AG and OR DOJ 60-second Atlas ingest timeouts; FEC 504; USAspending 400; USDA SNAP error.
5. **Lighthouse consumption**: prove each read-model contract with source-bound examples; runtime stream counts alone never certify Knowledge Backbone, case, legal, or citizen-facing answers.
6. **Historical identity quality**: classify old ProPublica and Grants rows without deletes, migration, publication, or source-truth assertions.
7. Review all substantive PR comments (including closed/merged #84 and #86) and exact-head CI. Keep #87 draft until independently accepted; do not merge, deploy, change Supabase or reopen Rosetta/Civic Genome publication on CI alone.

## Reproduction without provider requests

Read-only SQL to inspect observations:
```sql
select stream_id, count(*) as observations,
 count(*) filter(where event_identity_hash is null) as historical_without_identity,
 count(distinct event_identity_hash) as hashed_identities
from public.signal_events group by stream_id order by stream_id;
```

For the identity defect:
```sql
select signal_type, count(*) as rows,
 count(distinct payload - 'provenance_tracking') as unique_source_payloads,
 count(*) filter(where payload->'raw' ? 'updated') as source_updated_present
from public.signal_events
where stream_id='pro_publica'
group by signal_type;
```

**Execution prohibitions:** no provider API pulls, no `run-all-adapters` without `--dry-run`, no production SQL writes, no migrations, no deployments, no merges, no knowledge publication.
