-- Atlas historical production-ledger compatibility receipt.
-- Version: 20260811161803
-- Name: signal_ontology_currentness_read_model
-- Original statements SHA-256: bd423d81d99a411d891feafab161df5630b3cd6e12bacf3b9ca97af35c502fc5
-- Original rollback SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
-- Disposition: represented by the current production-derived baseline.
-- This no-op preserves exact production version/name order without claiming
-- that the incomplete overlay was a self-contained founding migration.

do $atlas_ledger_receipt$
begin
  null;
end
$atlas_ledger_receipt$;
