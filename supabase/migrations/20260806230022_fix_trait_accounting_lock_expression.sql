-- Atlas historical production-ledger compatibility receipt.
-- Version: 20260806230022
-- Name: fix_trait_accounting_lock_expression
-- Original statements SHA-256: 1819db2363706f3610fb9afb86d12c9dd57451f86c42d6ffb18fae13ad91ad08
-- Original rollback SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
-- Disposition: represented by the current production-derived baseline.
-- This no-op preserves exact production version/name order without claiming
-- that the incomplete overlay was a self-contained founding migration.

do $atlas_ledger_receipt$
begin
  null;
end
$atlas_ledger_receipt$;
