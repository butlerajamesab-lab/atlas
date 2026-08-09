-- Atlas live operator surface security follow-up.
-- This makes the intended service-role receipt policy explicit and ensures
-- the source-readiness view used by the UI respects the caller's privileges.

drop policy if exists atlas_action_receipt_service_role_all on public.atlas_action_receipt;
create policy atlas_action_receipt_service_role_all
  on public.atlas_action_receipt
  for all
  to service_role
  using (true)
  with check (true);

alter view public.v_atlas_source_operational_readiness_v1
  set (security_invoker = true);

revoke all on public.v_atlas_source_operational_readiness_v1
  from public, anon, authenticated;
grant select on public.v_atlas_source_operational_readiness_v1
  to service_role;
