-- Atlas historical production-ledger compatibility receipt.
-- Version: 20260602092945
-- Name: create_signal_intelligence_cards_view_v2
-- Original statements SHA-256: d1960348c5c5ad841430aa44f1f73d71a37aba844a60e45c8c23b19c6ad71364
-- Original rollback SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
-- Disposition: represented by the current production-derived baseline.
-- This no-op preserves exact production version/name order without claiming
-- that the incomplete overlay was a self-contained founding migration.

do $atlas_ledger_receipt$
begin
  null;
end
$atlas_ledger_receipt$;
