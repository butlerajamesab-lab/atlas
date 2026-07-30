-- Read-only verification for 20260726_event_entity_resolution.sql
-- Run after applying the migration. It performs no data writes.

BEGIN READ ONLY;

DO $verify$
DECLARE
  v_candidate_hash text;
  v_resolution_hash text;
  v_event_hash_utc text;
  v_event_hash_other_tz text;
  v_normalized_name text;
  v_normalized_ein text;
  v_normalized_cik text;
  v_source_entity_value text;
  v_verified_status text;
  v_verified_method text;
  v_verified_entity_id text;
  v_verified_candidate_ids text[];
BEGIN
  IF to_regclass('atlas.signal_event_entity_resolution_rule') IS NULL THEN
    RAISE EXCEPTION 'missing atlas.signal_event_entity_resolution_rule';
  END IF;
  IF to_regclass('atlas.signal_event_entity_resolution') IS NULL THEN
    RAISE EXCEPTION 'missing atlas.signal_event_entity_resolution';
  END IF;
  IF to_regclass('atlas.signal_event_entity_resolution_run') IS NULL THEN
    RAISE EXCEPTION 'missing atlas.signal_event_entity_resolution_run';
  END IF;
  IF to_regclass('public.v_atlas_resolved_signal_event_entities_v1') IS NULL THEN
    RAISE EXCEPTION 'missing public.v_atlas_resolved_signal_event_entities_v1';
  END IF;
  IF to_regclass('public.v_atlas_entity_cross_stream_summary_v1') IS NULL THEN
    RAISE EXCEPTION 'missing public.v_atlas_entity_cross_stream_summary_v1';
  END IF;
  IF to_regclass('public.v_atlas_event_entity_resolution_review_v1') IS NULL THEN
    RAISE EXCEPTION 'missing public.v_atlas_event_entity_resolution_review_v1';
  END IF;
  IF to_regprocedure('public.fetch_atlas_entity_cross_stream_correlations_v1(integer,integer,text)') IS NULL THEN
    RAISE EXCEPTION 'missing bounded canonical cross-stream correlation function';
  END IF;
  IF to_regprocedure('public.fetch_atlas_resolved_entity_events_v1(text,integer,timestamp with time zone)') IS NULL THEN
    RAISE EXCEPTION 'missing bounded resolved-entity event function';
  END IF;
  IF to_regprocedure('public.fetch_atlas_event_entity_resolution_review_v1(text,integer,integer)') IS NULL THEN
    RAISE EXCEPTION 'missing bounded event-entity review function';
  END IF;
  IF to_regprocedure('atlas.resolve_signal_event_entity_candidate_exact_v1(text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'missing independent PostgreSQL exact-match verifier';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'signal_event_entity_resolution_rule_immutable_v1'
      AND tgrelid = 'atlas.signal_event_entity_resolution_rule'::regclass
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'immutable rule trigger is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'signal_event_entity_resolution_immutable_v1'
      AND tgrelid = 'atlas.signal_event_entity_resolution'::regclass
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'immutable resolution trigger is missing';
  END IF;

  IF (
    SELECT count(*)
    FROM atlas.signal_event_entity_resolution_rule
    WHERE is_active = true
      AND rule_manifest_hash = 'd6c15b4bae26b4fb9c87f4173fcd8f880e59b1ff17e0d2e046aaeedaee9695dd'
  ) <> 13 THEN
    RAISE EXCEPTION 'locked rule manifest row count/hash mismatch';
  END IF;

  IF atlas.infer_entity_identifier_type_v1(
    'nonprofit_registry',
    '["pro_publica"]'::jsonb,
    '{}'::jsonb,
    '93-4414218'
  ) <> 'ein' THEN
    RAISE EXCEPTION 'identifier-source inference parity failure';
  END IF;

  IF atlas.entity_type_compatible_v1('organization', 'nonprofit') IS DISTINCT FROM true
     OR atlas.entity_type_compatible_v1('person', 'corporation') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'entity-type compatibility parity failure';
  END IF;

  SELECT
    expected_resolution_status,
    expected_match_method,
    expected_entity_id,
    expected_candidate_entity_ids
  INTO
    v_verified_status,
    v_verified_method,
    v_verified_entity_id,
    v_verified_candidate_ids
  FROM atlas.resolve_signal_event_entity_candidate_exact_v1(NULL, NULL, NULL, NULL);

  IF v_verified_status <> 'unresolved'
     OR v_verified_method <> 'no_usable_identity_value'
     OR v_verified_entity_id IS NOT NULL
     OR v_verified_candidate_ids IS DISTINCT FROM ARRAY[]::text[] THEN
    RAISE EXCEPTION 'exact-match verifier base-state parity failure';
  END IF;

  v_normalized_name := public.atlas_normalize_entity_name_v1('  A&B, Inc.  ');
  IF v_normalized_name <> 'ABINC' THEN
    RAISE EXCEPTION 'entity-name normalization parity failure: %', v_normalized_name;
  END IF;

  v_normalized_ein := public.atlas_normalize_entity_identifier_v1('ein', '93-4414218');
  IF v_normalized_ein <> '934414218' THEN
    RAISE EXCEPTION 'EIN normalization parity failure: %', v_normalized_ein;
  END IF;

  v_normalized_cik := public.atlas_normalize_entity_identifier_v1('cik', '320193');
  IF v_normalized_cik <> '0000320193' THEN
    RAISE EXCEPTION 'CIK normalization parity failure: %', v_normalized_cik;
  END IF;

  v_source_entity_value := public.atlas_event_entity_source_value_v1(
    'usa_spending.award_recipient',
    'payload.title',
    'Contract: BATTELLE MEMORIAL INSTITUTE — $30,354,931,646.47'
  );
  IF v_source_entity_value <> 'BATTELLE MEMORIAL INSTITUTE' THEN
    RAISE EXCEPTION 'USAspending recipient extraction parity failure: %', v_source_entity_value;
  END IF;

  v_candidate_hash := public.atlas_event_entity_candidate_key_v1(
    'cfpb_complaints.complained_against_entity',
    '1.0.0',
    'complained_against_entity',
    'payload.company',
    'TRANSUNIONINTERMEDIATEHOLDINGSINC',
    NULL,
    NULL,
    NULL,
    'organization'
  );
  IF v_candidate_hash <> '7ac9d0f141caf5ea1b0f96102ae73f8c911f99f00beaa7a0666b902f0b8100f6' THEN
    RAISE EXCEPTION 'candidate-key JS/SQL parity failure: %', v_candidate_hash;
  END IF;

  v_resolution_hash := public.atlas_event_entity_resolution_hash_v1(
    repeat('a', 64),
    repeat('b', 64),
    repeat('c', 64),
    'cfpb_complaints.complained_against_entity',
    '1.0.0',
    v_candidate_hash,
    'complained_against_entity',
    'payload.company',
    'TRANSUNIONINTERMEDIATEHOLDINGSINC',
    NULL,
    NULL,
    NULL,
    'organization',
    'resolved',
    'org-transunion',
    'exact_primary_name',
    ARRAY['org-transunion']::text[],
    'atlas.signal_event_entity_exact',
    '1.0.0'
  );
  IF v_resolution_hash <> 'e7a7c0310f2092e2f69378a631686d5527927a2d865b18857df65e860055d5fd' THEN
    RAISE EXCEPTION 'resolution-hash JS/SQL parity failure: %', v_resolution_hash;
  END IF;

  PERFORM set_config('TimeZone', 'UTC', true);
  v_event_hash_utc := public.atlas_signal_event_input_hash_v1(
    'cfpb_complaints',
    1,
    timestamptz '2026-05-10 00:28:15.974+00',
    'consumer_complaint',
    '{"jurisdiction":"us_federal"}'::jsonb,
    '{"source_system":"cfpb"}'::jsonb,
    '{"company":"Example Corp"}'::jsonb,
    'cfpb',
    'us_federal',
    'consumer_finance',
    timestamptz '2026-05-10 00:28:16+00'
  );
  PERFORM set_config('TimeZone', 'America/Los_Angeles', true);
  v_event_hash_other_tz := public.atlas_signal_event_input_hash_v1(
    'cfpb_complaints',
    1,
    timestamptz '2026-05-10 00:28:15.974+00',
    'consumer_complaint',
    '{"jurisdiction":"us_federal"}'::jsonb,
    '{"source_system":"cfpb"}'::jsonb,
    '{"company":"Example Corp"}'::jsonb,
    'cfpb',
    'us_federal',
    'consumer_finance',
    timestamptz '2026-05-10 00:28:16+00'
  );
  IF v_event_hash_utc <> v_event_hash_other_tz THEN
    RAISE EXCEPTION 'event hash changes with session timezone';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM atlas.signal_event_entity_resolution
    WHERE is_current = true
    GROUP BY stream_id, event_offset, candidate_key, resolver_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate current resolution rows detected';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.v_atlas_event_entity_resolution_review_v1
    WHERE resolution_status NOT IN ('ambiguous', 'unresolved')
       OR review_key IS NULL
       OR review_key !~ '^[0-9a-f]{64}$'
  ) THEN
    RAISE EXCEPTION 'event-entity review projection contains an invalid status or review key';
  END IF;

  IF EXISTS (
    SELECT review_key
    FROM public.v_atlas_event_entity_resolution_review_v1
    GROUP BY review_key
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate deterministic review keys detected';
  END IF;
END;
$verify$;

SELECT
  status,
  count(*) AS run_count,
  sum(processed_event_count) AS processed_events,
  sum(resolution_row_count) AS resolution_rows
FROM atlas.signal_event_entity_resolution_run
GROUP BY status
ORDER BY status;

SELECT *
FROM public.v_atlas_event_entity_resolution_coverage_v1
ORDER BY stream_id, resolution_status;

SELECT *
FROM public.v_atlas_entity_cross_stream_summary_v1
ORDER BY stream_count DESC, resolved_event_count DESC, entity_id
LIMIT 25;

SELECT *
FROM public.fetch_atlas_event_entity_resolution_review_v1(NULL, 1, 25);

ROLLBACK;
