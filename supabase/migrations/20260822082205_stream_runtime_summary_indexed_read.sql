-- Atlas historical production-ledger compatibility receipt.
-- Version: 20260822082205
-- Name: stream_runtime_summary_indexed_read
-- Original statements SHA-256: bf70abd5a6f0f41b230e9bd12ad4fec2c18c67fbfdf40a0364932e81a5d3cf69
-- Original rollback SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
-- Disposition: represented by the current production-derived baseline.
-- This no-op preserves exact production version/name order without claiming
-- that the incomplete overlay was a self-contained founding migration.

do $atlas_ledger_receipt$
begin
  null;
end
$atlas_ledger_receipt$;
