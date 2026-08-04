begin;

-- Preserve the abandoned verification/chronicle substrate as historical
-- evidence, but remove direct browser circulation and mutation. This namespace
-- is not the canonical Prism verification platform and is not an Atlas signal
-- or convergence output surface.

do $$
declare
  v_relation text;
begin
  foreach v_relation in array array[
    'extraction_candidates',
    'verification_claims',
    'verification_evidence',
    'verification_sources',
    'verified_chronicle',
    'canonical_extracted_records',
    'v_chronicle_verification_status',
    'v_canonical_record_quality',
    'v_actionable_canonical_records'
  ]
  loop
    if to_regclass(format('public.%I', v_relation)) is null then
      raise exception 'expected preserved legacy relation public.% is missing', v_relation;
    end if;
  end loop;
end;
$$;

alter table public.extraction_candidates enable row level security;
alter table public.verification_claims enable row level security;
alter table public.verification_evidence enable row level security;
alter table public.verification_sources enable row level security;
alter table public.verified_chronicle enable row level security;
alter table public.canonical_extracted_records enable row level security;

revoke all on table public.extraction_candidates from public, anon, authenticated;
revoke all on table public.verification_claims from public, anon, authenticated;
revoke all on table public.verification_evidence from public, anon, authenticated;
revoke all on table public.verification_sources from public, anon, authenticated;
revoke all on table public.verified_chronicle from public, anon, authenticated;
revoke all on table public.canonical_extracted_records from public, anon, authenticated;

grant select, insert, update, delete on table public.extraction_candidates to service_role;
grant select, insert, update, delete on table public.verification_claims to service_role;
grant select, insert, update, delete on table public.verification_evidence to service_role;
grant select, insert, update, delete on table public.verification_sources to service_role;
grant select, insert, update, delete on table public.verified_chronicle to service_role;
grant select, insert, update, delete on table public.canonical_extracted_records to service_role;

alter view public.v_chronicle_verification_status set (security_invoker = true);
alter view public.v_canonical_record_quality set (security_invoker = true);
alter view public.v_actionable_canonical_records set (security_invoker = true);

revoke all on table public.v_chronicle_verification_status from public, anon, authenticated;
revoke all on table public.v_canonical_record_quality from public, anon, authenticated;
revoke all on table public.v_actionable_canonical_records from public, anon, authenticated;

grant select on table public.v_chronicle_verification_status to service_role;
grant select on table public.v_canonical_record_quality to service_role;
grant select on table public.v_actionable_canonical_records to service_role;

alter function public.evaluate_canonical_payload_usefulness(text, jsonb, jsonb, jsonb, text, text, text)
  set search_path = pg_catalog, public;
alter function public.ingest_canonical_extracted_record(jsonb)
  set search_path = pg_catalog, public;
alter function public.ingest_canonical_extracted_record_batch(jsonb)
  set search_path = pg_catalog, public;
alter function public.ingest_extraction_candidate_batch(jsonb)
  set search_path = pg_catalog, public;
alter function public.jsonb_array_count(jsonb)
  set search_path = pg_catalog, public;
alter function public.promote_verified_chronicle()
  set search_path = pg_catalog, public;
alter function public.set_updated_at()
  set search_path = pg_catalog, public;

revoke execute on function public.evaluate_canonical_payload_usefulness(text, jsonb, jsonb, jsonb, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.ingest_canonical_extracted_record(jsonb)
  from public, anon, authenticated;
revoke execute on function public.ingest_canonical_extracted_record_batch(jsonb)
  from public, anon, authenticated;
revoke execute on function public.ingest_extraction_candidate_batch(jsonb)
  from public, anon, authenticated;
revoke execute on function public.jsonb_array_count(jsonb)
  from public, anon, authenticated;
revoke execute on function public.promote_verified_chronicle()
  from public, anon, authenticated;
revoke execute on function public.set_updated_at()
  from public, anon, authenticated;

grant execute on function public.evaluate_canonical_payload_usefulness(text, jsonb, jsonb, jsonb, text, text, text)
  to service_role;
grant execute on function public.ingest_canonical_extracted_record(jsonb)
  to service_role;
grant execute on function public.ingest_canonical_extracted_record_batch(jsonb)
  to service_role;
grant execute on function public.ingest_extraction_candidate_batch(jsonb)
  to service_role;
grant execute on function public.jsonb_array_count(jsonb)
  to service_role;
grant execute on function public.promote_verified_chronicle()
  to service_role;
grant execute on function public.set_updated_at()
  to service_role;

comment on table public.extraction_candidates is
  'Preserved legacy extraction fixture. Not canonical Atlas signal state and not a Prism verification input. Service-role only.';
comment on table public.verification_claims is
  'Preserved legacy verification fixture. Not the canonical Prism claims ledger. Service-role only.';
comment on table public.verification_evidence is
  'Preserved legacy verification fixture. Not the canonical Prism evidence ledger. Service-role only.';
comment on table public.verification_sources is
  'Preserved legacy verification fixture. Not the canonical Prism source registry. Service-role only.';
comment on table public.verified_chronicle is
  'Preserved legacy chronicle fixture. Not an Atlas governed finding or Prism receipt. Service-role only.';
comment on table public.canonical_extracted_records is
  'Preserved legacy extraction fixture. Not an Atlas convergence output or canonical civic resource record. Service-role only.';

commit;
