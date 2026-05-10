# Form Signal Extraction Engine V3

Deterministic civic/procedural form-signal extraction module for Atlas.

## Scope

- Extract form/action/procedural signals from text
- Preserve ambiguity through candidate arrays (no early collapse)
- Produce staging-ready records for downstream registry/enrichment
- Attach provenance, parser metadata, source hashes, validation flags

## Architecture Rule

- **Atlas owns extraction.** This engine lives in Atlas.
- **Lighthouse is read-only.** Engine reads from Lighthouse tables but never writes to them.
- **All output goes to Atlas staging tables.** Nothing is auto-promoted.
- **Lighthouse displays after bridge/review.** Results flow to Lighthouse only after human or automated review.

## Lighthouse Read Sources (read-only)

| Table | Purpose |
|-------|---------|
| `legal_statutes` | Statute text for signal extraction |
| `agencies_registry` | Agency matching and resolution |
| `forms_registry` | Existing forms (avoid duplicates) |
| `filing_templates` | Filing text for signal extraction |
| `workflow_steps` | Workflow text for signal extraction |
| `remedy_templates` | Remedy text for signal extraction |

## Atlas Write Targets (staging)

| Table | Status |
|-------|--------|
| `forms_registry_staging` | `review_required=true, source_verified=false` |
| `extraction_provenance` | Full extraction audit trail |
| `validation_review_queue` | Items needing human review |

## Usage

```bash
# Run the engine against sample text (CLI test)
node index.js

# Run backfill against Lighthouse data
LIGHTHOUSE_ANON_KEY=xxx ATLAS_SERVICE_KEY=xxx node backfill-lighthouse.js
```

## Output Contract

All staged records have:
- `review_required: true`
- `source_verified: false`
- `promoted: false`

Nothing overwrites existing `forms_registry` rows.
