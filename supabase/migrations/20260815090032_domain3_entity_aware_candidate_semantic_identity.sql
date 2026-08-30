-- Atlas historical production-ledger compatibility receipt.
-- Version: 20260815090032
-- Name: domain3_entity_aware_candidate_semantic_identity
-- Original statements SHA-256: 7fb7aed9e687d640c6f176e23d33999e30dcc3ce3f9ee0ba9e856f0cdb67b6cc
-- Original rollback SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
-- Disposition: represented by the current production-derived baseline.
-- This no-op preserves exact production version/name order without claiming
-- that the incomplete overlay was a self-contained founding migration.

do $atlas_ledger_receipt$
begin
  null;
end
$atlas_ledger_receipt$;
