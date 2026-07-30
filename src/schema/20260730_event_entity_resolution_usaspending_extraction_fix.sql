-- Correct PostgreSQL-side USAspending recipient extraction parity.
--
-- The initial event-entity migration used a non-greedy POSIX regular-expression
-- branch. PostgreSQL selected the end-of-string alternative and retained the
-- trailing award delimiter and amount. This migration preserves the original
-- deterministic contract while making each accepted title shape explicit.

BEGIN;

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
      '^(Contract|Award|Grant)[[:space:]]*:[[:space:]]*(.+)[[:space:]]+[—–-][[:space:]]+\$.*$',
      'i'
    );

    IF v_match IS NULL THEN
      v_match := regexp_match(
        v_value,
        '^(Contract|Award|Grant)[[:space:]]*:[[:space:]]*(.+)[[:space:]]+[—–-][[:space:]]+.*$',
        'i'
      );
    END IF;

    IF v_match IS NULL THEN
      v_match := regexp_match(
        v_value,
        '^(Contract|Award|Grant)[[:space:]]*:[[:space:]]*(.+)$',
        'i'
      );
    END IF;

    IF v_match IS NOT NULL THEN
      RETURN NULLIF(btrim(v_match[2]), '');
    END IF;
  END IF;

  RETURN v_value;
END;
$function$;

DO $verify$
DECLARE
  v_amount_title text;
  v_delimited_title text;
  v_prefix_only_title text;
  v_unrelated_title text;
BEGIN
  v_amount_title := public.atlas_event_entity_source_value_v1(
    'usa_spending.award_recipient',
    'payload.title',
    'Contract: BATTELLE MEMORIAL INSTITUTE — $30,354,931,646.47'
  );
  IF v_amount_title <> 'BATTELLE MEMORIAL INSTITUTE' THEN
    RAISE EXCEPTION 'USAspending amount-title extraction parity failure: %', v_amount_title;
  END IF;

  v_delimited_title := public.atlas_event_entity_source_value_v1(
    'usa_spending.award_recipient',
    'payload.title',
    'Award: EXAMPLE FOUNDATION - active'
  );
  IF v_delimited_title <> 'EXAMPLE FOUNDATION' THEN
    RAISE EXCEPTION 'USAspending delimited-title extraction parity failure: %', v_delimited_title;
  END IF;

  v_prefix_only_title := public.atlas_event_entity_source_value_v1(
    'usa_spending.award_recipient',
    'payload.title',
    'Grant: SAMPLE ORG'
  );
  IF v_prefix_only_title <> 'SAMPLE ORG' THEN
    RAISE EXCEPTION 'USAspending prefix-only extraction parity failure: %', v_prefix_only_title;
  END IF;

  v_unrelated_title := public.atlas_event_entity_source_value_v1(
    'other.rule',
    'payload.title',
    'Ordinary title'
  );
  IF v_unrelated_title <> 'Ordinary title' THEN
    RAISE EXCEPTION 'unrelated title extraction changed unexpectedly: %', v_unrelated_title;
  END IF;
END;
$verify$;

COMMIT;
