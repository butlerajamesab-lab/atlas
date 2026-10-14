-- Atlas historical production-ledger compatibility receipt.
-- Version: 20260809170900
-- Name: atlas_signal_ontology_read_model
-- Original statements SHA-256: 57f224852e14936c323d00d9e485cb4b8131ba8651bb92ae8ad6133d20a86084
-- Original rollback SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
-- Disposition: represented by the current production-derived baseline.
-- This no-op preserves exact production version/name order without claiming
-- that the incomplete overlay was a self-contained founding migration.

do $atlas_ledger_receipt$
begin
  null;
end
$atlas_ledger_receipt$;
