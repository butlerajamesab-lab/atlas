-- Atlas historical production-ledger compatibility receipt.
-- Version: 20260517115822
-- Name: add_created_at_to_civic_nodes
-- Original statements SHA-256: 3a8ab5eea9a73ac74c94f7851b3394020fb156c3ee7ab227e67656da869a0a5b
-- Original rollback SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
-- Disposition: represented by the current production-derived baseline.
-- This no-op preserves exact production version/name order without claiming
-- that the incomplete overlay was a self-contained founding migration.

do $atlas_ledger_receipt$
begin
  null;
end
$atlas_ledger_receipt$;
