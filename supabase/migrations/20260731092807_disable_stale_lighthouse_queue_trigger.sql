-- Atlas historical production-ledger compatibility receipt.
-- Version: 20260731092807
-- Name: disable_stale_lighthouse_queue_trigger
-- Original statements SHA-256: 5dd44d424e12a07c0cb540cd10871c7bc258e39c2a0e2af82a4799b54315bebe
-- Original rollback SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
-- Disposition: represented by the current production-derived baseline.
-- This no-op preserves exact production version/name order without claiming
-- that the incomplete overlay was a self-contained founding migration.

do $atlas_ledger_receipt$
begin
  null;
end
$atlas_ledger_receipt$;
