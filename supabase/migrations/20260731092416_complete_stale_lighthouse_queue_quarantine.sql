-- Atlas historical production-ledger compatibility receipt.
-- Version: 20260731092416
-- Name: complete_stale_lighthouse_queue_quarantine
-- Original statements SHA-256: 4f817048f85ba30a00b6022fe68d0c5be018982c1666f9c2f7b6bfa6586f1b3b
-- Original rollback SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
-- Disposition: represented by the current production-derived baseline.
-- This no-op preserves exact production version/name order without claiming
-- that the incomplete overlay was a self-contained founding migration.

do $atlas_ledger_receipt$
begin
  null;
end
$atlas_ledger_receipt$;
