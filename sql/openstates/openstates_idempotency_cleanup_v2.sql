-- Narrow Open States WA idempotency cleanup.
-- Scope: public.statutes rows whose external_id belongs to the open_states_statutes raw-record test set
--        and whose jurisdiction is the raw upstream Open States label 'Washington'.
-- This does not modify public.raw_records.

WITH scoped AS (
  SELECT
    s.id,
    row_number() OVER (
      PARTITION BY s.external_id, s.jurisdiction
      ORDER BY s.created_at DESC NULLS LAST,
               s.updated_at DESC NULLS LAST,
               s.id DESC
    ) AS rn
  FROM public.statutes s
  WHERE s.jurisdiction = 'Washington'
    AND s.external_id IS NOT NULL
    AND s.external_id IN (
      SELECT r.external_id
      FROM public.raw_records r
      JOIN public.connector_registry c ON c.id = r.connector_id
      WHERE c.name = 'open_states_statutes'
    )
), deleted AS (
  DELETE FROM public.statutes s
  USING scoped d
  WHERE s.id = d.id
    AND d.rn > 1
  RETURNING s.id, s.external_id, s.jurisdiction
)
SELECT count(*)::bigint AS deleted_duplicate_statute_rows
FROM deleted;

CREATE UNIQUE INDEX IF NOT EXISTS statutes_external_id_jurisdiction_unique
ON public.statutes (external_id, jurisdiction)
WHERE external_id IS NOT NULL AND jurisdiction IS NOT NULL;
