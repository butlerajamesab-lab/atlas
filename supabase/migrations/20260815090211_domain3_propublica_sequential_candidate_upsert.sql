-- Atlas historical production-ledger compatibility receipt.
-- Version: 20260815090211
-- Name: domain3_propublica_sequential_candidate_upsert
-- Original statements SHA-256: b87dd4813cb27cca0a39d57f745d49d53c3c36be1a66c6252f1a09bb9aef6733
-- Original rollback SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
-- Disposition: represented by the current production-derived baseline.
-- This no-op preserves exact production version/name order without claiming
-- that the incomplete overlay was a self-contained founding migration.

do $atlas_ledger_receipt$
begin
  null;
end
$atlas_ledger_receipt$;
