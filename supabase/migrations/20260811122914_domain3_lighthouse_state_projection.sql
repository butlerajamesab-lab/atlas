-- Atlas historical production-ledger compatibility receipt.
-- Version: 20260811122914
-- Name: domain3_lighthouse_state_projection
-- Original statements SHA-256: 58636d83f48e7a0caf323751a0a10619e4ac74bc4f8ffb0b017a21cdf9fa2c61
-- Original rollback SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
-- Disposition: represented by the current production-derived baseline.
-- This no-op preserves exact production version/name order without claiming
-- that the incomplete overlay was a self-contained founding migration.

do $atlas_ledger_receipt$
begin
  null;
end
$atlas_ledger_receipt$;
