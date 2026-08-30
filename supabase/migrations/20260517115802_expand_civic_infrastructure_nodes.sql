-- Atlas historical production-ledger compatibility receipt.
-- Version: 20260517115802
-- Name: expand_civic_infrastructure_nodes
-- Original statements SHA-256: 63fd0ea3bfab4dfc73c5c67fccd60a2c31178a1184a6077fb70dc83d21691d2f
-- Original rollback SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
-- Disposition: represented by the current production-derived baseline.
-- This no-op preserves exact production version/name order without claiming
-- that the incomplete overlay was a self-contained founding migration.

do $atlas_ledger_receipt$
begin
  null;
end
$atlas_ledger_receipt$;
