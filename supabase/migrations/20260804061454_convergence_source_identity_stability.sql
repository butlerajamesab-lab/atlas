-- Atlas historical production-ledger compatibility receipt.
-- Version: 20260804061454
-- Name: convergence_source_identity_stability
-- Original statements SHA-256: a19bc14b0963959c177aa5c56b4b40c14c324f917e6cb70b63b71c195f659ce7
-- Original rollback SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
-- Disposition: represented by the current production-derived baseline.
-- This no-op preserves exact production version/name order without claiming
-- that the incomplete overlay was a self-contained founding migration.

do $atlas_ledger_receipt$
begin
  null;
end
$atlas_ledger_receipt$;
