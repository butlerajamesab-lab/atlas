-- Atlas historical production-ledger compatibility receipt.
-- Version: 20260812084344
-- Name: domain3_semantic_currentness_review_fixes
-- Original statements SHA-256: 7c2272dd8fb3b5ce199482e887ed347489e046c46a799d599dbf646e65d971b0
-- Original rollback SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
-- Disposition: represented by the current production-derived baseline.
-- This no-op preserves exact production version/name order without claiming
-- that the incomplete overlay was a self-contained founding migration.

do $atlas_ledger_receipt$
begin
  null;
end
$atlas_ledger_receipt$;
