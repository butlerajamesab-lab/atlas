# Atlas Unified Streaming Engine

Atlas is implemented here as **one integrated Node.js/Express service** backed by the Atlas Supabase project `bjdjjgnkhxblnpdrjqtw`. The repository represents both the existing Atlas database state and the streaming-engine upgrade in one deployable project. Adapters preserve normalized source observations; separate, declared engines derive civic signals and convergence receipts. See `docs/ATLAS_SIGNAL_ONTOLOGY_CONTRACT.md`.

The implementation intentionally keeps secrets out of version control. Runtime credentials are supplied through a local `.env` file or deployment environment variables, using `.env.example` as the non-secret template.

## Project layout

| Path | Purpose |
|---|---|
| `src/server.js` | Single Atlas Express app and deployment entry point. |
| `src/routes/` | Atlas route modules for ingest, stream events/cursors, investigations, and prime-pattern queries. |
| `src/services/` | Shared Atlas service logic, including `luminari_stream_health_v1` and stream persistence helpers. |
| `src/adapters/` | Source adapters that submit normalized observations through the legacy-named ingest contract. |
| `src/lib/` | Supabase client and JSON-schema validation helpers. |
| `src/schema/` | Atlas schema inventory, current data-state export, JSON schemas, the streaming table migration, and the Lighthouse bridge RPC migration. |
| `scripts/` | Operational scripts for schema application, state export, stream registration, and e2e verification. |
| `test-results/` | Captured verification artifacts from the Atlas integration run. |

## Atlas Supabase state

The current Atlas Supabase inventory was captured after applying the streaming upgrade and running the verification cycle. The generated inventory lives at `src/schema/atlas_state_inventory.md`, with machine-readable metadata in `src/schema/atlas_schema_metadata.json` and row counts in `src/schema/atlas_data_state.json`.

| Inventory category | Current count |
|---|---:|
| Public tables | 15 |
| Public functions | 7 |
| RLS policies | 17 |
| Public triggers | 2 |
| Row-count entries | 15 |

The public tables currently include the pre-existing Atlas data structures and the streaming upgrade tables. The streaming tables are `streams`, `signal_events`, `cursors`, `investigative_jobs`, and `prime_patterns`. The full generated table inventory is committed in `src/schema/atlas_state_inventory.md`.

| Table | Rows at verification time | Role in Atlas |
|---|---:|---|
| `agency_metrics` | 533 | Existing Atlas civic/agency metrics state. |
| `case_law` | 20 | Existing Atlas legal corpus state. |
| `civic_map_resources` | 578 | Existing Atlas civic-map resource state. |
| `connector_registry` | 25 | Existing Atlas connector registry state. |
| `cursors` | 1 | Streaming cursor state for consumers. |
| `ingest_jobs` | 19 | Existing Atlas ingest job state. |
| `investigative_jobs` | 1 | Streaming investigation execution state. |
| `jurisdictions` | 79 | Existing Atlas jurisdiction catalog. |
| `prime_patterns` | 1 | Legacy investigation output; stream-health alerts are operational diagnostics. |
| `raw_records` | 40 | Existing Atlas raw record state. |
| `schema_registry` | 25 | Existing Atlas schema registry state. |
| `signal_definitions` | 2 | Existing Atlas signal definitions. |
| `signal_events` | 4 | Compatibility-named normalized observation event log. |
| `statutes` | 20 | Existing Atlas statute state. |
| `streams` | 4 | Registered adapter-backed streams. |

## Streaming schema

The streaming migration is in `src/schema/001_streaming_tables.sql`. It creates the five required streaming tables with RLS enabled, service-role write policies, authenticated read policies for stream tables where appropriate, updated-at triggers, and indexes for cursor/event and pattern queries. The deterministic Lighthouse bridge wrapper is in `src/schema/002_lighthouse_bridge_rpc.sql`; it exposes `public.trigger_lighthouse_bridge_for_prime_pattern_v1(...)` as a security-definer RPC so the Atlas service can enqueue verified patterns into the non-exposed `atlas` schema without exposing that schema through PostgREST.

| Table | Primary purpose |
|---|---|
| `streams` | Registry of adapter-backed streams, including jurisdiction, module, throughput profile, and safety profile. |
| `signal_events` | Append-oriented compatibility store for normalized source observations with provenance and offset tracking. A row is not automatically a civic signal. |
| `cursors` | Named consumer cursor state per stream. |
| `investigative_jobs` | Execution records for internal Atlas investigation functions. |
| `prime_patterns` | Queryable legacy investigation outputs; operational health alerts remain distinct from civic convergence. |

## API surface

The unified Express app exposes the required streaming API as Atlas endpoints. These routes are mounted in `src/server.js` and implemented in `src/routes/`.

| Method | Endpoint | Implementation | Purpose |
|---|---|---|---|
| `POST` | `/v1/ingest/signals` | `src/routes/ingest.js` | Compatibility route that persists normalized source observations with provenance tracking. |
| `GET` | `/v1/streams/:stream_id/events` | `src/routes/streams.js` | Retrieve events with cursor-style offset pagination. |
| `POST` | `/v1/streams/:stream_id/cursors` | `src/routes/streams.js` | Create named stream cursors. |
| `POST` | `/internal/investigations/run` | `src/routes/investigations.js` | Trigger internal Atlas investigation jobs. |
| `GET` | `/v1/patterns/prime` | `src/routes/patterns.js` | Query detected patterns by module, jurisdiction, and time. |

## Adapters and connectors

The provided adapter source files are integrated under `src/adapters/`. JavaScript external-source adapters use the shared `src/adapters/ingestClient.js` helper and submit normalized official records to the compatibility route `POST /v1/ingest/signals` rather than writing directly to raw tables. Each record becomes a normalized observation in the legacy-named `signal_events` store with agency provenance, jurisdiction-derived spacetime, and a source URL. Signal derivation occurs later under a declared rule; ingestion alone does not create a civic signal.

| Adapter or connector | Location | Current integration role |
|---|---|---|
| CourtListener | `src/adapters/courtListenerAdapter.js` | Emits `court_opinion` source observations through unified ingest. |
| OpenStates | `src/adapters/openStatesAdapter.js` | Emits `legislative_activity` source observations through unified ingest. |
| OpenStates API source wrapper | `src/adapters/openStatesApiSource.js` | Emits normalized OpenStates API records through unified ingest with official-record provenance. |
| Grants.gov | `src/adapters/grantsGovAdapter.js` | Emits `grant_opportunity` source observations through unified ingest. |
| ProPublica | `src/adapters/proPublicaAdapter.js` | Emits `congressional_activity` source observations through unified ingest. |
| Official agency records | `src/adapters/officialAgencyRecordsAdapter.js` | Emits CFPB, EEOC, DOL-WHD, and OSHA records as official-government observation streams in the legacy `signal_event` transport contract, with `provenance.confidence = 1.0`. |
| Socrata | `src/adapters/socrata-adapter.ts` | Existing TypeScript adapter code included for Socrata-style civic datasets. |
| Dataset connector service | `src/services/dataset-connector-service.ts` | Existing Atlas connector service included with the unified service source tree. |
| Dataset connector router | `src/routes/dataset-connector-router.ts` | Existing router included with the unified service source tree. |

## Registered streams

The `scripts/register-streams.mjs` script registers the adapter-backed streams in Atlas Supabase, including the official complaint, filing, violation, and incident streams used for systemic-pattern detection.

| Stream ID | Source adapter | Module hint | Jurisdiction ID | Throughput profile | Safety profile |
|---|---|---|---|---|---|
| `court_listener` | CourtListener | `legal` | `us_federal` | `burst` | `high_review` |
| `open_states` | OpenStates | `legislative` | `us_states` | `steady` | `standard_review` |
| `grants_gov` | Grants.gov | `funding` | `us_federal` | `batch` | `standard_review` |
| `pro_publica` | ProPublica | `civic` | `us_federal` | `steady` | `standard_review` |
| `cfpb_complaints` | CFPB | `consumer_finance` | `us_federal` | `steady` | `standard_review` |
| `eeoc_filings` | EEOC | `civil_rights` | `us_federal` | `steady` | `high_review` |
| `dol_whd_violations` | DOL-WHD | `labor` | `us_federal` | `steady` | `high_review` |
| `osha_incidents` | OSHA | `workplace_safety` | `us_federal` | `burst` | `high_review` |

## Investigation service

Atlas includes one legacy stream-health investigation function: `luminari_stream_health_v1`. It accepts compatibility `signal_event` observation inputs and emits operational `stream_health_alert` outputs into `prime_patterns`. The implementation lives at `src/services/streamHealthInvestigation.js`; these outputs are not civic convergence conclusions.

The function checks **stream staleness**, **observation frequency**, and **confidence-score distribution**. During the verification cycle, it emitted one `stream_health_alert` diagnostic for the `open_states` stream after ingesting test observations with mixed confidence values. When investigations emit legacy `prime_patterns` rows, `src/routes/investigations.js` now immediately calls `src/services/bridgeHook.js`. The hook deterministically gates on confidence, records provenance flags that no AI extraction, fuzzy matching, or synthetic signals were used, and then calls the public bridge RPC to enqueue verified diagnostics for Lighthouse.

## Local setup

Install dependencies from the repository root.

```bash
pnpm install
```

Create a local `.env` file from `.env.example` and provide Atlas Supabase credentials through the environment. The project ref is `bjdjjgnkhxblnpdrjqtw`.

```bash
cp .env.example .env
# edit .env with Atlas Supabase URL and service role key
```

Run the single unified Atlas Express app.

```bash
pnpm start
```

The local health endpoint returns the Atlas service identity and Supabase project ref.

```bash
curl http://localhost:8787/health
```

## Operational scripts

| Command | Purpose |
|---|---|
| `pnpm run schema:apply` | Apply `src/schema/001_streaming_tables.sql` to Atlas Supabase through the Management API. |
| `pnpm run schema:apply:bridge` | Apply the public security-definer Lighthouse bridge RPC required by the deterministic bridge hook. |
| `pnpm run seed:streams` | Upsert the adapter and official-agency streams into Atlas Supabase. |
| `pnpm run test:cycle` | Run ingest → cursor → read → investigation → pattern verification against the local Atlas app. |
| `pnpm run schema:export` | Regenerate Atlas schema/data-state inventory artifacts. |
| `pnpm run adapter:openstates:sample` | Send sample OpenStates signals through the unified Atlas ingest endpoint. |

## Verification results

The unified service was tested locally against Atlas Supabase. The ingest → cursor → read → investigation regression passes with the updated bridge hook in place. Direct Lighthouse bridge execution requires `src/schema/002_lighthouse_bridge_rpc.sql` to be applied to the Supabase project because the `atlas` schema is intentionally not exposed through REST; without that migration, Supabase correctly rejects direct `atlas` schema access. The verification artifacts are committed under `test-results/`.

| Artifact | Result |
|---|---|
| `test-results/apply-streaming-schema.json` | Atlas streaming schema application succeeded for project `bjdjjgnkhxblnpdrjqtw`. |
| `test-results/register-streams.json` | Adapter and official-agency streams were registered: `court_listener`, `open_states`, `grants_gov`, `pro_publica`, `cfpb_complaints`, `eeoc_filings`, `dol_whd_violations`, and `osha_incidents`. |
| `test-results/e2e-cycle.json` | Full cycle passed after the bridge hook update with 2 newly ingested signals, 20 events read back, 1 completed investigation job, and 1 queried prime pattern. |
| `scripts/test-official-bridge-cycle.mjs` | Focused official-record bridge verification script for CFPB/EEOC-style records after the bridge RPC migration is applied. |
| `test-results/openstates-sample-ingest.txt` | Integrated OpenStates sample wrapper ingested 2 sample signals through Atlas ingest. |
| `test-results/final-state-export.json` | Final Atlas state export completed with 15 public tables, 7 public functions, 17 policies, and 2 triggers. |

## Deployment model

This repository is structured as a **single Atlas deployment**. There is one root `package.json`, one Express app, one `src/` tree, one Supabase project target, and one runtime environment. The streaming engine is not a sidecar service; it is the Atlas service surface for ingesting source observations, managing stream cursors, deriving governed signal candidates, running investigations, and querying canonical signals, convergence outputs, and legacy health diagnostics.
