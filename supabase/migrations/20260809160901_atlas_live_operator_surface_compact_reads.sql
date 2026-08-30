-- Atlas historical production-ledger compatibility receipt.
-- Version: 20260809160901
-- Name: atlas_live_operator_surface_compact_reads
-- Original statements SHA-256: d8294b1e635af7c5e619017c2e678807b2ff2ff750145ebf1e60fcc33f4d557d
-- Original rollback SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
-- Disposition: represented by the current production-derived baseline.
-- This no-op preserves exact production version/name order without claiming
-- that the incomplete overlay was a self-contained founding migration.

do $atlas_ledger_receipt$
begin
  null;
end
$atlas_ledger_receipt$;
