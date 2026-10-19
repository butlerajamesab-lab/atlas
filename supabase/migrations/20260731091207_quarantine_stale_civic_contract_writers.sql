-- Atlas historical production-ledger compatibility receipt.
-- Version: 20260731091207
-- Name: quarantine_stale_civic_contract_writers
-- Original statements SHA-256: 3f08957a7ace2f42695a1245ab1a3fe30f115e73fa285bc2ea742712c615ef41
-- Original rollback SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
-- Disposition: represented by the current production-derived baseline.
-- This no-op preserves exact production version/name order without claiming
-- that the incomplete overlay was a self-contained founding migration.

do $atlas_ledger_receipt$
begin
  null;
end
$atlas_ledger_receipt$;
