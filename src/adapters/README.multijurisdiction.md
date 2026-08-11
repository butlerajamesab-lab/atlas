# Complaint adapter verification

These adapters are intentionally source-specific at normalization time and common at governed ingestion time.

Runtime acceptance requires:

1. official public endpoint responds;
2. source records are non-zero when the source publishes current data;
3. stable external IDs survive replay;
4. observations persist to the canonical stream ID;
5. no source record is promoted directly to a civic finding;
6. population detectors operate only after observation persistence.
