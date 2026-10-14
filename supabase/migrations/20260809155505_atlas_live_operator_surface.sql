-- Atlas historical production-ledger compatibility receipt.
-- Version: 20260809155505
-- Name: atlas_live_operator_surface
-- Original statements SHA-256: a0fc0eb93c52e0c9e0460d4718f316d10211420c7c1ed718574c0784c3b711b4
-- Original rollback SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
-- Disposition: represented by the current production-derived baseline.
-- This no-op preserves exact production version/name order without claiming
-- that the incomplete overlay was a self-contained founding migration.

do $atlas_ledger_receipt$
begin
  null;
end
$atlas_ledger_receipt$;
