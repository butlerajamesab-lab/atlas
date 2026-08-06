-- Route the governed Domain 3 transport through Lighthouse's explicit
-- row-shaped PostgREST receipt. The canonical registration function remains
-- Lighthouse-owned; this changes only the transport response contract.

begin;

do $migration$
declare
  v_definition text;
begin
  if to_regprocedure(
    'public.bridge_live_data_signal_candidates_v1(uuid,integer)'
  ) is null then
    raise exception 'governed Domain 3 bridge function is missing';
  end if;

  select pg_get_functiondef(
    'public.bridge_live_data_signal_candidates_v1(uuid,integer)'::regprocedure
  ) into v_definition;

  if position('register_live_data_signal_receipt_v1' in v_definition) = 0 then
    if position('register_live_data_signal_transport_receipt_v1' in v_definition) > 0 then
      return;
    end if;
    raise exception 'expected scalar Lighthouse receipt endpoint is missing';
  end if;

  v_definition := replace(
    v_definition,
    'register_live_data_signal_receipt_v1',
    'register_live_data_signal_transport_receipt_v1'
  );

  if position('register_live_data_signal_transport_receipt_v1' in v_definition) = 0 then
    raise exception 'row-shaped Lighthouse receipt endpoint was not installed';
  end if;

  execute v_definition;
end;
$migration$;

revoke all on function public.bridge_live_data_signal_candidates_v1(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.bridge_live_data_signal_candidates_v1(uuid, integer)
  to service_role;

comment on function public.bridge_live_data_signal_candidates_v1(uuid, integer) is
  'Atlas-owned synchronous Domain 3 transport using encrypted bridge config and Lighthouse row-shaped PostgREST receipts. Canonical signal registration remains Lighthouse-owned.';

commit;
