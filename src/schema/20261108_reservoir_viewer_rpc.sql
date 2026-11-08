-- Reservoir viewer record access (2026-11-08).
--
-- Why RPC: PostgREST claims the `offset` query parameter for its own
-- pagination, so supabase-js filters on signal_events."offset"
-- (eq / lt) never reach the WHERE clause. In production this made
-- the viewer's single-record read match by stream only:
-- maybeSingle then failed on every multi-row stream (500), while
-- the one single-row stream (usda_snap, 1 record) succeeded — the
-- control case that proved the mechanism. SQL-side filtering is
-- immune. Idempotent: safe to re-apply.

CREATE OR REPLACE FUNCTION public.atlas_reservoir_record(
  p_stream_id text,
  p_offset bigint
)
RETURNS SETOF public.signal_events
LANGUAGE sql
STABLE
AS $$
  SELECT *
  FROM public.signal_events
  WHERE stream_id = p_stream_id
    AND "offset" = p_offset
$$;

CREATE OR REPLACE FUNCTION public.atlas_reservoir_records_page(
  p_stream_id text,
  p_limit integer,
  p_before_offset bigint DEFAULT NULL
)
RETURNS SETOF public.signal_events
LANGUAGE sql
STABLE
AS $$
  SELECT *
  FROM public.signal_events
  WHERE stream_id = p_stream_id
    AND (p_before_offset IS NULL OR "offset" < p_before_offset)
  ORDER BY "offset" DESC
  LIMIT p_limit
$$;
