-- Atlas historical production-ledger compatibility receipt.
-- Version: 20260517115833
-- Name: create_unified_civic_infrastructure_view_v2
-- Original statements SHA-256: a1137ae38d018cf50a954dd6211d781f312b5c4bc1fcf8b12f8b3369883e0840
-- Original rollback SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
-- Disposition: represented by the current production-derived baseline.
-- This no-op preserves exact production version/name order without claiming
-- that the incomplete overlay was a self-contained founding migration.

do $atlas_ledger_receipt$
begin
  null;
end
$atlas_ledger_receipt$;
