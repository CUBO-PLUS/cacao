-- Demo pickup orders end on the buyer's own control. A demo seller is a real business that does not take part in
-- CacaoMarket, so its order would otherwise wait forever for a 'lista' mark. Only an order placed with a demo
-- seller (negocios.btcmap_id is set) can be settled this way, and only by its buyer. Everything else keeps the
-- normal path: marcar_lista, then the buyer's or seller's delivery.

create or replace function public.simular_entrega_demo(p_orden uuid, p_actor uuid) returns public.ordenes
language plpgsql security definer set search_path = public as $$
declare
  v_orden public.ordenes;
  v_btcmap integer;
  v_rol text;
begin
  select * into v_orden from public.ordenes where id = p_orden for update;
  if not found then
    raise exception '%', 'NO_ENCONTRADA: No encontramos esa orden.' using errcode = 'P0001';
  end if;
  v_rol := public._rol_en_orden(v_orden, p_actor);
  if v_rol is null then
    raise exception '%', 'NO_ENCONTRADA: No encontramos esa orden.' using errcode = 'P0001';
  end if;
  if v_rol <> 'comprador' then
    raise exception '%', 'NO_PERMITIDO: Solo el comprador puede simular la entrega.' using errcode = 'P0001';
  end if;

  select n.btcmap_id into v_btcmap from public.negocios n where n.id = v_orden.negocio_id;
  if v_orden.tipo <> 'productos' or v_btcmap is null then
    raise exception '%', 'NO_PERMITIDO: Solo se simula la entrega de negocios de demostración.' using errcode = 'P0001';
  end if;

  return public._transicion_orden(p_orden, p_actor, array['pagada', 'lista']::public.estado_orden[], 'entregada', false);
end;
$$;

revoke execute on function public.simular_entrega_demo(uuid, uuid) from public, anon, authenticated;
grant execute on function public.simular_entrega_demo(uuid, uuid) to service_role;
