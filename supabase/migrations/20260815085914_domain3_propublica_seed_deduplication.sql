-- Atlas historical production-ledger compatibility receipt.
-- Version: 20260815085914
-- Name: domain3_propublica_seed_deduplication
-- Original statements SHA-256: 2cfbad73f2ebc0667fa54d184fc7c8388dba04afa955e3b27e1328113b1a5a83
-- Original rollback SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
-- Disposition: represented by the current production-derived baseline.
-- This no-op preserves exact production version/name order without claiming
-- that the incomplete overlay was a self-contained founding migration.

do $atlas_ledger_receipt$
begin
  null;
end
$atlas_ledger_receipt$;
