-- Atlas historical production-ledger compatibility receipt.
-- Version: 20260804062745
-- Name: legacy_verification_chronicle_quarantine
-- Original statements SHA-256: 5041f3cb975e1a6437085585c90c120bd169890921cda3502796271b7fe2658e
-- Original rollback SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
-- Disposition: represented by the current production-derived baseline.
-- This no-op preserves exact production version/name order without claiming
-- that the incomplete overlay was a self-contained founding migration.

do $atlas_ledger_receipt$
begin
  null;
end
$atlas_ledger_receipt$;
