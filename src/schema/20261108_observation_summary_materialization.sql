-- 20261108_observation_summary_materialization.sql
-- Materialize the observation-type summary.
--
-- v_atlas_observation_type_summary_v1 was a plain view that ran a
-- GROUP BY over the whole signal_events table (800k+ rows, 2.2 GB)
-- on every read, producing ~151 summary rows. Every console read
-- model (overview, streams, signal derivation) and the 15-minute
-- stream runtime projection paid that full scan per read; on the
-- smaller database compute it blew the statement timeout (57014).
--
-- This file:
--   1. creates atlas_observation_type_summary_mat with the view's
--      exact columns (plus refreshed_at),
--   2. creates refresh_atlas_observation_type_summary_v1(), which
--      recomputes the summary in a single transaction,
--   3. seeds the table,
--   4. repoints the view at the table with identical output
--      columns, so every dependent view keeps working untouched.
-- The scheduler refreshes the table every 15 minutes (the cadence
-- the stream projection already ran on). The reservoir viewer's
-- census reads signal_events directly and stays exact/live.

CREATE TABLE IF NOT EXISTS public.atlas_observation_type_summary_mat (
  stream_id text,
  observation_classification text,
  module_hint text,
  jurisdiction_id text,
  observation_count bigint,
  identity_bound_observation_count bigint,
  first_observed_at timestamp with time zone,
  latest_observed_at timestamp with time zone,
  latest_ingested_at timestamp with time zone,
  refreshed_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.refresh_atlas_observation_type_summary_v1()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  inserted integer;
BEGIN
  -- WHERE true is load-bearing: API-role sessions on Supabase run
  -- with the safeupdate guard, which rejects a DELETE without a
  -- WHERE clause ("DELETE requires a WHERE clause") when the
  -- function is called through PostgREST. Found live 2026-11-08.
  DELETE FROM public.atlas_observation_type_summary_mat WHERE true;
  INSERT INTO public.atlas_observation_type_summary_mat (
    stream_id, observation_classification, module_hint, jurisdiction_id,
    observation_count, identity_bound_observation_count,
    first_observed_at, latest_observed_at, latest_ingested_at, refreshed_at
  )
  SELECT
    stream_id,
    signal_type,
    module_hint,
    jurisdiction_id,
    count(*),
    count(event_identity_hash),
    min("timestamp"),
    max("timestamp"),
    max(ingested_at),
    now()
  FROM public.signal_events
  GROUP BY stream_id, signal_type, module_hint, jurisdiction_id;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END;
$$;

SELECT public.refresh_atlas_observation_type_summary_v1();

CREATE OR REPLACE VIEW public.v_atlas_observation_type_summary_v1 AS
SELECT
  stream_id,
  observation_classification,
  module_hint,
  jurisdiction_id,
  observation_count,
  identity_bound_observation_count,
  first_observed_at,
  latest_observed_at,
  latest_ingested_at
FROM public.atlas_observation_type_summary_mat;
