-- Atlas historical production-ledger compatibility receipt.
-- Version: 20260603205557
-- Name: chronicle_candidate_ingest_rpc_v1
-- Original statements SHA-256: 3355dce4ac803ec56dff7aeb49fa84927f4e97c11c11d4c217ef64b03eed250c
-- Original rollback SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
-- Disposition: represented by the current production-derived baseline.
-- This no-op preserves exact production version/name order without claiming
-- that the incomplete overlay was a self-contained founding migration.

do $atlas_ledger_receipt$
begin
  null;
end
$atlas_ledger_receipt$;
