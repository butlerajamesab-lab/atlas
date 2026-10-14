-- Atlas historical production-ledger compatibility receipt.
-- Version: 20260729150556
-- Name: lighthouse_stream_export_contract
-- Original statements SHA-256: fd5db2b7c9c3ae8c4db84e75e406dffd10a0bc80c412ece8066f1e71f2038d0a
-- Original rollback SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
-- Disposition: represented by the current production-derived baseline.
-- This no-op preserves exact production version/name order without claiming
-- that the incomplete overlay was a self-contained founding migration.

do $atlas_ledger_receipt$
begin
  null;
end
$atlas_ledger_receipt$;
