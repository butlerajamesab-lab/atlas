-- Atlas historical production-ledger compatibility receipt.
-- Version: 20260730194805
-- Name: 20260726_event_entity_resolution
-- Original statements SHA-256: aea2b1920e735001bf4ce8d03e5447c9788a87d191345e27269a7ef306762fd5
-- Original rollback SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
-- Disposition: represented by the current production-derived baseline.
-- This no-op preserves exact production version/name order without claiming
-- that the incomplete overlay was a self-contained founding migration.

do $atlas_ledger_receipt$
begin
  null;
end
$atlas_ledger_receipt$;
