-- Atlas historical production-ledger compatibility receipt.
-- Version: 20260811161224
-- Name: domain3_candidate_semantic_currentness
-- Original statements SHA-256: 1c53d2fec30c75d14e7c2857932aa8b539bab7b40a130ebd398a50837d6154a8
-- Original rollback SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
-- Disposition: represented by the current production-derived baseline.
-- This no-op preserves exact production version/name order without claiming
-- that the incomplete overlay was a self-contained founding migration.

do $atlas_ledger_receipt$
begin
  null;
end
$atlas_ledger_receipt$;
