begin;

-- Harden already-installed Atlas readiness views; the original migration
-- also defines these privileges for fresh database installations.
alter view public.v_atlas_source_operational_readiness_v1
  set (security_invoker = true);

revoke all on public.v_atlas_source_operational_readiness_v1
  from public, anon, authenticated;

grant select on public.v_atlas_source_operational_readiness_v1 to service_role;

commit;
