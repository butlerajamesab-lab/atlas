-- Atlas historical production-ledger compatibility receipt.
-- Version: 20260806204135
-- Name: civic_genome_external_snapshot_intake_v1
-- Original statements SHA-256: 36f4e7c937a4fae2a9d1150ebd03f1e7a7f9aa0c1df6070ed4f7888b6a7261a9
-- Original rollback SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
-- Disposition: represented by the current production-derived baseline.
-- This no-op preserves exact production version/name order without claiming
-- that the incomplete overlay was a self-contained founding migration.

do $atlas_ledger_receipt$
begin
  null;
end
$atlas_ledger_receipt$;
