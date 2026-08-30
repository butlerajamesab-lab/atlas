-- Atlas historical production-ledger compatibility receipt.
-- Version: 20260822075306
-- Name: domain3_integrity_projection_identity
-- Original statements SHA-256: ae5a13e72379967dd78b3c38359cb4dec6417a2380b043b1da224cb8a526bbf8
-- Original rollback SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
-- Disposition: represented by the current production-derived baseline.
-- This no-op preserves exact production version/name order without claiming
-- that the incomplete overlay was a self-contained founding migration.

do $atlas_ledger_receipt$
begin
  null;
end
$atlas_ledger_receipt$;
