-- Atlas historical production-ledger compatibility receipt.
-- Version: 20260806054334
-- Name: domain3_direct_lighthouse_receipt_endpoint
-- Original statements SHA-256: 6974b2e164861fa6c34fee772df0ab72bd851fae6e01768cd354e1ecd6114aeb
-- Original rollback SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
-- Disposition: represented by the current production-derived baseline.
-- This no-op preserves exact production version/name order without claiming
-- that the incomplete overlay was a self-contained founding migration.

do $atlas_ledger_receipt$
begin
  null;
end
$atlas_ledger_receipt$;
