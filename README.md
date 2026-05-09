# Atlas Unified Streaming Engine

Atlas is implemented here as **one integrated Node.js/Express service** backed by the Atlas Supabase project `bjdjjgnkhxblnpdrjqtw`. The repository now represents both the existing Atlas database state and the new streaming engine upgrade in one deployable project. The streaming endpoints are Atlas endpoints, the adapters feed Atlas ingest directly, and the investigation functions run as Atlas services.

The implementation intentionally keeps secrets out of version control. Runtime credentials are supplied through a local `.env` file or deployment environment variables, using `.env.example` as the non-secret template.

## Project layout

| Path | Purpose |
|---|---|
| `src/server.js` | Single Atlas Express app and deployment entry point. |
| `src/routes/` | Atlas route modules for ingest, stream events/cursors, investigations, and prime-pattern queries. |
| `src/services/` | Shared Atlas service logic, including `luminari_stream_health_v1` and stream persistence helpers. |
| `src/adapters/` | Provided adapter code plus the integrated OpenStates API source wrapper that sends signals through Atlas ingest. |
| `src/lib/` | Supabase client and JSON-schema validation helpers. |
| `src/schema/` | Atlas schema inventory, current data-state export, JSON schemas, and the streaming table migration. |
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
| `prime_patterns` | 1 | Detected streaming pattern output. |
| `raw_records` | 40 | Existing Atlas raw record state. |
| `schema_registry` | 25 | Existing Atlas schema registry state. |
| `signal_definitions` | 2 | Existing Atlas signal definitions. |
| `signal_events` | 4 | Streaming event log. |
| `statutes` | 20 | Existing Atlas statute state. |
| `streams` | 4 | Registered adapter-backed streams. |

## Streaming schema

The streaming migration is in `src/schema/001_streaming_tables.sql`. It creates the five required streaming tables with RLS enabled, service-role write policies, authenticated read policies for stream tables where appropriate, updated-at triggers, and indexes for cursor/event and pattern queries.

| Table | Primary purpose |
|---|---|
| `streams` | Registry of adapter-backed streams, including jurisdiction, module, throughput profile, and safety profile. |
| `signal_events` | Append-oriented event log for normalized adapter signals with provenance and offset tracking. |
| `cursors` | Named consumer cursor state per stream. |
| `investigative_jobs` | Execution records for internal Atlas investigation functions. |
| `prime_patterns` | Queryable detected patterns emitted by investigations. |

## API surface

The unified Express app exposes the required streaming API as Atlas endpoints. These routes are mounted in `src/server.js` and implemented in `src/routes/`.

| Method | Endpoint | Implementation | Purpose |
|---|---|---|---|
| `POST` | `/v1/ingest/signals` | `src/routes/ingest.js` | Batch ingest normalized signals with provenance tracking. |
| `GET` | `/v1/streams/:stream_id/events` | `src/routes/streams.js` | Retrieve events with cursor-style offset pagination. |
| `POST` | `/v1/streams/:stream_id/cursors` | `src/routes/streams.js` | Create named stream cursors. |
| `POST` | `/internal/investigations/run` | `src/routes/investigations.js` | Trigger internal Atlas investigation jobs. |
| `GET` | `/v1/patterns/prime` | `src/routes/patterns.js` | Query detected patterns by module, jurisdiction, and time. |

## Adapters and connectors

The provided adapter source files are integrated under `src/adapters/`. The new OpenStates source wrapper, `src/adapters/openStatesApiSource.js`, demonstrates the unified ingestion path by normalizing adapter records and submitting them to `/v1/ingest/signals`.

| Adapter or connector | Location | Current integration role |
|---|---|---|
| CourtListener | `src/adapters/courtListenerAdapter.js` | Existing adapter code included for Atlas legal/court data ingestion. |
| OpenStates | `src/adapters/openStatesAdapter.js` | Existing adapter code included for legislative data ingestion. |
| OpenStates API source wrapper | `src/adapters/openStatesApiSource.js` | Integrated wrapper that feeds normalized signals directly into Atlas ingest. |
| Grants.gov | `src/adapters/grantsGovAdapter.js` | Existing adapter code included for grants data ingestion. |
| ProPublica | `src/adapters/proPublicaAdapter.js` | Existing adapter code included for civic/congressional data ingestion. |
| Socrata | `src/adapters/socrata-adapter.ts` | Existing TypeScript adapter code included for Socrata-style civic datasets. |
| Dataset connector service | `src/services/dataset-connector-service.ts` | Existing Atlas connector service included with the unified service source tree. |
| Dataset connector router | `src/routes/dataset-connector-router.ts` | Existing router included with the unified service source tree. |

## Registered streams

The `scripts/register-streams.mjs` script registers the four required streams in Atlas Supabase.

| Stream ID | Source adapter | Module hint | Jurisdiction ID | Throughput profile | Safety profile |
|---|---|---|---|---|---|
| `court_listener` | CourtListener | `legal` | `us_federal` | `burst` | `high_review` |
| `open_states` | OpenStates | `legislative` | `us_states` | `steady` | `standard_review` |
| `grants_gov` | Grants.gov | `funding` | `us_federal` | `batch` | `standard_review` |
| `pro_publica` | ProPublica | `civic` | `us_federal` | `steady` | `standard_review` |

## Investigation service

Atlas includes one manifest-pattern investigation function: `luminari_stream_health_v1`. It accepts `signal_event` inputs and emits `stream_health_alert` and `prime_pattern` outputs. The implementation lives at `src/services/streamHealthInvestigation.js`.

The function checks **stream staleness**, **signal frequency**, and **confidence-score distribution**. During the verification cycle, it emitted one `stream_health_alert` prime pattern for the `open_states` stream after ingesting test signals with mixed confidence values.

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
| `pnpm run apply:streaming-schema` | Apply `src/schema/001_streaming_tables.sql` to Atlas Supabase through the Management API. |
| `pnpm run register:streams` | Upsert the four required streams into Atlas Supabase. |
| `pnpm run test:e2e` | Run ingest → cursor → read → investigation → pattern verification against the local Atlas app. |
| `pnpm run export:atlas-state` | Regenerate Atlas schema/data-state inventory artifacts. |
| `pnpm run adapter:openstates:sample` | Send sample OpenStates signals through the unified Atlas ingest endpoint. |

## Verification results

The unified service was tested locally against Atlas Supabase, not Lighthouse. The verification artifacts are committed under `test-results/`.

| Artifact | Result |
|---|---|
| `test-results/apply-streaming-schema.json` | Atlas streaming schema application succeeded for project `bjdjjgnkhxblnpdrjqtw`. |
| `test-results/register-streams.json` | Four streams were registered: `court_listener`, `open_states`, `grants_gov`, and `pro_publica`. |
| `test-results/e2e-cycle.json` | Full cycle passed with 2 ingested signals, 2 events read back, 1 completed investigation job, and 1 queried prime pattern. |
| `test-results/openstates-sample-ingest.txt` | Integrated OpenStates sample wrapper ingested 2 sample signals through Atlas ingest. |
| `test-results/final-state-export.json` | Final Atlas state export completed with 15 public tables, 7 public functions, 17 policies, and 2 triggers. |

## Deployment model

This repository is structured as a **single Atlas deployment**. There is one root `package.json`, one Express app, one `src/` tree, one Supabase project target, and one runtime environment. The streaming engine is not a sidecar service; it is the Atlas service surface for ingesting signals, managing stream cursors, running investigations, and querying detected prime patterns.
