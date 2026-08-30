-- Atlas historical production-ledger compatibility receipt.
-- Version: 20260731191916
-- Name: signal_event_identity_and_live_data_detection
-- Original statements SHA-256: 1a15c981475f527cd45d10e7991d89a6f73fb92965e48ee79bb35747cc2044d3
-- Original rollback SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
-- Disposition: represented by the current production-derived baseline.
-- This no-op preserves exact production version/name order without claiming
-- that the incomplete overlay was a self-contained founding migration.

do $atlas_ledger_receipt$
begin
  null;
end
$atlas_ledger_receipt$;
