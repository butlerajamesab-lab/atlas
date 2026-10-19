-- Atlas historical production-ledger compatibility receipt.
-- Version: 20260811121639
-- Name: domain3_population_persistence_rpc
-- Original statements SHA-256: 389b4e5c9816c474c0f42135378ad17ee000aabf8d82a06939cd6ad76b788eaa
-- Original rollback SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
-- Disposition: represented by the current production-derived baseline.
-- This no-op preserves exact production version/name order without claiming
-- that the incomplete overlay was a self-contained founding migration.

do $atlas_ledger_receipt$
begin
  null;
end
$atlas_ledger_receipt$;
