-- Atlas historical production-ledger compatibility receipt.
-- Version: 20260801233925
-- Name: atlas_convergence_v21_atomic_persistence
-- Original statements SHA-256: ca5d7f232724778a91d866f7572f57cfc44f24fc810c206d6b56a7ce654094c6
-- Original rollback SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
-- Disposition: represented by the current production-derived baseline.
-- This no-op preserves exact production version/name order without claiming
-- that the incomplete overlay was a self-contained founding migration.

do $atlas_ledger_receipt$
begin
  null;
end
$atlas_ledger_receipt$;
