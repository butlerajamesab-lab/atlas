-- Atlas historical production-ledger compatibility receipt.
-- Version: 20260731194318
-- Name: domain3_candidate_identity_receipt
-- Original statements SHA-256: 0f9af0f8656021fea2177cf972d56487474b48a93a112e88e464368f08c7896b
-- Original rollback SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
-- Disposition: represented by the current production-derived baseline.
-- This no-op preserves exact production version/name order without claiming
-- that the incomplete overlay was a self-contained founding migration.

do $atlas_ledger_receipt$
begin
  null;
end
$atlas_ledger_receipt$;
