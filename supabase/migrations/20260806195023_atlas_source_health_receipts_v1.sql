-- Atlas historical production-ledger compatibility receipt.
-- Version: 20260806195023
-- Name: atlas_source_health_receipts_v1
-- Original statements SHA-256: a90340185b2f025fe579684bf27509c008fbf4eb7d321be85cb47d61086e8b1f
-- Original rollback SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
-- Disposition: represented by the current production-derived baseline.
-- This no-op preserves exact production version/name order without claiming
-- that the incomplete overlay was a self-contained founding migration.

do $atlas_ledger_receipt$
begin
  null;
end
$atlas_ledger_receipt$;
