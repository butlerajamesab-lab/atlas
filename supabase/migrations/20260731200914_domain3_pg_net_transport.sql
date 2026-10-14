-- Atlas historical production-ledger compatibility receipt.
-- Version: 20260731200914
-- Name: domain3_pg_net_transport
-- Original statements SHA-256: 3ae4c33ba160bc6ec3c073130a061d3a7ff5d5930a5c7a13c4c974b67b85e218
-- Original rollback SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
-- Disposition: represented by the current production-derived baseline.
-- This no-op preserves exact production version/name order without claiming
-- that the incomplete overlay was a self-contained founding migration.

do $atlas_ledger_receipt$
begin
  null;
end
$atlas_ledger_receipt$;
