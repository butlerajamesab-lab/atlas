-- Atlas historical production-ledger compatibility receipt.
-- Version: 20260730195601
-- Name: 20260730_event_entity_resolution_usaspending_extraction_fix
-- Original statements SHA-256: b084572002b658571b3ff94bc7ca8be1bd9c5536877eac9707e9f3e3adc66811
-- Original rollback SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
-- Disposition: represented by the current production-derived baseline.
-- This no-op preserves exact production version/name order without claiming
-- that the incomplete overlay was a self-contained founding migration.

do $atlas_ledger_receipt$
begin
  null;
end
$atlas_ledger_receipt$;
