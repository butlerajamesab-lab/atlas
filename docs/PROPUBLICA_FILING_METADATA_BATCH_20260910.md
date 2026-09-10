# ProPublica filing metadata batch correction

Nine current Lighthouse observations report elevated missing nonprofit filing metadata. The preserved Atlas source payloads show a common adapter defect: the API's `tax_prd` field is discarded, and JavaScript `||` turns the valid numeric form code `0` into null. These observations describe ingestion quality, not a finding about an organization's conduct.

The API contract documents `tax_prd` as YYYYMM and `formtype` codes 0 (990), 1 (990EZ), and 2 (990PF): https://projects.propublica.org/nonprofits/api

The adapter now preserves those fields while retaining `tax_period` and `form_type` compatibility aliases. Explicit submission IDs, source URLs, source update timestamps, raw payloads, financial values, and source provenance retain their existing behavior. It does not interpret a tax period as an observation timestamp.

The fixture contains the relevant metadata from all 113 distinct captured filing records across ten organizations, selected by existing external ID plus PDF URL from identity-bound ProPublica events on 2026-09-10. All 113 have a source tax period, and 89 use form code 0. The test runs the actual adapter over the complete fixture, checks source preservation, and adds controls for aliases, absent metadata, explicit submission IDs, all official form codes, and distinct filing periods. It is not a full Atlas population replay.

Historical activation remains separate. Existing events, identities, detection receipts, and Lighthouse observations must not be overwritten. Corrected fallback external IDs contain the filing period, so replaying old raw filings without correction lineage would create a new representation of existing source records. Before historical re-ingestion, map old and corrected identities, append correction/supersession evidence, and verify the complete affected population and unaffected controls. Recompute the nine data-quality candidates from that corrected population and retire stale current candidates with provenance. Preserve unresolved records whose source really lacks the fields.
