-- Atlas historical production-ledger compatibility receipt.
-- Version: 20260806225709
-- Name: civic_genome_trait_binding_accounting_v1
-- Original statements SHA-256: 15141539b71e8e29d77ae31b97232a9eecc9c53bb1ba6245f6004600f595d5f9
-- Original rollback SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
-- Disposition: represented by the current production-derived baseline.
-- This no-op preserves exact production version/name order without claiming
-- that the incomplete overlay was a self-contained founding migration.

do $atlas_ledger_receipt$
begin
  null;
end
$atlas_ledger_receipt$;
