-- ============================================================================
-- Atlas deterministic signal-event -> canonical-entity resolution substrate
--
-- Additive / non-destructive migration.
-- No destructive DML or DDL.
-- No fuzzy matching.
-- No entity creation.
-- No silent merge.
--
-- Contract:
--   public.signal_events(stream_id, offset)
--     -> declared source-specific extraction rule
--     -> exact canonical ID / exact external ID / exact normalized name / exact retained alias
--     -> resolved | ambiguous | unresolved | ignored
--     -> immutable, versioned, replay-verifiable resolution ledger
-- ============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS atlas;

-- --------------------------------------------------------------------------
-- Preflight and locked resolver rule contract
-- --------------------------------------------------------------------------

DO $block$
BEGIN
  IF to_regclass('public.signal_events') IS NULL THEN
    RAISE EXCEPTION 'required Atlas streaming table public.signal_events is missing';
  END IF;
  IF to_regclass('atlas.entity_registry') IS NULL THEN
    RAISE EXCEPTION 'required Atlas canonical entity table atlas.entity_registry is missing';
  END IF;
  IF to_regclass('atlas.entity_aliases') IS NULL THEN
    RAISE EXCEPTION 'required Atlas canonical alias table atlas.entity_aliases is missing';
  END IF;
END;
$block$;

CREATE TABLE IF NOT EXISTS atlas.signal_event_entity_resolution_rule (
  rule_id text NOT NULL,
  rule_version text NOT NULL,
  stream_id text NOT NULL,
  signal_types text[] NOT NULL,
  entity_role text NOT NULL,
  expected_entity_type text,
  exact_identifier_types text[] NOT NULL DEFAULT ARRAY[]::text[],
  name_fields text[] NOT NULL DEFAULT ARRAY[]::text[],
  identifier_fields text[] NOT NULL DEFAULT ARRAY[]::text[],
  transform text NOT NULL,
  rule_contract jsonb NOT NULL,
  rule_contract_hash text NOT NULL,
  rule_manifest_hash text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rule_id, rule_version),
  CONSTRAINT signal_event_entity_resolution_rule_contract_hash_check
    CHECK (rule_contract_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT signal_event_entity_resolution_rule_manifest_hash_check
    CHECK (rule_manifest_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT signal_event_entity_resolution_rule_required_text_check
    CHECK (
      btrim(rule_id) <> ''
      AND btrim(rule_version) <> ''
      AND btrim(stream_id) <> ''
      AND btrim(entity_role) <> ''
      AND btrim(transform) <> ''
    )
);

INSERT INTO atlas.signal_event_entity_resolution_rule (
  rule_id,
  rule_version,
  stream_id,
  signal_types,
  entity_role,
  expected_entity_type,
  exact_identifier_types,
  name_fields,
  identifier_fields,
  transform,
  rule_contract,
  rule_contract_hash,
  rule_manifest_hash
)
VALUES
    ('pro_publica.nonprofit_registry_record.subject_nonprofit', '1.0.0', 'pro_publica', ARRAY['nonprofit_registry_record']::text[], 'subject_nonprofit', 'nonprofit', ARRAY['ein']::text[], ARRAY['payload.name', 'payload.raw.name', 'payload.raw.sub_name']::text[], ARRAY['payload.ein', 'payload.external_id', 'payload.raw.ein']::text[], 'first_non_empty_exact_field', '{"rule_id":"pro_publica.nonprofit_registry_record.subject_nonprofit","rule_version":"1.0.0","stream_id":"pro_publica","signal_types":["nonprofit_registry_record"],"entity_role":"subject_nonprofit","expected_entity_type":"nonprofit","exact_identifier_types":["ein"],"name_fields":["payload.name","payload.raw.name","payload.raw.sub_name"],"identifier_fields":["payload.ein","payload.external_id","payload.raw.ein"],"transform":"first_non_empty_exact_field"}'::jsonb, 'd1bbb9a5d7c3ad7c728e1c3eea20f98447555a8a944a58e00469d1da8013c882', 'd6c15b4bae26b4fb9c87f4173fcd8f880e59b1ff17e0d2e046aaeedaee9695dd'),
    ('pro_publica.nonprofit_990.subject_nonprofit', '1.0.0', 'pro_publica', ARRAY['nonprofit_990', 'nonprofit_990_filing']::text[], 'subject_nonprofit', 'nonprofit', ARRAY['ein']::text[], ARRAY['payload.organization_name', 'payload.name', 'payload.raw.organization_name', 'payload.raw.name']::text[], ARRAY['payload.ein', 'payload.raw.ein']::text[], 'first_non_empty_exact_field', '{"rule_id":"pro_publica.nonprofit_990.subject_nonprofit","rule_version":"1.0.0","stream_id":"pro_publica","signal_types":["nonprofit_990","nonprofit_990_filing"],"entity_role":"subject_nonprofit","expected_entity_type":"nonprofit","exact_identifier_types":["ein"],"name_fields":["payload.organization_name","payload.name","payload.raw.organization_name","payload.raw.name"],"identifier_fields":["payload.ein","payload.raw.ein"],"transform":"first_non_empty_exact_field"}'::jsonb, 'f2c9f0958e4231a7016ff96bd1d941fec67cd21118a83d8ca99352d317bc10cc', 'd6c15b4bae26b4fb9c87f4173fcd8f880e59b1ff17e0d2e046aaeedaee9695dd'),
    ('cfpb_complaints.complained_against_entity', '1.0.0', 'cfpb_complaints', ARRAY['*']::text[], 'complained_against_entity', 'organization', ARRAY[]::text[], ARRAY['payload.company', 'payload.employer']::text[], ARRAY[]::text[], 'first_non_empty_exact_field', '{"rule_id":"cfpb_complaints.complained_against_entity","rule_version":"1.0.0","stream_id":"cfpb_complaints","signal_types":["*"],"entity_role":"complained_against_entity","expected_entity_type":"organization","exact_identifier_types":[],"name_fields":["payload.company","payload.employer"],"identifier_fields":[],"transform":"first_non_empty_exact_field"}'::jsonb, '3b3abc5ee592d4a8c62dec2f94ec128165df66997f1172e44aa4d30a7dfbebee', 'd6c15b4bae26b4fb9c87f4173fcd8f880e59b1ff17e0d2e046aaeedaee9695dd'),
    ('eeoc_filings.respondent_employer', '1.0.0', 'eeoc_filings', ARRAY['*']::text[], 'respondent_employer', 'organization', ARRAY[]::text[], ARRAY['payload.employer']::text[], ARRAY[]::text[], 'first_non_empty_exact_field', '{"rule_id":"eeoc_filings.respondent_employer","rule_version":"1.0.0","stream_id":"eeoc_filings","signal_types":["*"],"entity_role":"respondent_employer","expected_entity_type":"organization","exact_identifier_types":[],"name_fields":["payload.employer"],"identifier_fields":[],"transform":"first_non_empty_exact_field"}'::jsonb, '9d476c640b8ce04e735410137f4d5ac5166eae3c57cee830a8038e8ae7d4e805', 'd6c15b4bae26b4fb9c87f4173fcd8f880e59b1ff17e0d2e046aaeedaee9695dd'),
    ('sec_edgar.issuer', '1.0.0', 'sec_edgar', ARRAY['*']::text[], 'issuer', 'organization', ARRAY['cik']::text[], ARRAY['payload.company']::text[], ARRAY['payload.cik']::text[], 'first_non_empty_exact_field', '{"rule_id":"sec_edgar.issuer","rule_version":"1.0.0","stream_id":"sec_edgar","signal_types":["*"],"entity_role":"issuer","expected_entity_type":"organization","exact_identifier_types":["cik"],"name_fields":["payload.company"],"identifier_fields":["payload.cik"],"transform":"first_non_empty_exact_field"}'::jsonb, '34ba4547199b8626482d67ad32f820655e06ffb645aaf86a9728eca425adaa64', 'd6c15b4bae26b4fb9c87f4173fcd8f880e59b1ff17e0d2e046aaeedaee9695dd'),
    ('regulations_gov.issuing_agency', '1.0.0', 'regulations_gov', ARRAY['*']::text[], 'issuing_agency', 'government_agency', ARRAY[]::text[], ARRAY['payload.agency', 'payload.agency_name']::text[], ARRAY[]::text[], 'first_non_empty_exact_field', '{"rule_id":"regulations_gov.issuing_agency","rule_version":"1.0.0","stream_id":"regulations_gov","signal_types":["*"],"entity_role":"issuing_agency","expected_entity_type":"government_agency","exact_identifier_types":[],"name_fields":["payload.agency","payload.agency_name"],"identifier_fields":[],"transform":"first_non_empty_exact_field"}'::jsonb, '8599770e6f8028091facdf80f9c3448a1094fe47c1f7d33d976e06d60b0e8245', 'd6c15b4bae26b4fb9c87f4173fcd8f880e59b1ff17e0d2e046aaeedaee9695dd'),
    ('usa_spending.award_recipient', '1.0.0', 'usa_spending', ARRAY['*']::text[], 'award_recipient', 'organization', ARRAY['uei', 'duns']::text[], ARRAY['payload.recipient_name', 'payload.recipient', 'payload.award_recipient', 'payload.recipient_legal_entity_name', 'payload.title']::text[], ARRAY['payload.recipient_uei', 'payload.uei', 'payload.recipient_duns', 'payload.duns']::text[], 'first_exact_field_or_contract_title_recipient_prefix', '{"rule_id":"usa_spending.award_recipient","rule_version":"1.0.0","stream_id":"usa_spending","signal_types":["*"],"entity_role":"award_recipient","expected_entity_type":"organization","exact_identifier_types":["uei","duns"],"name_fields":["payload.recipient_name","payload.recipient","payload.award_recipient","payload.recipient_legal_entity_name","payload.title"],"identifier_fields":["payload.recipient_uei","payload.uei","payload.recipient_duns","payload.duns"],"transform":"first_exact_field_or_contract_title_recipient_prefix"}'::jsonb, 'ff131501463b763791741f6fcfd05fe0f793b1b50ab0e969e9e354a159424c02', 'd6c15b4bae26b4fb9c87f4173fcd8f880e59b1ff17e0d2e046aaeedaee9695dd'),
    ('usa_spending.awarding_agency', '1.0.0', 'usa_spending', ARRAY['*']::text[], 'awarding_agency', 'government_agency', ARRAY[]::text[], ARRAY['payload.agency', 'payload.awarding_agency_name']::text[], ARRAY[]::text[], 'first_non_empty_exact_field', '{"rule_id":"usa_spending.awarding_agency","rule_version":"1.0.0","stream_id":"usa_spending","signal_types":["*"],"entity_role":"awarding_agency","expected_entity_type":"government_agency","exact_identifier_types":[],"name_fields":["payload.agency","payload.awarding_agency_name"],"identifier_fields":[],"transform":"first_non_empty_exact_field"}'::jsonb, '38bbcb8788563cddbf99f2aa9525546da9caaa00a28ab97707afbffb3653d613', 'd6c15b4bae26b4fb9c87f4173fcd8f880e59b1ff17e0d2e046aaeedaee9695dd'),
    ('grants_gov.granting_agency', '1.0.0', 'grants_gov', ARRAY['*']::text[], 'granting_agency', 'government_agency', ARRAY[]::text[], ARRAY['payload.agency', 'payload.agency_name']::text[], ARRAY[]::text[], 'first_non_empty_exact_field', '{"rule_id":"grants_gov.granting_agency","rule_version":"1.0.0","stream_id":"grants_gov","signal_types":["*"],"entity_role":"granting_agency","expected_entity_type":"government_agency","exact_identifier_types":[],"name_fields":["payload.agency","payload.agency_name"],"identifier_fields":[],"transform":"first_non_empty_exact_field"}'::jsonb, '44b4e3958220b5c4a7dc300075012791017d71645a350367bc7503163aa104a4', 'd6c15b4bae26b4fb9c87f4173fcd8f880e59b1ff17e0d2e046aaeedaee9695dd'),
    ('open_states.legislative_sponsor', '1.0.0', 'open_states', ARRAY['*']::text[], 'legislative_sponsor', 'person', ARRAY[]::text[], ARRAY['payload.sponsor', 'payload.sponsor_name', 'payload.sponsors[*]']::text[], ARRAY[]::text[], 'direct_or_array_exact_sponsor_name', '{"rule_id":"open_states.legislative_sponsor","rule_version":"1.0.0","stream_id":"open_states","signal_types":["*"],"entity_role":"legislative_sponsor","expected_entity_type":"person","exact_identifier_types":[],"name_fields":["payload.sponsor","payload.sponsor_name","payload.sponsors[*]"],"identifier_fields":[],"transform":"direct_or_array_exact_sponsor_name"}'::jsonb, '0f7e7c9c9a9e81b775d796e863be46008aa37f39d7db25ab98139d4ecc08253f', 'd6c15b4bae26b4fb9c87f4173fcd8f880e59b1ff17e0d2e046aaeedaee9695dd'),
    ('generic.canonical_entity_id', '1.0.0', '*', ARRAY['*']::text[], 'subject_entity', NULL, ARRAY['canonical_entity_id']::text[], ARRAY['payload.entity_name', 'payload.entity']::text[], ARRAY['payload.canonical_entity_id']::text[], 'exact_canonical_entity_id', '{"rule_id":"generic.canonical_entity_id","rule_version":"1.0.0","stream_id":"*","signal_types":["*"],"entity_role":"subject_entity","expected_entity_type":null,"exact_identifier_types":["canonical_entity_id"],"name_fields":["payload.entity_name","payload.entity"],"identifier_fields":["payload.canonical_entity_id"],"transform":"exact_canonical_entity_id"}'::jsonb, '2d4006aaa6469fb5203e0cd045ced99e4aa210b0934de38471b55a93d2d8fcca', 'd6c15b4bae26b4fb9c87f4173fcd8f880e59b1ff17e0d2e046aaeedaee9695dd'),
    ('generic.declared_subject_field', '1.0.0', '*', ARRAY['*']::text[], 'subject_entity', NULL, ARRAY[]::text[], ARRAY['payload.entity_name', 'payload.entity']::text[], ARRAY[]::text[], 'first_non_empty_exact_field', '{"rule_id":"generic.declared_subject_field","rule_version":"1.0.0","stream_id":"*","signal_types":["*"],"entity_role":"subject_entity","expected_entity_type":null,"exact_identifier_types":[],"name_fields":["payload.entity_name","payload.entity"],"identifier_fields":[],"transform":"first_non_empty_exact_field"}'::jsonb, '41286a9352bbabbda95e3f9f86cf83204a767ea6d6c46f55090475742bc47ae3', 'd6c15b4bae26b4fb9c87f4173fcd8f880e59b1ff17e0d2e046aaeedaee9695dd'),
    ('system.no_declared_entity_rule', '1.0.0', '*', ARRAY['*']::text[], 'none', NULL, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], 'explicit_ignored_outcome', '{"rule_id":"system.no_declared_entity_rule","rule_version":"1.0.0","stream_id":"*","signal_types":["*"],"entity_role":"none","expected_entity_type":null,"exact_identifier_types":[],"name_fields":[],"identifier_fields":[],"transform":"explicit_ignored_outcome"}'::jsonb, '9beb2e1d96f9e4b30c888f9123ff34947ad0ec04a6a91389844849f191f7c98d', 'd6c15b4bae26b4fb9c87f4173fcd8f880e59b1ff17e0d2e046aaeedaee9695dd')
ON CONFLICT (rule_id, rule_version) DO NOTHING;

DO $block$
DECLARE
  v_expected_count integer := 13;
BEGIN
  IF (
    SELECT count(*)
    FROM atlas.signal_event_entity_resolution_rule
    WHERE is_active = true
      AND rule_manifest_hash = 'd6c15b4bae26b4fb9c87f4173fcd8f880e59b1ff17e0d2e046aaeedaee9695dd'
  ) <> v_expected_count THEN
    RAISE EXCEPTION 'active event-entity rule manifest is incomplete or contains an unexpected rule set';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM atlas.signal_event_entity_resolution_rule
    WHERE is_active = true
      AND rule_manifest_hash <> 'd6c15b4bae26b4fb9c87f4173fcd8f880e59b1ff17e0d2e046aaeedaee9695dd'
  ) THEN
    RAISE EXCEPTION 'multiple active event-entity rule manifests are not permitted';
  END IF;

  IF EXISTS (
    WITH expected(rule_id, rule_version, rule_contract, rule_contract_hash) AS (
      VALUES
      ('pro_publica.nonprofit_registry_record.subject_nonprofit', '1.0.0', '{"rule_id":"pro_publica.nonprofit_registry_record.subject_nonprofit","rule_version":"1.0.0","stream_id":"pro_publica","signal_types":["nonprofit_registry_record"],"entity_role":"subject_nonprofit","expected_entity_type":"nonprofit","exact_identifier_types":["ein"],"name_fields":["payload.name","payload.raw.name","payload.raw.sub_name"],"identifier_fields":["payload.ein","payload.external_id","payload.raw.ein"],"transform":"first_non_empty_exact_field"}'::jsonb, 'd1bbb9a5d7c3ad7c728e1c3eea20f98447555a8a944a58e00469d1da8013c882'),
      ('pro_publica.nonprofit_990.subject_nonprofit', '1.0.0', '{"rule_id":"pro_publica.nonprofit_990.subject_nonprofit","rule_version":"1.0.0","stream_id":"pro_publica","signal_types":["nonprofit_990","nonprofit_990_filing"],"entity_role":"subject_nonprofit","expected_entity_type":"nonprofit","exact_identifier_types":["ein"],"name_fields":["payload.organization_name","payload.name","payload.raw.organization_name","payload.raw.name"],"identifier_fields":["payload.ein","payload.raw.ein"],"transform":"first_non_empty_exact_field"}'::jsonb, 'f2c9f0958e4231a7016ff96bd1d941fec67cd21118a83d8ca99352d317bc10cc'),
      ('cfpb_complaints.complained_against_entity', '1.0.0', '{"rule_id":"cfpb_complaints.complained_against_entity","rule_version":"1.0.0","stream_id":"cfpb_complaints","signal_types":["*"],"entity_role":"complained_against_entity","expected_entity_type":"organization","exact_identifier_types":[],"name_fields":["payload.company","payload.employer"],"identifier_fields":[],"transform":"first_non_empty_exact_field"}'::jsonb, '3b3abc5ee592d4a8c62dec2f94ec128165df66997f1172e44aa4d30a7dfbebee'),
      ('eeoc_filings.respondent_employer', '1.0.0', '{"rule_id":"eeoc_filings.respondent_employer","rule_version":"1.0.0","stream_id":"eeoc_filings","signal_types":["*"],"entity_role":"respondent_employer","expected_entity_type":"organization","exact_identifier_types":[],"name_fields":["payload.employer"],"identifier_fields":[],"transform":"first_non_empty_exact_field"}'::jsonb, '9d476c640b8ce04e735410137f4d5ac5166eae3c57cee830a8038e8ae7d4e805'),
      ('sec_edgar.issuer', '1.0.0', '{"rule_id":"sec_edgar.issuer","rule_version":"1.0.0","stream_id":"sec_edgar","signal_types":["*"],"entity_role":"issuer","expected_entity_type":"organization","exact_identifier_types":["cik"],"name_fields":["payload.company"],"identifier_fields":["payload.cik"],"transform":"first_non_empty_exact_field"}'::jsonb, '34ba4547199b8626482d67ad32f820655e06ffb645aaf86a9728eca425adaa64'),
      ('regulations_gov.issuing_agency', '1.0.0', '{"rule_id":"regulations_gov.issuing_agency","rule_version":"1.0.0","stream_id":"regulations_gov","signal_types":["*"],"entity_role":"issuing_agency","expected_entity_type":"government_agency","exact_identifier_types":[],"name_fields":["payload.agency","payload.agency_name"],"identifier_fields":[],"transform":"first_non_empty_exact_field"}'::jsonb, '8599770e6f8028091facdf80f9c3448a1094fe47c1f7d33d976e06d60b0e8245'),
      ('usa_spending.award_recipient', '1.0.0', '{"rule_id":"usa_spending.award_recipient","rule_version":"1.0.0","stream_id":"usa_spending","signal_types":["*"],"entity_role":"award_recipient","expected_entity_type":"organization","exact_identifier_types":["uei","duns"],"name_fields":["payload.recipient_name","payload.recipient","payload.award_recipient","payload.recipient_legal_entity_name","payload.title"],"identifier_fields":["payload.recipient_uei","payload.uei","payload.recipient_duns","payload.duns"],"transform":"first_exact_field_or_contract_title_recipient_prefix"}'::jsonb, 'ff131501463b763791741f6fcfd05fe0f793b1b50ab0e969e9e354a159424c02'),
      ('usa_spending.awarding_agency', '1.0.0', '{"rule_id":"usa_spending.awarding_agency","rule_version":"1.0.0","stream_id":"usa_spending","signal_types":["*"],"entity_role":"awarding_agency","expected_entity_type":"government_agency","exact_identifier_types":[],"name_fields":["payload.agency","payload.awarding_agency_name"],"identifier_fields":[],"transform":"first_non_empty_exact_field"}'::jsonb, '38bbcb8788563cddbf99f2aa9525546da9caaa00a28ab97707afbffb3653d613'),
      ('grants_gov.granting_agency', '1.0.0', '{"rule_id":"grants_gov.granting_agency","rule_version":"1.0.0","stream_id":"grants_gov","signal_types":["*"],"entity_role":"granting_agency","expected_entity_type":"government_agency","exact_identifier_types":[],"name_fields":["payload.agency","payload.agency_name"],"identifier_fields":[],"transform":"first_non_empty_exact_field"}'::jsonb, '44b4e3958220b5c4a7dc300075012791017d71645a350367bc7503163aa104a4'),
      ('open_states.legislative_sponsor', '1.0.0', '{"rule_id":"open_states.legislative_sponsor","rule_version":"1.0.0","stream_id":"open_states","signal_types":["*"],"entity_role":"legislative_sponsor","expected_entity_type":"person","exact_identifier_types":[],"name_fields":["payload.sponsor","payload.sponsor_name","payload.sponsors[*]"],"identifier_fields":[],"transform":"direct_or_array_exact_sponsor_name"}'::jsonb, '0f7e7c9c9a9e81b775d796e863be46008aa37f39d7db25ab98139d4ecc08253f'),
      ('generic.canonical_entity_id', '1.0.0', '{"rule_id":"generic.canonical_entity_id","rule_version":"1.0.0","stream_id":"*","signal_types":["*"],"entity_role":"subject_entity","expected_entity_type":null,"exact_identifier_types":["canonical_entity_id"],"name_fields":["payload.entity_name","payload.entity"],"identifier_fields":["payload.canonical_entity_id"],"transform":"exact_canonical_entity_id"}'::jsonb, '2d4006aaa6469fb5203e0cd045ced99e4aa210b0934de38471b55a93d2d8fcca'),
      ('generic.declared_subject_field', '1.0.0', '{"rule_id":"generic.declared_subject_field","rule_version":"1.0.0","stream_id":"*","signal_types":["*"],"entity_role":"subject_entity","expected_entity_type":null,"exact_identifier_types":[],"name_fields":["payload.entity_name","payload.entity"],"identifier_fields":[],"transform":"first_non_empty_exact_field"}'::jsonb, '41286a9352bbabbda95e3f9f86cf83204a767ea6d6c46f55090475742bc47ae3'),
      ('system.no_declared_entity_rule', '1.0.0', '{"rule_id":"system.no_declared_entity_rule","rule_version":"1.0.0","stream_id":"*","signal_types":["*"],"entity_role":"none","expected_entity_type":null,"exact_identifier_types":[],"name_fields":[],"identifier_fields":[],"transform":"explicit_ignored_outcome"}'::jsonb, '9beb2e1d96f9e4b30c888f9123ff34947ad0ec04a6a91389844849f191f7c98d')
    )
    SELECT 1
    FROM expected e
    LEFT JOIN atlas.signal_event_entity_resolution_rule r
      ON r.rule_id = e.rule_id
     AND r.rule_version = e.rule_version
    WHERE r.rule_id IS NULL
       OR r.rule_contract IS DISTINCT FROM e.rule_contract
       OR r.rule_contract_hash IS DISTINCT FROM e.rule_contract_hash
       OR r.rule_manifest_hash IS DISTINCT FROM 'd6c15b4bae26b4fb9c87f4173fcd8f880e59b1ff17e0d2e046aaeedaee9695dd'
       OR r.is_active IS DISTINCT FROM true
  ) THEN
    RAISE EXCEPTION 'stored event-entity rule contract differs from the locked manifest';
  END IF;
END;
$block$;

CREATE INDEX IF NOT EXISTS signal_event_entity_resolution_rule_manifest_idx
  ON atlas.signal_event_entity_resolution_rule(rule_manifest_hash, is_active);

COMMENT ON TABLE atlas.signal_event_entity_resolution_rule IS
  'Locked source-specific deterministic extraction rules for signal-event entity resolution. Rule changes require a new rule and resolver version.';

ALTER TABLE atlas.signal_event_entity_resolution_rule ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON atlas.signal_event_entity_resolution_rule FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON atlas.signal_event_entity_resolution_rule TO service_role;

CREATE OR REPLACE FUNCTION atlas.guard_signal_event_entity_resolution_rule_immutable_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, atlas, extensions
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'signal-event entity resolution rules cannot be deleted; retire the prior version';
  END IF;

  IF (to_jsonb(NEW) - 'is_active') IS DISTINCT FROM (to_jsonb(OLD) - 'is_active') THEN
    RAISE EXCEPTION 'signal-event entity resolution rule contracts are immutable; publish a new version';
  END IF;

  RETURN NEW;
END;
$function$;

DO $block$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'signal_event_entity_resolution_rule_immutable_v1'
      AND tgrelid = 'atlas.signal_event_entity_resolution_rule'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER signal_event_entity_resolution_rule_immutable_v1
      BEFORE UPDATE OR DELETE ON atlas.signal_event_entity_resolution_rule
      FOR EACH ROW
      EXECUTE FUNCTION atlas.guard_signal_event_entity_resolution_rule_immutable_v1();
  END IF;
END;
$block$;

CREATE TABLE IF NOT EXISTS atlas.signal_event_entity_resolution_run (
  run_id uuid PRIMARY KEY,
  resolver_id text NOT NULL,
  resolver_version text NOT NULL,
  rule_manifest_hash text NOT NULL,
  entity_index_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'partial', 'failed')),
  stream_id text,
  batch_size integer NOT NULL CHECK (batch_size BETWEEN 1 AND 5000),
  input_manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  manifest_hash text NOT NULL,
  processed_event_count bigint NOT NULL DEFAULT 0,
  resolution_row_count bigint NOT NULL DEFAULT 0,
  resolved_count bigint NOT NULL DEFAULT 0,
  ambiguous_count bigint NOT NULL DEFAULT 0,
  unresolved_count bigint NOT NULL DEFAULT 0,
  ignored_count bigint NOT NULL DEFAULT 0,
  inserted_count bigint NOT NULL DEFAULT 0,
  idempotent_count bigint NOT NULL DEFAULT 0,
  last_stream_id text,
  last_offset bigint,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signal_event_entity_resolution_run_manifest_hash_check
    CHECK (manifest_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT signal_event_entity_resolution_run_rule_hash_check
    CHECK (rule_manifest_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT signal_event_entity_resolution_run_index_hash_check
    CHECK (entity_index_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS signal_event_entity_resolution_run_contract_idx
  ON atlas.signal_event_entity_resolution_run(resolver_id, resolver_version, started_at DESC);
CREATE INDEX IF NOT EXISTS signal_event_entity_resolution_run_status_idx
  ON atlas.signal_event_entity_resolution_run(status, started_at DESC);

CREATE TABLE IF NOT EXISTS atlas.signal_event_entity_resolution (
  resolution_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  stream_id text NOT NULL,
  event_offset bigint NOT NULL,
  event_timestamp timestamptz NOT NULL,
  signal_type text NOT NULL,
  source_id text NOT NULL,
  jurisdiction_id text NOT NULL,
  module_hint text NOT NULL,

  rule_id text NOT NULL,
  rule_version text NOT NULL,
  candidate_key text NOT NULL,
  entity_role text NOT NULL,
  source_field text NOT NULL,
  source_field_value text,
  source_entity_value text,
  normalized_entity_value text,
  source_identifier_field text,
  source_identifier_type text,
  source_identifier_value text,
  normalized_identifier_value text,
  expected_entity_type text,

  entity_id varchar(128),
  resolution_status text NOT NULL
    CHECK (resolution_status IN ('resolved', 'ambiguous', 'unresolved', 'ignored')),
  match_method text NOT NULL,
  candidate_entity_ids varchar(128)[] NOT NULL DEFAULT ARRAY[]::varchar(128)[],
  match_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,

  event_input_hash text NOT NULL,
  entity_index_hash text NOT NULL,
  rule_manifest_hash text NOT NULL,
  resolution_hash text NOT NULL,
  resolver_id text NOT NULL,
  resolver_version text NOT NULL,

  first_run_id uuid NOT NULL,
  last_run_id uuid NOT NULL,
  is_current boolean NOT NULL DEFAULT true,
  resolved_at timestamptz NOT NULL DEFAULT now(),
  last_replayed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT signal_event_entity_resolution_event_fk
    FOREIGN KEY (stream_id, event_offset)
    REFERENCES public.signal_events(stream_id, offset)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT signal_event_entity_resolution_rule_fk
    FOREIGN KEY (rule_id, rule_version)
    REFERENCES atlas.signal_event_entity_resolution_rule(rule_id, rule_version)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT signal_event_entity_resolution_entity_fk
    FOREIGN KEY (entity_id)
    REFERENCES atlas.entity_registry(entity_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT signal_event_entity_resolution_first_run_fk
    FOREIGN KEY (first_run_id)
    REFERENCES atlas.signal_event_entity_resolution_run(run_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT signal_event_entity_resolution_last_run_fk
    FOREIGN KEY (last_run_id)
    REFERENCES atlas.signal_event_entity_resolution_run(run_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT signal_event_entity_resolution_hash_check
    CHECK (resolution_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT signal_event_entity_resolution_event_hash_check
    CHECK (event_input_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT signal_event_entity_resolution_index_hash_check
    CHECK (entity_index_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT signal_event_entity_resolution_rule_manifest_hash_check
    CHECK (rule_manifest_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT signal_event_entity_resolution_candidate_key_check
    CHECK (candidate_key ~ '^[0-9a-f]{64}$'),
  CONSTRAINT signal_event_entity_resolution_required_text_check
    CHECK (
      btrim(rule_id) <> ''
      AND btrim(rule_version) <> ''
      AND btrim(entity_role) <> ''
      AND btrim(source_field) <> ''
      AND btrim(match_method) <> ''
      AND btrim(resolver_id) <> ''
      AND btrim(resolver_version) <> ''
    ),
  CONSTRAINT signal_event_entity_resolution_entity_state_check
    CHECK (
      (resolution_status = 'resolved' AND entity_id IS NOT NULL)
      OR
      (resolution_status <> 'resolved' AND entity_id IS NULL)
    ),
  CONSTRAINT signal_event_entity_resolution_resolved_candidate_check
    CHECK (resolution_status <> 'resolved' OR entity_id = ANY(candidate_entity_ids)),
  CONSTRAINT signal_event_entity_resolution_ambiguous_candidates_check
    CHECK (resolution_status <> 'ambiguous' OR cardinality(candidate_entity_ids) >= 2),
  CONSTRAINT signal_event_entity_resolution_unresolved_candidates_check
    CHECK (resolution_status <> 'unresolved' OR cardinality(candidate_entity_ids) <= 1),
  CONSTRAINT signal_event_entity_resolution_ignored_state_check
    CHECK (resolution_status <> 'ignored' OR cardinality(candidate_entity_ids) = 0),
  CONSTRAINT signal_event_entity_resolution_method_state_check
    CHECK (
      (resolution_status = 'resolved' AND match_method IN (
        'exact_canonical_entity_id',
        'exact_external_identifier',
        'exact_primary_name',
        'exact_name_variant',
        'exact_alias'
      ))
      OR
      (resolution_status = 'ambiguous' AND match_method IN (
        'identifier_name_conflict',
        'duplicate_external_identifier',
        'duplicate_exact_name'
      ))
      OR
      (resolution_status = 'unresolved' AND match_method IN (
        'no_exact_match',
        'no_usable_identity_value',
        'exact_match_entity_type_mismatch'
      ))
      OR
      (resolution_status = 'ignored' AND match_method = 'no_declared_entity_rule')
    ),
  CONSTRAINT signal_event_entity_resolution_contract_key
    UNIQUE (
      stream_id,
      event_offset,
      candidate_key,
      resolver_id,
      resolver_version,
      entity_index_hash
    ),
  CONSTRAINT signal_event_entity_resolution_hash_unique
    UNIQUE (resolution_hash)
);

CREATE INDEX IF NOT EXISTS signal_event_entity_resolution_event_idx
  ON atlas.signal_event_entity_resolution(stream_id, event_offset);
CREATE INDEX IF NOT EXISTS signal_event_entity_resolution_entity_idx
  ON atlas.signal_event_entity_resolution(entity_id, event_timestamp DESC)
  WHERE entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS signal_event_entity_resolution_status_idx
  ON atlas.signal_event_entity_resolution(resolution_status, stream_id, event_offset);
CREATE INDEX IF NOT EXISTS signal_event_entity_resolution_run_idx
  ON atlas.signal_event_entity_resolution(last_run_id);
CREATE INDEX IF NOT EXISTS signal_event_entity_resolution_rule_idx
  ON atlas.signal_event_entity_resolution(rule_id, rule_version, resolution_status);
CREATE UNIQUE INDEX IF NOT EXISTS signal_event_entity_resolution_current_uidx
  ON atlas.signal_event_entity_resolution(stream_id, event_offset, candidate_key, resolver_id)
  WHERE is_current = true;

COMMENT ON TABLE atlas.signal_event_entity_resolution IS
  'Immutable versioned mapping from Atlas signal-event identity to canonical entity identity. Exact matching only; unresolved and ambiguous outcomes remain explicit.';
COMMENT ON TABLE atlas.signal_event_entity_resolution_run IS
  'Auditable execution ledger for bounded deterministic event-entity resolution and replay.';

ALTER TABLE atlas.signal_event_entity_resolution ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas.signal_event_entity_resolution_run ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON atlas.signal_event_entity_resolution FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON atlas.signal_event_entity_resolution_run FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON atlas.signal_event_entity_resolution TO service_role;
GRANT SELECT ON atlas.signal_event_entity_resolution_run TO service_role;

-- --------------------------------------------------------------------------
-- Canonical hash functions
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.atlas_signal_event_input_hash_v1(
  p_stream_id text,
  p_offset bigint,
  p_timestamp timestamptz,
  p_signal_type text,
  p_spacetime jsonb,
  p_provenance jsonb,
  p_payload jsonb,
  p_source_id text,
  p_jurisdiction_id text,
  p_module_hint text,
  p_ingested_at timestamptz
)
RETURNS text
LANGUAGE sql
STABLE
STRICT
SET search_path TO pg_catalog, public, extensions
AS $function$
  SELECT encode(
    digest(
      concat_ws(
        chr(31),
        p_stream_id,
        p_offset::text,
        to_char(p_timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        p_signal_type,
        p_spacetime::text,
        p_provenance::text,
        p_payload::text,
        p_source_id,
        p_jurisdiction_id,
        p_module_hint,
        to_char(p_ingested_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      ),
      'sha256'
    ),
    'hex'
  );
$function$;

CREATE OR REPLACE FUNCTION public.atlas_event_entity_candidate_key_v1(
  p_rule_id text,
  p_rule_version text,
  p_entity_role text,
  p_source_field text,
  p_normalized_entity_value text,
  p_source_identifier_field text,
  p_source_identifier_type text,
  p_normalized_identifier_value text,
  p_expected_entity_type text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO pg_catalog, public, extensions
AS $function$
  SELECT encode(
    digest(
      concat_ws(
        chr(31),
        COALESCE(p_rule_id, ''),
        COALESCE(p_rule_version, ''),
        COALESCE(p_entity_role, ''),
        COALESCE(p_source_field, ''),
        COALESCE(p_normalized_entity_value, ''),
        COALESCE(p_source_identifier_field, ''),
        COALESCE(p_source_identifier_type, ''),
        COALESCE(p_normalized_identifier_value, ''),
        COALESCE(p_expected_entity_type, '')
      ),
      'sha256'
    ),
    'hex'
  );
$function$;

CREATE OR REPLACE FUNCTION public.atlas_event_entity_resolution_hash_v1(
  p_event_input_hash text,
  p_entity_index_hash text,
  p_rule_manifest_hash text,
  p_rule_id text,
  p_rule_version text,
  p_candidate_key text,
  p_entity_role text,
  p_source_field text,
  p_normalized_entity_value text,
  p_source_identifier_field text,
  p_source_identifier_type text,
  p_normalized_identifier_value text,
  p_expected_entity_type text,
  p_resolution_status text,
  p_entity_id text,
  p_match_method text,
  p_candidate_entity_ids text[],
  p_resolver_id text,
  p_resolver_version text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO pg_catalog, public, extensions
AS $function$
  SELECT encode(
    digest(
      concat_ws(
        chr(31),
        COALESCE(p_event_input_hash, ''),
        COALESCE(p_entity_index_hash, ''),
        COALESCE(p_rule_manifest_hash, ''),
        COALESCE(p_rule_id, ''),
        COALESCE(p_rule_version, ''),
        COALESCE(p_candidate_key, ''),
        COALESCE(p_entity_role, ''),
        COALESCE(p_source_field, ''),
        COALESCE(p_normalized_entity_value, ''),
        COALESCE(p_source_identifier_field, ''),
        COALESCE(p_source_identifier_type, ''),
        COALESCE(p_normalized_identifier_value, ''),
        COALESCE(p_expected_entity_type, ''),
        COALESCE(p_resolution_status, ''),
        COALESCE(p_entity_id, ''),
        COALESCE(p_match_method, ''),
        COALESCE((
          SELECT string_agg(candidate_id, chr(30) ORDER BY candidate_id)
          FROM unnest(COALESCE(p_candidate_entity_ids, ARRAY[]::text[])) AS candidate(candidate_id)
        ), ''),
        COALESCE(p_resolver_id, ''),
        COALESCE(p_resolver_version, '')
      ),
      'sha256'
    ),
    'hex'
  );
$function$;

-- --------------------------------------------------------------------------
-- Exact payload-field provenance verifier
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.atlas_event_payload_field_text_v1(
  p_payload jsonb,
  p_source_field text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path TO pg_catalog, public, extensions
AS $function$
DECLARE
  v_path text;
  v_parts text[];
BEGIN
  IF p_source_field = '__none__' THEN
    RETURN NULL;
  END IF;
  IF p_source_field !~ '^payload(\.|\[)' THEN
    RAISE EXCEPTION 'unsupported event payload source field: %', p_source_field;
  END IF;

  v_path := regexp_replace(p_source_field, '^payload\.?', '');
  v_path := regexp_replace(v_path, '\[([0-9]+)\]', '.\1', 'g');
  v_parts := string_to_array(v_path, '.');
  RETURN p_payload #>> v_parts;
END;
$function$;

CREATE OR REPLACE FUNCTION public.atlas_normalize_entity_name_v1(
  p_value text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path TO pg_catalog, public, extensions
AS $function$
  SELECT NULLIF(
    regexp_replace(
      upper(btrim(p_value)),
      '[^A-Z0-9]',
      '',
      'g'
    ),
    ''
  );
$function$;

CREATE OR REPLACE FUNCTION public.atlas_normalize_entity_identifier_v1(
  p_identifier_type text,
  p_value text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO pg_catalog, public, extensions
AS $function$
DECLARE
  v_type text := lower(COALESCE(p_identifier_type, 'generic'));
  v_raw text;
  v_digits text;
  v_compact text;
BEGIN
  IF p_value IS NULL THEN
    RETURN NULL;
  END IF;

  v_raw := btrim(normalize(p_value, NFKC));
  IF v_raw = '' THEN
    RETURN NULL;
  END IF;

  IF v_type = 'canonical_entity_id' THEN
    RETURN v_raw;
  END IF;

  IF v_type IN ('ein', 'duns', 'cik') THEN
    v_digits := regexp_replace(v_raw, '[^0-9]', '', 'g');
    IF v_type IN ('ein', 'duns') THEN
      RETURN CASE WHEN length(v_digits) = 9 THEN v_digits ELSE NULL END;
    END IF;
    RETURN CASE
      WHEN length(v_digits) BETWEEN 1 AND 10 THEN lpad(v_digits, 10, '0')
      ELSE NULL
    END;
  END IF;

  v_compact := regexp_replace(upper(v_raw), '[^A-Z0-9]', '', 'g');
  IF v_type = 'uei' THEN
    RETURN CASE WHEN length(v_compact) = 12 THEN v_compact ELSE NULL END;
  END IF;

  RETURN NULLIF(v_compact, '');
END;
$function$;

CREATE OR REPLACE FUNCTION public.atlas_event_entity_source_value_v1(
  p_rule_id text,
  p_source_field text,
  p_source_field_value text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO pg_catalog, public, extensions
AS $function$
DECLARE
  v_value text;
  v_match text[];
BEGIN
  IF p_source_field = '__none__' OR p_source_field_value IS NULL THEN
    RETURN NULL;
  END IF;

  v_value := NULLIF(btrim(p_source_field_value), '');
  IF v_value IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_rule_id = 'usa_spending.award_recipient'
     AND p_source_field = 'payload.title' THEN
    v_match := regexp_match(
      v_value,
      '^(Contract|Award|Grant)[[:space:]]*:[[:space:]]*(.*?)([[:space:]]+[—–-][[:space:]]+\$|[[:space:]]+[—–-][[:space:]]+|$)',
      'i'
    );
    RETURN NULLIF(btrim(v_match[2]), '');
  END IF;

  RETURN v_value;
END;
$function$;

-- --------------------------------------------------------------------------
-- Independent PostgreSQL exact-match verifier
--
-- The application resolver supplies a candidate set, status, method, and
-- selected entity. PostgreSQL recomputes that result from the current locked
-- entity/alias substrate before a canonical row may be persisted. This blocks
-- a buggy or compromised client from supplying an arbitrary active entity ID.
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION atlas.event_entity_source_system_text_v1(
  p_source_population_table text,
  p_source_systems jsonb,
  p_metadata jsonb
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO pg_catalog, public, atlas, extensions
AS $function$
DECLARE
  v_source_systems_text text := '';
BEGIN
  IF jsonb_typeof(p_source_systems) = 'array' THEN
    SELECT COALESCE(string_agg(value, ' ' ORDER BY value), '')
    INTO v_source_systems_text
    FROM jsonb_array_elements_text(p_source_systems) AS source_system(value);
  END IF;

  RETURN lower(concat_ws(
    ' ',
    COALESCE(p_source_population_table, ''),
    v_source_systems_text,
    COALESCE(p_metadata->>'source', '')
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION atlas.infer_entity_identifier_type_v1(
  p_source_population_table text,
  p_source_systems jsonb,
  p_metadata jsonb,
  p_value text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO pg_catalog, public, atlas, extensions
AS $function$
DECLARE
  v_source_text text;
  v_raw text;
  v_digits text;
  v_compact text;
BEGIN
  IF p_value IS NULL OR btrim(p_value) = '' THEN
    RETURN 'generic';
  END IF;

  v_source_text := atlas.event_entity_source_system_text_v1(
    p_source_population_table,
    p_source_systems,
    p_metadata
  );
  v_raw := normalize(p_value, NFKC);
  v_digits := regexp_replace(v_raw, '[^0-9]', '', 'g');
  v_compact := regexp_replace(upper(v_raw), '[^A-Z0-9]', '', 'g');

  IF (
    position('pro_publica' IN v_source_text) > 0
    OR position('nonprofit' IN v_source_text) > 0
    OR position('irs' IN v_source_text) > 0
  ) AND length(v_digits) = 9 THEN
    RETURN 'ein';
  END IF;

  IF position('sec' IN v_source_text) > 0
     OR position('edgar' IN v_source_text) > 0 THEN
    RETURN 'cik';
  END IF;

  IF position('usaspending' IN v_source_text) > 0
     OR position('sam_gov' IN v_source_text) > 0 THEN
    IF length(v_compact) = 12 THEN
      RETURN 'uei';
    END IF;
    IF length(v_digits) = 9 THEN
      RETURN 'duns';
    END IF;
  END IF;

  RETURN 'generic';
END;
$function$;

CREATE OR REPLACE FUNCTION atlas.entity_type_compatible_v1(
  p_expected_entity_type text,
  p_actual_entity_type text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO pg_catalog, public, atlas, extensions
AS $function$
  SELECT CASE
    WHEN p_expected_entity_type IS NULL OR btrim(p_expected_entity_type) = '' THEN true
    WHEN p_actual_entity_type IS NULL OR btrim(p_actual_entity_type) = '' THEN false
    WHEN lower(p_expected_entity_type) = lower(p_actual_entity_type) THEN true
    WHEN lower(p_expected_entity_type) = 'organization' THEN lower(p_actual_entity_type) IN (
      'organization',
      'corporation',
      'nonprofit',
      'political_committee',
      'government_agency',
      'financial_institution',
      'telecom_company',
      'media_company',
      'contractor_business',
      'landlord_entity'
    )
    WHEN lower(p_expected_entity_type) = 'government_agency' THEN lower(p_actual_entity_type) IN (
      'government_agency',
      'agency',
      'court'
    )
    WHEN lower(p_expected_entity_type) = 'person' THEN lower(p_actual_entity_type) IN (
      'person',
      'individual_person',
      'legislator',
      'lobbyist',
      'judge'
    )
    WHEN lower(p_expected_entity_type) = 'nonprofit' THEN lower(p_actual_entity_type) = 'nonprofit'
    ELSE false
  END;
$function$;

CREATE OR REPLACE FUNCTION atlas.resolve_signal_event_entity_candidate_exact_v1(
  p_normalized_entity_value text,
  p_source_identifier_type text,
  p_normalized_identifier_value text,
  p_expected_entity_type text
)
RETURNS TABLE (
  expected_resolution_status text,
  expected_match_method text,
  expected_entity_id text,
  expected_candidate_entity_ids text[]
)
LANGUAGE plpgsql
STABLE
SET search_path TO pg_catalog, public, atlas, extensions
AS $function$
DECLARE
  v_identifier_type text := lower(NULLIF(btrim(p_source_identifier_type), ''));
  v_identifier_ids text[] := ARRAY[]::text[];
  v_primary_ids text[] := ARRAY[]::text[];
  v_variant_ids text[] := ARRAY[]::text[];
  v_alias_ids text[] := ARRAY[]::text[];
  v_name_ids text[] := ARRAY[]::text[];
  v_all_ids text[] := ARRAY[]::text[];
  v_status text := 'unresolved';
  v_method text;
  v_entity_id text := NULL;
  v_prospective_entity_id text := NULL;
  v_actual_entity_type text;
BEGIN
  v_method := CASE
    WHEN p_normalized_identifier_value IS NOT NULL OR p_normalized_entity_value IS NOT NULL
      THEN 'no_exact_match'
    ELSE 'no_usable_identity_value'
  END;

  IF p_normalized_identifier_value IS NOT NULL AND v_identifier_type IS NOT NULL THEN
    IF v_identifier_type = 'canonical_entity_id' THEN
      SELECT COALESCE(array_agg(er.entity_id::text ORDER BY er.entity_id::text), ARRAY[]::text[])
      INTO v_identifier_ids
      FROM atlas.entity_registry er
      WHERE er.is_active IS DISTINCT FROM false
        AND er.entity_id::text = p_normalized_identifier_value;
    ELSE
      SELECT COALESCE(
        array_agg(DISTINCT er.entity_id::text ORDER BY er.entity_id::text),
        ARRAY[]::text[]
      )
      INTO v_identifier_ids
      FROM atlas.entity_registry er
      WHERE er.is_active IS DISTINCT FROM false
        AND (
          public.atlas_normalize_entity_identifier_v1(
            v_identifier_type,
            er.metadata->>v_identifier_type
          ) = p_normalized_identifier_value
          OR (
            atlas.infer_entity_identifier_type_v1(
              er.source_population_table,
              er.source_systems,
              er.metadata,
              er.source_external_id
            ) = v_identifier_type
            AND public.atlas_normalize_entity_identifier_v1(
              v_identifier_type,
              er.source_external_id
            ) = p_normalized_identifier_value
          )
          OR (
            atlas.infer_entity_identifier_type_v1(
              er.source_population_table,
              er.source_systems,
              er.metadata,
              er.source_population_id
            ) = v_identifier_type
            AND public.atlas_normalize_entity_identifier_v1(
              v_identifier_type,
              er.source_population_id
            ) = p_normalized_identifier_value
          )
        );
    END IF;
  END IF;

  IF p_normalized_entity_value IS NOT NULL THEN
    SELECT COALESCE(
      array_agg(DISTINCT er.entity_id::text ORDER BY er.entity_id::text),
      ARRAY[]::text[]
    )
    INTO v_primary_ids
    FROM atlas.entity_registry er
    WHERE er.is_active IS DISTINCT FROM false
      AND public.atlas_normalize_entity_name_v1(er.primary_name) = p_normalized_entity_value;

    SELECT COALESCE(
      array_agg(DISTINCT er.entity_id::text ORDER BY er.entity_id::text),
      ARRAY[]::text[]
    )
    INTO v_variant_ids
    FROM atlas.entity_registry er
    WHERE er.is_active IS DISTINCT FROM false
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(er.name_variants) = 'array' THEN er.name_variants
            ELSE '[]'::jsonb
          END
        ) AS variant(value)
        WHERE public.atlas_normalize_entity_name_v1(
          CASE
            WHEN jsonb_typeof(variant.value) = 'string' THEN variant.value #>> '{}'
            WHEN jsonb_typeof(variant.value) = 'object' THEN COALESCE(
              variant.value->>'name',
              variant.value->>'value',
              variant.value->>'alias'
            )
            ELSE NULL
          END
        ) = p_normalized_entity_value
      );

    SELECT COALESCE(
      array_agg(DISTINCT er.entity_id::text ORDER BY er.entity_id::text),
      ARRAY[]::text[]
    )
    INTO v_alias_ids
    FROM atlas.entity_aliases ea
    JOIN atlas.entity_registry er ON er.entity_id = ea.entity_id
    WHERE er.is_active IS DISTINCT FROM false
      AND ea.alias_type IS DISTINCT FROM 'fuzzy_match'
      AND ea.confidence_score = 1.00
      AND public.atlas_normalize_entity_name_v1(ea.alias_text) = p_normalized_entity_value;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT candidate_id ORDER BY candidate_id), ARRAY[]::text[])
  INTO v_name_ids
  FROM (
    SELECT unnest(v_primary_ids) AS candidate_id
    UNION ALL
    SELECT unnest(v_variant_ids) AS candidate_id
    UNION ALL
    SELECT unnest(v_alias_ids) AS candidate_id
  ) names;

  SELECT COALESCE(array_agg(DISTINCT candidate_id ORDER BY candidate_id), ARRAY[]::text[])
  INTO v_all_ids
  FROM (
    SELECT unnest(v_identifier_ids) AS candidate_id
    UNION ALL
    SELECT unnest(v_name_ids) AS candidate_id
  ) candidates;

  IF cardinality(v_identifier_ids) = 1 THEN
    v_prospective_entity_id := v_identifier_ids[1];
    IF EXISTS (
      SELECT 1
      FROM unnest(v_name_ids) AS name_candidate(name_entity_id)
      WHERE name_entity_id <> v_prospective_entity_id
    ) THEN
      v_status := 'ambiguous';
      v_method := 'identifier_name_conflict';
      v_prospective_entity_id := NULL;
    ELSE
      v_method := CASE
        WHEN v_identifier_type = 'canonical_entity_id' THEN 'exact_canonical_entity_id'
        ELSE 'exact_external_identifier'
      END;
    END IF;
  ELSIF cardinality(v_identifier_ids) > 1 THEN
    v_status := 'ambiguous';
    v_method := 'duplicate_external_identifier';
  ELSIF cardinality(v_name_ids) = 1 THEN
    v_prospective_entity_id := v_name_ids[1];
    v_method := CASE
      WHEN v_prospective_entity_id = ANY(v_primary_ids) THEN 'exact_primary_name'
      WHEN v_prospective_entity_id = ANY(v_variant_ids) THEN 'exact_name_variant'
      ELSE 'exact_alias'
    END;
  ELSIF cardinality(v_name_ids) > 1 THEN
    v_status := 'ambiguous';
    v_method := 'duplicate_exact_name';
  END IF;

  IF v_prospective_entity_id IS NOT NULL THEN
    SELECT er.entity_type
    INTO v_actual_entity_type
    FROM atlas.entity_registry er
    WHERE er.entity_id = v_prospective_entity_id
      AND er.is_active IS DISTINCT FROM false;

    IF atlas.entity_type_compatible_v1(p_expected_entity_type, v_actual_entity_type) THEN
      v_status := 'resolved';
      v_entity_id := v_prospective_entity_id;
    ELSE
      v_status := 'unresolved';
      v_method := 'exact_match_entity_type_mismatch';
      v_entity_id := NULL;
    END IF;
  END IF;

  RETURN QUERY SELECT v_status, v_method, v_entity_id, v_all_ids;
END;
$function$;

REVOKE ALL ON FUNCTION atlas.event_entity_source_system_text_v1(text, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION atlas.infer_entity_identifier_type_v1(text, jsonb, jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION atlas.entity_type_compatible_v1(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION atlas.resolve_signal_event_entity_candidate_exact_v1(text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- Immutable resolution-row guard
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION atlas.guard_signal_event_entity_resolution_immutable_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, atlas, extensions
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'signal-event entity resolutions are immutable and cannot be deleted';
  END IF;

  IF (
    to_jsonb(NEW) - ARRAY['last_run_id', 'last_replayed_at', 'is_current']::text[]
  ) IS DISTINCT FROM (
    to_jsonb(OLD) - ARRAY['last_run_id', 'last_replayed_at', 'is_current']::text[]
  ) THEN
    RAISE EXCEPTION 'canonical signal-event entity resolution fields are immutable';
  END IF;

  RETURN NEW;
END;
$function$;

DO $block$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'signal_event_entity_resolution_immutable_v1'
      AND tgrelid = 'atlas.signal_event_entity_resolution'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER signal_event_entity_resolution_immutable_v1
      BEFORE UPDATE OR DELETE ON atlas.signal_event_entity_resolution
      FOR EACH ROW
      EXECUTE FUNCTION atlas.guard_signal_event_entity_resolution_immutable_v1();
  END IF;
END;
$block$;

-- --------------------------------------------------------------------------
-- Narrow public read contracts. Atlas internal working tables remain private.
-- --------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_atlas_entity_resolution_registry_v1
AS
SELECT
  entity_id,
  entity_type,
  primary_name,
  name_variants,
  source_systems,
  source_population_id,
  source_population_table,
  source_external_id,
  metadata,
  is_active,
  last_verified
FROM atlas.entity_registry
WHERE is_active IS DISTINCT FROM false;

CREATE OR REPLACE VIEW public.v_atlas_entity_resolution_aliases_v1
AS
SELECT
  alias_id,
  entity_id,
  alias_text,
  alias_type,
  source_jurisdiction,
  source_system,
  confidence_score,
  created_at
FROM atlas.entity_aliases
WHERE alias_type IS DISTINCT FROM 'fuzzy_match'
  AND confidence_score = 1.00;

CREATE OR REPLACE VIEW public.v_atlas_signal_event_entity_resolution_v1
AS
SELECT
  r.resolution_id,
  r.stream_id,
  r.event_offset,
  r.event_timestamp,
  r.signal_type,
  r.source_id,
  r.jurisdiction_id,
  r.module_hint,
  r.rule_id,
  r.rule_version,
  r.candidate_key,
  r.entity_role,
  r.source_field,
  r.source_field_value,
  r.source_entity_value,
  r.normalized_entity_value,
  r.source_identifier_field,
  r.source_identifier_type,
  r.source_identifier_value,
  r.normalized_identifier_value,
  r.expected_entity_type,
  r.entity_id,
  er.primary_name AS canonical_entity_name,
  er.entity_type AS canonical_entity_type,
  r.resolution_status,
  r.match_method,
  r.candidate_entity_ids,
  r.match_evidence,
  r.event_input_hash,
  r.entity_index_hash,
  r.rule_manifest_hash,
  r.resolution_hash,
  r.resolver_id,
  r.resolver_version,
  r.first_run_id,
  r.last_run_id,
  r.resolved_at,
  r.last_replayed_at
FROM atlas.signal_event_entity_resolution r
LEFT JOIN atlas.entity_registry er ON er.entity_id = r.entity_id
WHERE r.is_current = true;

CREATE OR REPLACE VIEW public.v_atlas_resolved_signal_event_entities_v1
AS
SELECT
  r.stream_id,
  r.event_offset,
  r.event_timestamp,
  r.signal_type,
  r.source_id,
  r.jurisdiction_id,
  r.module_hint,
  r.entity_role,
  r.entity_id,
  er.primary_name AS canonical_entity_name,
  er.entity_type AS canonical_entity_type,
  r.rule_id,
  r.rule_version,
  r.match_method,
  r.resolution_hash,
  r.resolver_id,
  r.resolver_version,
  r.entity_index_hash,
  se.spacetime,
  se.provenance,
  se.payload
FROM atlas.signal_event_entity_resolution r
JOIN atlas.entity_registry er ON er.entity_id = r.entity_id
JOIN public.signal_events se
  ON se.stream_id = r.stream_id
 AND se.offset = r.event_offset
WHERE r.is_current = true
  AND r.resolution_status = 'resolved';

CREATE OR REPLACE VIEW public.v_atlas_entity_cross_stream_summary_v1
AS
SELECT
  entity_id,
  canonical_entity_name,
  canonical_entity_type,
  count(DISTINCT (stream_id, event_offset)) AS resolved_event_count,
  count(DISTINCT stream_id) AS stream_count,
  array_agg(DISTINCT stream_id ORDER BY stream_id) AS stream_ids,
  count(DISTINCT signal_type) AS signal_type_count,
  array_agg(DISTINCT signal_type ORDER BY signal_type) AS signal_types,
  min(event_timestamp) AS first_event_at,
  max(event_timestamp) AS latest_event_at
FROM public.v_atlas_resolved_signal_event_entities_v1
GROUP BY entity_id, canonical_entity_name, canonical_entity_type;

CREATE OR REPLACE VIEW public.v_atlas_event_entity_resolution_coverage_v1
AS
SELECT
  stream_id,
  resolution_status,
  count(*) AS resolution_count,
  count(DISTINCT (stream_id, event_offset)) AS event_count,
  max(resolved_at) AS latest_resolved_at,
  max(resolver_version) AS latest_resolver_version
FROM atlas.signal_event_entity_resolution
WHERE is_current = true
GROUP BY stream_id, resolution_status;

CREATE OR REPLACE VIEW public.v_atlas_event_entity_resolution_review_v1
AS
SELECT
  encode(
    digest(
      concat_ws(
        chr(31),
        r.resolution_status,
        r.rule_id,
        r.rule_version,
        r.rule_manifest_hash,
        r.entity_role,
        COALESCE(r.normalized_entity_value, ''),
        COALESCE(r.source_identifier_type, ''),
        COALESCE(r.normalized_identifier_value, ''),
        COALESCE(r.expected_entity_type, ''),
        r.resolver_id,
        r.resolver_version,
        r.entity_index_hash
      ),
      'sha256'
    ),
    'hex'
  ) AS review_key,
  r.resolution_status,
  r.rule_id,
  r.rule_version,
  r.entity_role,
  r.expected_entity_type,
  r.normalized_entity_value,
  r.source_identifier_type,
  r.normalized_identifier_value,
  min(r.source_entity_value) FILTER (WHERE r.source_entity_value IS NOT NULL) AS sample_source_entity_value,
  min(r.source_identifier_value) FILTER (WHERE r.source_identifier_value IS NOT NULL) AS sample_source_identifier_value,
  count(DISTINCT (r.stream_id, r.event_offset)) AS event_count,
  count(DISTINCT r.stream_id) AS stream_count,
  array_agg(DISTINCT r.stream_id ORDER BY r.stream_id) AS stream_ids,
  array_agg(DISTINCT r.source_field ORDER BY r.source_field) AS source_fields,
  jsonb_agg(DISTINCT to_jsonb(r.candidate_entity_ids) ORDER BY to_jsonb(r.candidate_entity_ids)) AS candidate_sets,
  min(r.event_timestamp) AS first_event_at,
  max(r.event_timestamp) AS latest_event_at,
  r.rule_manifest_hash,
  r.entity_index_hash,
  r.resolver_id,
  r.resolver_version
FROM atlas.signal_event_entity_resolution r
WHERE r.is_current = true
  AND r.resolution_status IN ('ambiguous', 'unresolved')
GROUP BY
  r.resolution_status,
  r.rule_id,
  r.rule_version,
  r.entity_role,
  r.expected_entity_type,
  r.normalized_entity_value,
  r.source_identifier_type,
  r.normalized_identifier_value,
  r.rule_manifest_hash,
  r.entity_index_hash,
  r.resolver_id,
  r.resolver_version;

COMMENT ON VIEW public.v_atlas_event_entity_resolution_review_v1 IS
  'Read-only deterministic grouping of current ambiguous and unresolved event-entity outcomes. It never creates, merges, aliases, or resolves an entity.';

REVOKE ALL ON public.v_atlas_entity_resolution_registry_v1 FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.v_atlas_entity_resolution_aliases_v1 FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.v_atlas_signal_event_entity_resolution_v1 FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.v_atlas_resolved_signal_event_entities_v1 FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.v_atlas_entity_cross_stream_summary_v1 FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.v_atlas_event_entity_resolution_coverage_v1 FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.v_atlas_event_entity_resolution_review_v1 FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_atlas_entity_resolution_registry_v1 TO service_role;
GRANT SELECT ON public.v_atlas_entity_resolution_aliases_v1 TO service_role;
GRANT SELECT ON public.v_atlas_signal_event_entity_resolution_v1 TO service_role;
GRANT SELECT ON public.v_atlas_resolved_signal_event_entities_v1 TO service_role;
GRANT SELECT ON public.v_atlas_entity_cross_stream_summary_v1 TO service_role;
GRANT SELECT ON public.v_atlas_event_entity_resolution_coverage_v1 TO service_role;
GRANT SELECT ON public.v_atlas_event_entity_resolution_review_v1 TO service_role;

-- --------------------------------------------------------------------------
-- Bounded canonical cross-stream consumers
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fetch_atlas_entity_cross_stream_correlations_v1(
  p_min_streams integer DEFAULT 2,
  p_limit integer DEFAULT 100,
  p_entity_id text DEFAULT NULL
)
RETURNS TABLE (
  entity_id text,
  canonical_entity_name text,
  canonical_entity_type text,
  resolved_event_count bigint,
  stream_count bigint,
  stream_ids text[],
  signal_type_count bigint,
  signal_types text[],
  first_event_at timestamptz,
  latest_event_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO pg_catalog, public, extensions
AS $function$
  SELECT
    summary.entity_id::text,
    summary.canonical_entity_name::text,
    summary.canonical_entity_type::text,
    summary.resolved_event_count,
    summary.stream_count,
    summary.stream_ids,
    summary.signal_type_count,
    summary.signal_types,
    summary.first_event_at,
    summary.latest_event_at
  FROM public.v_atlas_entity_cross_stream_summary_v1 summary
  WHERE summary.stream_count >= GREATEST(2, LEAST(COALESCE(p_min_streams, 2), 1000))
    AND (p_entity_id IS NULL OR summary.entity_id = p_entity_id)
  ORDER BY
    summary.stream_count DESC,
    summary.resolved_event_count DESC,
    summary.latest_event_at DESC,
    summary.entity_id
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 5000));
$function$;

CREATE OR REPLACE FUNCTION public.fetch_atlas_resolved_entity_events_v1(
  p_entity_id text,
  p_limit integer DEFAULT 100,
  p_before_timestamp timestamptz DEFAULT NULL
)
RETURNS TABLE (
  stream_id text,
  event_offset bigint,
  event_timestamp timestamptz,
  signal_type text,
  source_id text,
  jurisdiction_id text,
  module_hint text,
  entity_role text,
  entity_id text,
  canonical_entity_name text,
  canonical_entity_type text,
  rule_id text,
  rule_version text,
  match_method text,
  resolution_hash text,
  resolver_id text,
  resolver_version text,
  entity_index_hash text,
  spacetime jsonb,
  provenance jsonb,
  payload jsonb
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO pg_catalog, public, extensions
AS $function$
  SELECT
    resolved.stream_id,
    resolved.event_offset,
    resolved.event_timestamp,
    resolved.signal_type,
    resolved.source_id,
    resolved.jurisdiction_id,
    resolved.module_hint,
    resolved.entity_role,
    resolved.entity_id::text,
    resolved.canonical_entity_name::text,
    resolved.canonical_entity_type::text,
    resolved.rule_id,
    resolved.rule_version,
    resolved.match_method,
    resolved.resolution_hash,
    resolved.resolver_id,
    resolved.resolver_version,
    resolved.entity_index_hash,
    resolved.spacetime,
    resolved.provenance,
    resolved.payload
  FROM public.v_atlas_resolved_signal_event_entities_v1 resolved
  WHERE COALESCE(btrim(p_entity_id), '') <> ''
    AND resolved.entity_id = p_entity_id
    AND (p_before_timestamp IS NULL OR resolved.event_timestamp < p_before_timestamp)
  ORDER BY resolved.event_timestamp DESC, resolved.stream_id, resolved.event_offset DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 5000));
$function$;

CREATE OR REPLACE FUNCTION public.fetch_atlas_event_entity_resolution_review_v1(
  p_resolution_status text DEFAULT NULL,
  p_min_event_count integer DEFAULT 1,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  review_key text,
  resolution_status text,
  rule_id text,
  rule_version text,
  entity_role text,
  expected_entity_type text,
  normalized_entity_value text,
  source_identifier_type text,
  normalized_identifier_value text,
  sample_source_entity_value text,
  sample_source_identifier_value text,
  event_count bigint,
  stream_count bigint,
  stream_ids text[],
  source_fields text[],
  candidate_sets jsonb,
  first_event_at timestamptz,
  latest_event_at timestamptz,
  rule_manifest_hash text,
  entity_index_hash text,
  resolver_id text,
  resolver_version text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO pg_catalog, public, extensions
AS $function$
  SELECT
    review.review_key,
    review.resolution_status,
    review.rule_id,
    review.rule_version,
    review.entity_role,
    review.expected_entity_type,
    review.normalized_entity_value,
    review.source_identifier_type,
    review.normalized_identifier_value,
    review.sample_source_entity_value,
    review.sample_source_identifier_value,
    review.event_count,
    review.stream_count,
    review.stream_ids,
    review.source_fields,
    review.candidate_sets,
    review.first_event_at,
    review.latest_event_at,
    review.rule_manifest_hash,
    review.entity_index_hash,
    review.resolver_id,
    review.resolver_version
  FROM public.v_atlas_event_entity_resolution_review_v1 review
  WHERE (
      p_resolution_status IS NULL
      OR (
        p_resolution_status IN ('ambiguous', 'unresolved')
        AND review.resolution_status = p_resolution_status
      )
    )
    AND review.event_count >= GREATEST(1, COALESCE(p_min_event_count, 1))
  ORDER BY
    review.event_count DESC,
    review.stream_count DESC,
    review.latest_event_at DESC,
    review.review_key
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 5000));
$function$;

REVOKE ALL ON FUNCTION public.fetch_atlas_entity_cross_stream_correlations_v1(integer, integer, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fetch_atlas_resolved_entity_events_v1(text, integer, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fetch_atlas_event_entity_resolution_review_v1(text, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fetch_atlas_entity_cross_stream_correlations_v1(integer, integer, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fetch_atlas_resolved_entity_events_v1(text, integer, timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fetch_atlas_event_entity_resolution_review_v1(text, integer, integer)
  TO service_role;

-- --------------------------------------------------------------------------
-- Bounded event reader
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fetch_atlas_signal_events_for_entity_resolution_v1(
  p_batch_size integer DEFAULT 500,
  p_stream_id text DEFAULT NULL,
  p_after_stream_id text DEFAULT NULL,
  p_after_offset bigint DEFAULT -1
)
RETURNS TABLE (
  stream_id text,
  offset bigint,
  "timestamp" timestamptz,
  signal_type text,
  spacetime jsonb,
  provenance jsonb,
  payload jsonb,
  source_id text,
  jurisdiction_id text,
  module_hint text,
  ingested_at timestamptz,
  event_input_hash text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO pg_catalog, public, extensions
AS $function$
  SELECT
    se.stream_id,
    se.offset,
    se."timestamp",
    se.signal_type,
    se.spacetime,
    se.provenance,
    se.payload,
    se.source_id,
    se.jurisdiction_id,
    se.module_hint,
    se.ingested_at,
    public.atlas_signal_event_input_hash_v1(
      se.stream_id,
      se.offset,
      se."timestamp",
      se.signal_type,
      se.spacetime,
      se.provenance,
      se.payload,
      se.source_id,
      se.jurisdiction_id,
      se.module_hint,
      se.ingested_at
    ) AS event_input_hash
  FROM public.signal_events se
  WHERE (p_stream_id IS NULL OR se.stream_id = p_stream_id)
    AND (
      p_after_stream_id IS NULL
      OR (se.stream_id, se.offset) > (p_after_stream_id, COALESCE(p_after_offset, -1))
    )
  ORDER BY se.stream_id, se.offset
  LIMIT GREATEST(1, LEAST(COALESCE(p_batch_size, 500), 5000));
$function$;

REVOKE ALL ON FUNCTION public.fetch_atlas_signal_events_for_entity_resolution_v1(integer, text, text, bigint)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fetch_atlas_signal_events_for_entity_resolution_v1(integer, text, text, bigint)
  TO service_role;

-- --------------------------------------------------------------------------
-- Run lifecycle
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.start_atlas_event_entity_resolution_run_v1(
  p_run_id uuid,
  p_resolver_id text,
  p_resolver_version text,
  p_rule_manifest_hash text,
  p_entity_index_hash text,
  p_stream_id text,
  p_batch_size integer,
  p_input_manifest jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public, atlas, extensions
AS $function$
DECLARE
  v_manifest jsonb := COALESCE(p_input_manifest, '{}'::jsonb);
  v_manifest_hash text;
  v_rule_count integer;
  v_supplied_rule_count integer;
  v_existing atlas.signal_event_entity_resolution_run%ROWTYPE;
BEGIN
  IF p_run_id IS NULL THEN
    RAISE EXCEPTION 'p_run_id is required';
  END IF;
  IF COALESCE(btrim(p_resolver_id), '') = '' OR COALESCE(btrim(p_resolver_version), '') = '' THEN
    RAISE EXCEPTION 'resolver id and version are required';
  END IF;
  IF p_rule_manifest_hash !~ '^[0-9a-f]{64}$' OR p_entity_index_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'rule manifest hash and entity index hash must be lowercase SHA-256 values';
  END IF;
  IF p_batch_size < 1 OR p_batch_size > 5000 THEN
    RAISE EXCEPTION 'batch size must be between 1 and 5000';
  END IF;
  IF v_manifest->>'rule_manifest_hash' IS DISTINCT FROM p_rule_manifest_hash
     OR v_manifest->>'entity_index_hash' IS DISTINCT FROM p_entity_index_hash THEN
    RAISE EXCEPTION 'input manifest hashes do not match declared run hashes';
  END IF;
  IF v_manifest->>'resolver_id' IS DISTINCT FROM p_resolver_id
     OR v_manifest->>'resolver_version' IS DISTINCT FROM p_resolver_version THEN
    RAISE EXCEPTION 'input manifest resolver identity does not match declared run identity';
  END IF;
  IF COALESCE((v_manifest->>'no_fuzzy_matching')::boolean, false) IS DISTINCT FROM true
     OR COALESCE((v_manifest->>'no_silent_entity_creation')::boolean, false) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'input manifest must lock no-fuzzy and no-silent-entity-creation guarantees';
  END IF;

  SELECT count(*) INTO v_rule_count
  FROM atlas.signal_event_entity_resolution_rule
  WHERE is_active = true
    AND rule_manifest_hash = p_rule_manifest_hash;

  IF v_rule_count = 0 THEN
    RAISE EXCEPTION 'rule manifest % is not active in Atlas', p_rule_manifest_hash;
  END IF;
  IF COALESCE(v_manifest->>'rule_count', '') !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'input manifest rule_count is required';
  END IF;
  v_supplied_rule_count := (v_manifest->>'rule_count')::integer;
  IF v_supplied_rule_count <> v_rule_count THEN
    RAISE EXCEPTION 'input manifest rule_count % does not match active rule count %',
      v_supplied_rule_count, v_rule_count;
  END IF;
  IF jsonb_typeof(v_manifest->'rule_ids') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'input manifest rule_ids must be a JSON array';
  END IF;
  IF (
    SELECT count(*)
    FROM jsonb_array_elements_text(v_manifest->'rule_ids') supplied(rule_id)
  ) <> v_rule_count
  OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(v_manifest->'rule_ids') supplied(rule_id)
    LEFT JOIN atlas.signal_event_entity_resolution_rule r
      ON r.rule_id = supplied.rule_id
     AND r.is_active = true
     AND r.rule_manifest_hash = p_rule_manifest_hash
    WHERE r.rule_id IS NULL
  )
  OR EXISTS (
    SELECT 1
    FROM atlas.signal_event_entity_resolution_rule r
    WHERE r.is_active = true
      AND r.rule_manifest_hash = p_rule_manifest_hash
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(v_manifest->'rule_ids') supplied(rule_id)
        WHERE supplied.rule_id = r.rule_id
      )
  ) THEN
    RAISE EXCEPTION 'input manifest rule_ids do not equal the active locked rule set';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM atlas.signal_event_entity_resolution_run prior
    WHERE prior.resolver_id = p_resolver_id
      AND prior.resolver_version = p_resolver_version
      AND prior.rule_manifest_hash <> p_rule_manifest_hash
  ) THEN
    RAISE EXCEPTION 'resolver % version % has changed rule manifest; increment resolver version',
      p_resolver_id, p_resolver_version;
  END IF;

  v_manifest_hash := encode(digest(v_manifest::text, 'sha256'), 'hex');

  SELECT * INTO v_existing
  FROM atlas.signal_event_entity_resolution_run
  WHERE run_id = p_run_id;

  IF FOUND THEN
    IF v_existing.resolver_id <> p_resolver_id
       OR v_existing.resolver_version <> p_resolver_version
       OR v_existing.rule_manifest_hash <> p_rule_manifest_hash
       OR v_existing.entity_index_hash <> p_entity_index_hash
       OR v_existing.manifest_hash <> v_manifest_hash THEN
      RAISE EXCEPTION 'run id % already exists with a different deterministic manifest', p_run_id;
    END IF;
    RETURN jsonb_build_object(
      'run_id', p_run_id,
      'status', v_existing.status,
      'idempotent', true,
      'manifest_hash', v_existing.manifest_hash
    );
  END IF;

  INSERT INTO atlas.signal_event_entity_resolution_run (
    run_id,
    resolver_id,
    resolver_version,
    rule_manifest_hash,
    entity_index_hash,
    status,
    stream_id,
    batch_size,
    input_manifest,
    manifest_hash
  ) VALUES (
    p_run_id,
    p_resolver_id,
    p_resolver_version,
    p_rule_manifest_hash,
    p_entity_index_hash,
    'running',
    p_stream_id,
    p_batch_size,
    v_manifest,
    v_manifest_hash
  );

  RETURN jsonb_build_object(
    'run_id', p_run_id,
    'status', 'running',
    'idempotent', false,
    'manifest_hash', v_manifest_hash
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.persist_atlas_event_entity_resolution_batch_v1(
  p_run_id uuid,
  p_resolver_id text,
  p_resolver_version text,
  p_rule_manifest_hash text,
  p_entity_index_hash text,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public, atlas, extensions
AS $function$
DECLARE
  v_run atlas.signal_event_entity_resolution_run%ROWTYPE;
  v_rule atlas.signal_event_entity_resolution_rule%ROWTYPE;
  v_row jsonb;
  v_event public.signal_events%ROWTYPE;
  v_stream_id text;
  v_event_offset bigint;
  v_rule_id text;
  v_rule_version text;
  v_candidate_key text;
  v_expected_candidate_key text;
  v_entity_role text;
  v_source_field text;
  v_source_field_value text;
  v_source_identifier_field text;
  v_source_identifier_type text;
  v_source_identifier_value text;
  v_actual_source_field_value text;
  v_actual_identifier_field_value text;
  v_expected_source_entity_value text;
  v_expected_normalized_entity_value text;
  v_expected_normalized_identifier_value text;
  v_source_field_allowed boolean;
  v_status text;
  v_entity_id text;
  v_candidate_ids text[];
  v_verified_status text;
  v_verified_match_method text;
  v_verified_entity_id text;
  v_verified_candidate_ids text[];
  v_event_hash text;
  v_expected_hash text;
  v_supplied_hash text;
  v_existing_hash text;
  v_inserted integer := 0;
  v_idempotent integer := 0;
  v_row_count integer := 0;
  v_batch_event_count integer := 0;
  v_resolved integer := 0;
  v_ambiguous integer := 0;
  v_unresolved integer := 0;
  v_ignored integer := 0;
BEGIN
  SELECT * INTO v_run
  FROM atlas.signal_event_entity_resolution_run
  WHERE run_id = p_run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'resolution run not found: %', p_run_id;
  END IF;
  IF v_run.status <> 'running' THEN
    RAISE EXCEPTION 'resolution run % is %, not running', p_run_id, v_run.status;
  END IF;
  IF v_run.resolver_id <> p_resolver_id
     OR v_run.resolver_version <> p_resolver_version
     OR v_run.rule_manifest_hash <> p_rule_manifest_hash
     OR v_run.entity_index_hash <> p_entity_index_hash THEN
    RAISE EXCEPTION 'resolver or input-state contract mismatch for run %', p_run_id;
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be a JSON array';
  END IF;
  IF jsonb_array_length(p_rows) > 10000 THEN
    RAISE EXCEPTION 'p_rows exceeds 10000-row safety bound';
  END IF;

  SELECT count(*) INTO v_batch_event_count
  FROM (
    SELECT DISTINCT value->>'stream_id' AS stream_id, value->>'event_offset' AS event_offset
    FROM jsonb_array_elements(p_rows)
  ) events;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    v_row_count := v_row_count + 1;
    v_stream_id := v_row->>'stream_id';
    v_event_offset := (v_row->>'event_offset')::bigint;
    v_rule_id := v_row->>'rule_id';
    v_rule_version := v_row->>'rule_version';
    v_candidate_key := v_row->>'candidate_key';
    v_entity_role := v_row->>'entity_role';
    v_source_field := v_row->>'source_field';
    v_source_field_value := v_row->>'source_field_value';
    v_source_identifier_field := NULLIF(v_row->>'source_identifier_field', '');
    v_source_identifier_type := NULLIF(v_row->>'source_identifier_type', '');
    v_source_identifier_value := v_row->>'source_identifier_value';
    v_status := v_row->>'resolution_status';
    v_entity_id := NULLIF(v_row->>'entity_id', '');
    v_supplied_hash := v_row->>'resolution_hash';

    IF COALESCE(v_stream_id, '') = ''
       OR COALESCE(v_rule_id, '') = ''
       OR COALESCE(v_rule_version, '') = ''
       OR COALESCE(v_entity_role, '') = ''
       OR COALESCE(v_source_field, '') = '' THEN
      RAISE EXCEPTION 'resolution row is missing event, rule, or source-field identity: %', v_row;
    END IF;
    IF v_candidate_key !~ '^[0-9a-f]{64}$' OR v_supplied_hash !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'candidate key and resolution hash must be lowercase SHA-256 values';
    END IF;
    IF v_row->>'rule_manifest_hash' IS DISTINCT FROM p_rule_manifest_hash
       OR v_row->>'entity_index_hash' IS DISTINCT FROM p_entity_index_hash THEN
      RAISE EXCEPTION 'resolution row input-state hashes do not match run %', p_run_id;
    END IF;
    IF v_row->>'resolver_id' IS DISTINCT FROM p_resolver_id
       OR v_row->>'resolver_version' IS DISTINCT FROM p_resolver_version THEN
      RAISE EXCEPTION 'resolution row resolver identity does not match run %', p_run_id;
    END IF;
    IF v_status NOT IN ('resolved', 'ambiguous', 'unresolved', 'ignored') THEN
      RAISE EXCEPTION 'invalid resolution status: %', v_status;
    END IF;
    IF COALESCE(v_row->>'match_method', '') = '' THEN
      RAISE EXCEPTION 'match_method is required';
    END IF;
    IF v_status = 'resolved' AND v_entity_id IS NULL THEN
      RAISE EXCEPTION 'resolved row must contain entity_id for %:%', v_stream_id, v_event_offset;
    END IF;
    IF v_status <> 'resolved' AND v_entity_id IS NOT NULL THEN
      RAISE EXCEPTION 'non-resolved row cannot contain entity_id for %:%', v_stream_id, v_event_offset;
    END IF;

    SELECT * INTO v_event
    FROM public.signal_events
    WHERE stream_id = v_stream_id AND offset = v_event_offset;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'signal event not found: %:%', v_stream_id, v_event_offset;
    END IF;

    SELECT * INTO v_rule
    FROM atlas.signal_event_entity_resolution_rule
    WHERE rule_id = v_rule_id
      AND rule_version = v_rule_version
      AND is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'active event-entity rule not found: % version %', v_rule_id, v_rule_version;
    END IF;
    IF v_rule.rule_manifest_hash <> p_rule_manifest_hash THEN
      RAISE EXCEPTION 'rule % version % is not part of run manifest %',
        v_rule_id, v_rule_version, p_rule_manifest_hash;
    END IF;
    IF v_rule.stream_id <> '*' AND v_rule.stream_id <> v_event.stream_id THEN
      RAISE EXCEPTION 'rule % does not apply to stream %', v_rule_id, v_event.stream_id;
    END IF;
    IF NOT ('*' = ANY(v_rule.signal_types) OR v_event.signal_type = ANY(v_rule.signal_types)) THEN
      RAISE EXCEPTION 'rule % does not apply to signal type %', v_rule_id, v_event.signal_type;
    END IF;
    IF v_entity_role IS DISTINCT FROM v_rule.entity_role THEN
      RAISE EXCEPTION 'entity role % does not match locked rule role % for %',
        v_entity_role, v_rule.entity_role, v_rule_id;
    END IF;
    IF NULLIF(v_row->>'expected_entity_type', '') IS DISTINCT FROM v_rule.expected_entity_type THEN
      RAISE EXCEPTION 'expected entity type does not match locked rule %', v_rule_id;
    END IF;

    v_source_field_allowed := (
      v_source_field = ANY(v_rule.name_fields)
      OR (
        'payload.sponsors[*]' = ANY(v_rule.name_fields)
        AND v_source_field ~ '^payload\.sponsors\[[0-9]+\](\.(name|full_name|sponsor_name))?$'
      )
      OR (
        v_source_field = '__none__'
        AND v_rule.transform IN ('exact_canonical_entity_id', 'explicit_ignored_outcome')
      )
    );
    IF v_source_field_allowed IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'source field % is not allowed by rule %', v_source_field, v_rule_id;
    END IF;
    IF v_source_field <> '__none__' AND v_source_field_value IS NULL THEN
      RAISE EXCEPTION 'declared source field % has no preserved source value for %:%',
        v_source_field, v_stream_id, v_event_offset;
    END IF;
    IF v_source_field = '__none__' AND v_source_field_value IS NOT NULL THEN
      RAISE EXCEPTION '__none__ source field cannot carry a source value for %:%',
        v_stream_id, v_event_offset;
    END IF;

    IF v_source_identifier_field IS NOT NULL
       AND NOT (v_source_identifier_field = ANY(v_rule.identifier_fields)) THEN
      RAISE EXCEPTION 'identifier field % is not allowed by rule %',
        v_source_identifier_field, v_rule_id;
    END IF;
    IF v_source_identifier_type IS NOT NULL
       AND NOT (v_source_identifier_type = ANY(v_rule.exact_identifier_types)) THEN
      RAISE EXCEPTION 'identifier type % is not allowed by rule %',
        v_source_identifier_type, v_rule_id;
    END IF;
    IF v_source_identifier_field IS NULL AND v_source_identifier_value IS NOT NULL THEN
      RAISE EXCEPTION 'identifier value cannot exist without an identifier source field for %:%',
        v_stream_id, v_event_offset;
    END IF;
    IF v_source_identifier_field IS NOT NULL AND v_source_identifier_type IS NULL THEN
      RAISE EXCEPTION 'identifier source field requires an identifier type for %:%',
        v_stream_id, v_event_offset;
    END IF;
    IF v_source_identifier_field IS NOT NULL AND v_source_identifier_value IS NULL THEN
      RAISE EXCEPTION 'identifier source field requires its exact preserved source value for %:%',
        v_stream_id, v_event_offset;
    END IF;
    IF lower(v_row->>'match_method') LIKE '%fuzzy%' THEN
      RAISE EXCEPTION 'fuzzy match methods are forbidden';
    END IF;
    IF v_rule.transform = 'explicit_ignored_outcome' AND v_status <> 'ignored' THEN
      RAISE EXCEPTION 'no-entity rule must produce ignored outcome';
    END IF;
    IF v_rule.transform <> 'explicit_ignored_outcome' AND v_status = 'ignored' THEN
      RAISE EXCEPTION 'only the no-entity rule may produce ignored outcome';
    END IF;

    v_event_hash := public.atlas_signal_event_input_hash_v1(
      v_event.stream_id,
      v_event.offset,
      v_event."timestamp",
      v_event.signal_type,
      v_event.spacetime,
      v_event.provenance,
      v_event.payload,
      v_event.source_id,
      v_event.jurisdiction_id,
      v_event.module_hint,
      v_event.ingested_at
    );

    IF v_event_hash <> v_row->>'event_input_hash' THEN
      RAISE EXCEPTION 'event input hash mismatch for %:%', v_stream_id, v_event_offset;
    END IF;

    v_actual_source_field_value := public.atlas_event_payload_field_text_v1(
      v_event.payload,
      v_source_field
    );
    IF v_actual_source_field_value IS DISTINCT FROM v_source_field_value THEN
      RAISE EXCEPTION 'source field provenance mismatch for %:% field %',
        v_stream_id, v_event_offset, v_source_field;
    END IF;

    v_expected_source_entity_value := public.atlas_event_entity_source_value_v1(
      v_rule_id,
      v_source_field,
      v_actual_source_field_value
    );
    IF v_expected_source_entity_value IS DISTINCT FROM NULLIF(v_row->>'source_entity_value', '') THEN
      RAISE EXCEPTION 'source entity extraction mismatch for %:% rule % field %',
        v_stream_id, v_event_offset, v_rule_id, v_source_field;
    END IF;

    v_expected_normalized_entity_value := public.atlas_normalize_entity_name_v1(
      v_expected_source_entity_value
    );
    IF v_expected_normalized_entity_value IS DISTINCT FROM NULLIF(v_row->>'normalized_entity_value', '') THEN
      RAISE EXCEPTION 'normalized entity value mismatch for %:% rule %',
        v_stream_id, v_event_offset, v_rule_id;
    END IF;

    IF v_source_identifier_field IS NOT NULL THEN
      v_actual_identifier_field_value := public.atlas_event_payload_field_text_v1(
        v_event.payload,
        v_source_identifier_field
      );
      IF v_actual_identifier_field_value IS DISTINCT FROM v_source_identifier_value THEN
        RAISE EXCEPTION 'identifier field provenance mismatch for %:% field %',
          v_stream_id, v_event_offset, v_source_identifier_field;
      END IF;
    ELSE
      v_actual_identifier_field_value := NULL;
    END IF;

    v_expected_normalized_identifier_value := public.atlas_normalize_entity_identifier_v1(
      v_source_identifier_type,
      v_actual_identifier_field_value
    );
    IF v_expected_normalized_identifier_value IS DISTINCT FROM NULLIF(v_row->>'normalized_identifier_value', '') THEN
      RAISE EXCEPTION 'normalized identifier value mismatch for %:% rule %',
        v_stream_id, v_event_offset, v_rule_id;
    END IF;

    v_expected_candidate_key := public.atlas_event_entity_candidate_key_v1(
      v_rule_id,
      v_rule_version,
      v_entity_role,
      v_source_field,
      NULLIF(v_row->>'normalized_entity_value', ''),
      NULLIF(v_row->>'source_identifier_field', ''),
      NULLIF(v_row->>'source_identifier_type', ''),
      NULLIF(v_row->>'normalized_identifier_value', ''),
      NULLIF(v_row->>'expected_entity_type', '')
    );

    IF v_expected_candidate_key <> v_candidate_key THEN
      RAISE EXCEPTION 'candidate key mismatch for %:% %/%',
        v_stream_id, v_event_offset, v_entity_role, v_source_field;
    END IF;

    SELECT COALESCE(array_agg(DISTINCT candidate_id ORDER BY candidate_id), ARRAY[]::text[])
    INTO v_candidate_ids
    FROM jsonb_array_elements_text(COALESCE(v_row->'candidate_entity_ids', '[]'::jsonb)) AS candidate(candidate_id);

    IF v_status = 'ambiguous' AND cardinality(v_candidate_ids) < 2 THEN
      RAISE EXCEPTION 'ambiguous row requires at least two candidates for %:%', v_stream_id, v_event_offset;
    END IF;
    IF v_status = 'resolved' AND NOT (v_entity_id = ANY(v_candidate_ids)) THEN
      RAISE EXCEPTION 'resolved entity must be included in candidate set for %:%', v_stream_id, v_event_offset;
    END IF;

    IF v_entity_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM atlas.entity_registry
      WHERE entity_id = v_entity_id
        AND is_active IS DISTINCT FROM false
    ) THEN
      RAISE EXCEPTION 'resolved entity does not exist or is inactive: %', v_entity_id;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM unnest(v_candidate_ids) AS candidate(candidate_id)
      WHERE NOT EXISTS (
        SELECT 1
        FROM atlas.entity_registry er
        WHERE er.entity_id = candidate_id
          AND er.is_active IS DISTINCT FROM false
      )
    ) THEN
      RAISE EXCEPTION 'candidate entity set contains an unknown or inactive entity for %:%',
        v_stream_id, v_event_offset;
    END IF;

    IF v_rule.transform = 'explicit_ignored_outcome' THEN
      v_verified_status := 'ignored';
      v_verified_match_method := 'no_declared_entity_rule';
      v_verified_entity_id := NULL;
      v_verified_candidate_ids := ARRAY[]::text[];
    ELSE
      SELECT
        expected_resolution_status,
        expected_match_method,
        expected_entity_id,
        expected_candidate_entity_ids
      INTO
        v_verified_status,
        v_verified_match_method,
        v_verified_entity_id,
        v_verified_candidate_ids
      FROM atlas.resolve_signal_event_entity_candidate_exact_v1(
        NULLIF(v_row->>'normalized_entity_value', ''),
        NULLIF(v_row->>'source_identifier_type', ''),
        NULLIF(v_row->>'normalized_identifier_value', ''),
        NULLIF(v_row->>'expected_entity_type', '')
      );
    END IF;

    IF v_verified_status IS DISTINCT FROM v_status
       OR v_verified_match_method IS DISTINCT FROM v_row->>'match_method'
       OR v_verified_entity_id IS DISTINCT FROM v_entity_id
       OR v_verified_candidate_ids IS DISTINCT FROM v_candidate_ids THEN
      RAISE EXCEPTION 'SQL exact-match recomputation mismatch for %:% rule %: supplied status/method/entity/candidates %/%/%/% expected %/%/%/%',
        v_stream_id,
        v_event_offset,
        v_rule_id,
        v_status,
        v_row->>'match_method',
        v_entity_id,
        v_candidate_ids,
        v_verified_status,
        v_verified_match_method,
        v_verified_entity_id,
        v_verified_candidate_ids;
    END IF;

    v_expected_hash := public.atlas_event_entity_resolution_hash_v1(
      v_event_hash,
      p_entity_index_hash,
      p_rule_manifest_hash,
      v_rule_id,
      v_rule_version,
      v_candidate_key,
      v_entity_role,
      v_source_field,
      NULLIF(v_row->>'normalized_entity_value', ''),
      NULLIF(v_row->>'source_identifier_field', ''),
      NULLIF(v_row->>'source_identifier_type', ''),
      NULLIF(v_row->>'normalized_identifier_value', ''),
      NULLIF(v_row->>'expected_entity_type', ''),
      v_status,
      v_entity_id,
      v_row->>'match_method',
      v_candidate_ids,
      p_resolver_id,
      p_resolver_version
    );

    IF v_expected_hash <> v_supplied_hash THEN
      RAISE EXCEPTION 'resolution hash mismatch for %:% %/%',
        v_stream_id, v_event_offset, v_entity_role, v_source_field;
    END IF;

    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        concat_ws(
          chr(31),
          v_stream_id,
          v_event_offset::text,
          v_candidate_key,
          p_resolver_id,
          p_resolver_version,
          p_entity_index_hash
        ),
        0
      )
    );

    SELECT resolution_hash INTO v_existing_hash
    FROM atlas.signal_event_entity_resolution
    WHERE stream_id = v_stream_id
      AND event_offset = v_event_offset
      AND candidate_key = v_candidate_key
      AND resolver_id = p_resolver_id
      AND resolver_version = p_resolver_version
      AND entity_index_hash = p_entity_index_hash;

    IF FOUND THEN
      IF v_existing_hash <> v_expected_hash THEN
        RAISE EXCEPTION 'deterministic replay violation for %:% candidate % resolver % % input %',
          v_stream_id,
          v_event_offset,
          v_candidate_key,
          p_resolver_id,
          p_resolver_version,
          p_entity_index_hash;
      END IF;

      UPDATE atlas.signal_event_entity_resolution
      SET last_run_id = p_run_id,
          last_replayed_at = now()
      WHERE stream_id = v_stream_id
        AND event_offset = v_event_offset
        AND candidate_key = v_candidate_key
        AND resolver_id = p_resolver_id
        AND resolver_version = p_resolver_version
        AND entity_index_hash = p_entity_index_hash;

      v_idempotent := v_idempotent + 1;
    ELSE
      UPDATE atlas.signal_event_entity_resolution
      SET is_current = false
      WHERE stream_id = v_stream_id
        AND event_offset = v_event_offset
        AND candidate_key = v_candidate_key
        AND resolver_id = p_resolver_id
        AND is_current = true;

      INSERT INTO atlas.signal_event_entity_resolution (
        stream_id,
        event_offset,
        event_timestamp,
        signal_type,
        source_id,
        jurisdiction_id,
        module_hint,
        rule_id,
        rule_version,
        candidate_key,
        entity_role,
        source_field,
        source_field_value,
        source_entity_value,
        normalized_entity_value,
        source_identifier_field,
        source_identifier_type,
        source_identifier_value,
        normalized_identifier_value,
        expected_entity_type,
        entity_id,
        resolution_status,
        match_method,
        candidate_entity_ids,
        match_evidence,
        event_input_hash,
        entity_index_hash,
        rule_manifest_hash,
        resolution_hash,
        resolver_id,
        resolver_version,
        first_run_id,
        last_run_id,
        is_current
      ) VALUES (
        v_stream_id,
        v_event_offset,
        v_event."timestamp",
        v_event.signal_type,
        v_event.source_id,
        v_event.jurisdiction_id,
        v_event.module_hint,
        v_rule_id,
        v_rule_version,
        v_candidate_key,
        v_entity_role,
        v_source_field,
        v_source_field_value,
        NULLIF(v_row->>'source_entity_value', ''),
        NULLIF(v_row->>'normalized_entity_value', ''),
        NULLIF(v_row->>'source_identifier_field', ''),
        NULLIF(v_row->>'source_identifier_type', ''),
        NULLIF(v_row->>'source_identifier_value', ''),
        NULLIF(v_row->>'normalized_identifier_value', ''),
        NULLIF(v_row->>'expected_entity_type', ''),
        v_entity_id,
        v_status,
        v_row->>'match_method',
        v_candidate_ids::varchar(128)[],
        COALESCE(v_row->'match_evidence', '{}'::jsonb),
        v_event_hash,
        p_entity_index_hash,
        p_rule_manifest_hash,
        v_expected_hash,
        p_resolver_id,
        p_resolver_version,
        p_run_id,
        p_run_id,
        true
      );

      v_inserted := v_inserted + 1;
    END IF;

    CASE v_status
      WHEN 'resolved' THEN v_resolved := v_resolved + 1;
      WHEN 'ambiguous' THEN v_ambiguous := v_ambiguous + 1;
      WHEN 'unresolved' THEN v_unresolved := v_unresolved + 1;
      WHEN 'ignored' THEN v_ignored := v_ignored + 1;
    END CASE;
  END LOOP;

  UPDATE atlas.signal_event_entity_resolution_run
  SET processed_event_count = processed_event_count + v_batch_event_count,
      resolution_row_count = resolution_row_count + v_row_count,
      resolved_count = resolved_count + v_resolved,
      ambiguous_count = ambiguous_count + v_ambiguous,
      unresolved_count = unresolved_count + v_unresolved,
      ignored_count = ignored_count + v_ignored,
      inserted_count = inserted_count + v_inserted,
      idempotent_count = idempotent_count + v_idempotent
  WHERE run_id = p_run_id;

  RETURN jsonb_build_object(
    'run_id', p_run_id,
    'batch_event_count', v_batch_event_count,
    'resolution_row_count', v_row_count,
    'resolved_count', v_resolved,
    'ambiguous_count', v_ambiguous,
    'unresolved_count', v_unresolved,
    'ignored_count', v_ignored,
    'inserted_count', v_inserted,
    'idempotent_count', v_idempotent
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_atlas_event_entity_resolution_run_v1(
  p_run_id uuid,
  p_status text,
  p_counts jsonb DEFAULT '{}'::jsonb,
  p_last_stream_id text DEFAULT NULL,
  p_last_offset bigint DEFAULT NULL,
  p_error_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public, atlas, extensions
AS $function$
DECLARE
  v_run atlas.signal_event_entity_resolution_run%ROWTYPE;
BEGIN
  IF p_status NOT IN ('completed', 'partial', 'failed') THEN
    RAISE EXCEPTION 'completion status must be completed, partial, or failed';
  END IF;

  SELECT * INTO v_run
  FROM atlas.signal_event_entity_resolution_run
  WHERE run_id = p_run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'resolution run not found: %', p_run_id;
  END IF;

  IF v_run.status <> 'running' THEN
    IF v_run.status = p_status THEN
      RETURN jsonb_build_object(
        'run_id', v_run.run_id,
        'status', v_run.status,
        'idempotent', true,
        'processed_event_count', v_run.processed_event_count,
        'resolution_row_count', v_run.resolution_row_count,
        'last_stream_id', v_run.last_stream_id,
        'last_offset', v_run.last_offset,
        'completed_at', v_run.completed_at,
        'error_message', v_run.error_message
      );
    END IF;
    RAISE EXCEPTION 'run % is already %, cannot complete as %', p_run_id, v_run.status, p_status;
  END IF;

  IF p_counts ? 'processed_event_count'
     AND (p_counts->>'processed_event_count')::bigint <> v_run.processed_event_count THEN
    RAISE EXCEPTION 'processed event count mismatch for run %', p_run_id;
  END IF;
  IF p_counts ? 'resolution_row_count'
     AND (p_counts->>'resolution_row_count')::bigint <> v_run.resolution_row_count THEN
    RAISE EXCEPTION 'resolution row count mismatch for run %', p_run_id;
  END IF;
  IF p_counts ? 'resolved_count'
     AND (p_counts->>'resolved_count')::bigint <> v_run.resolved_count THEN
    RAISE EXCEPTION 'resolved count mismatch for run %', p_run_id;
  END IF;
  IF p_counts ? 'ambiguous_count'
     AND (p_counts->>'ambiguous_count')::bigint <> v_run.ambiguous_count THEN
    RAISE EXCEPTION 'ambiguous count mismatch for run %', p_run_id;
  END IF;
  IF p_counts ? 'unresolved_count'
     AND (p_counts->>'unresolved_count')::bigint <> v_run.unresolved_count THEN
    RAISE EXCEPTION 'unresolved count mismatch for run %', p_run_id;
  END IF;
  IF p_counts ? 'ignored_count'
     AND (p_counts->>'ignored_count')::bigint <> v_run.ignored_count THEN
    RAISE EXCEPTION 'ignored count mismatch for run %', p_run_id;
  END IF;
  IF p_counts ? 'inserted_count'
     AND (p_counts->>'inserted_count')::bigint <> v_run.inserted_count THEN
    RAISE EXCEPTION 'inserted count mismatch for run %', p_run_id;
  END IF;
  IF p_counts ? 'idempotent_count'
     AND (p_counts->>'idempotent_count')::bigint <> v_run.idempotent_count THEN
    RAISE EXCEPTION 'idempotent count mismatch for run %', p_run_id;
  END IF;

  UPDATE atlas.signal_event_entity_resolution_run
  SET status = p_status,
      last_stream_id = p_last_stream_id,
      last_offset = p_last_offset,
      error_message = p_error_message,
      completed_at = now()
  WHERE run_id = p_run_id
  RETURNING * INTO v_run;

  RETURN jsonb_build_object(
    'run_id', v_run.run_id,
    'status', v_run.status,
    'idempotent', false,
    'processed_event_count', v_run.processed_event_count,
    'resolution_row_count', v_run.resolution_row_count,
    'resolved_count', v_run.resolved_count,
    'ambiguous_count', v_run.ambiguous_count,
    'unresolved_count', v_run.unresolved_count,
    'ignored_count', v_run.ignored_count,
    'inserted_count', v_run.inserted_count,
    'idempotent_count', v_run.idempotent_count,
    'last_stream_id', v_run.last_stream_id,
    'last_offset', v_run.last_offset,
    'completed_at', v_run.completed_at,
    'error_message', v_run.error_message
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.start_atlas_event_entity_resolution_run_v1(uuid, text, text, text, text, text, integer, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.persist_atlas_event_entity_resolution_batch_v1(uuid, text, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_atlas_event_entity_resolution_run_v1(uuid, text, jsonb, text, bigint, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.start_atlas_event_entity_resolution_run_v1(uuid, text, text, text, text, text, integer, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.persist_atlas_event_entity_resolution_batch_v1(uuid, text, text, text, text, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_atlas_event_entity_resolution_run_v1(uuid, text, jsonb, text, bigint, text)
  TO service_role;

COMMIT;
