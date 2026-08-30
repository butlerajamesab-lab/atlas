-- Atlas historical production-ledger compatibility receipt.
-- Version: 20260804060700
-- Name: convergence_replay_snapshot_contract
-- Original statements SHA-256: c1920694a47efbc79e4811f7c26fde230da765296b3e100f0796790aec9cd75a
-- Original rollback SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
-- Disposition: represented by the current production-derived baseline.
-- This no-op preserves exact production version/name order without claiming
-- that the incomplete overlay was a self-contained founding migration.

do $atlas_ledger_receipt$
begin
  null;
end
$atlas_ledger_receipt$;
