-- Atlas historical production-ledger compatibility receipt.
-- Version: 20260801235025
-- Name: atlas_convergence_v21_persistence_timeout
-- Original statements SHA-256: 85e3740b2582325178f463d49bede89e2f757cf929f3f675cd8138a8949e3121
-- Original rollback SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
-- Disposition: represented by the current production-derived baseline.
-- This no-op preserves exact production version/name order without claiming
-- that the incomplete overlay was a self-contained founding migration.

do $atlas_ledger_receipt$
begin
  null;
end
$atlas_ledger_receipt$;
