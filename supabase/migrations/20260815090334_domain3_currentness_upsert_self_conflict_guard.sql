-- Atlas historical production-ledger compatibility receipt.
-- Version: 20260815090334
-- Name: domain3_currentness_upsert_self_conflict_guard
-- Original statements SHA-256: 58f318ab0d05331b770eea321e209e404764c3ce5e6a065356622b0745dd8e2a
-- Original rollback SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
-- Disposition: represented by the current production-derived baseline.
-- This no-op preserves exact production version/name order without claiming
-- that the incomplete overlay was a self-contained founding migration.

do $atlas_ledger_receipt$
begin
  null;
end
$atlas_ledger_receipt$;
