-- Atlas historical production-ledger compatibility receipt.
-- Version: 20260806050236
-- Name: domain3_http_transport_activation
-- Original statements SHA-256: aa79ef7da941d50240ede9c006b7a2f59c5fe9657f2ac074b5f114c6de82accc
-- Original rollback SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
-- Disposition: represented by the current production-derived baseline.
-- This no-op preserves exact production version/name order without claiming
-- that the incomplete overlay was a self-contained founding migration.

do $atlas_ledger_receipt$
begin
  null;
end
$atlas_ledger_receipt$;
