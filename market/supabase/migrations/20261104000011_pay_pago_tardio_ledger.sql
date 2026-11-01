-- A late payment on a cancelled business charge reaches CacaoLedger too. Until now only a charge that was paid on
-- time (or expired and then paid) wrote its Ledger notice; a payment that arrived after the cashier cancelled the
-- charge was recorded as late and never reached Ledger. The sale is real money received, so Ledger gets it through
-- the same durable queue (pay_avisos, destino 'ledger'), in the same transaction that records the late payment.
-- Only the late-payment branch changes; every other state transition keeps the rules of 20261102000001.

create or replace function public.pay_aplicar_btcpay(p_factura_id text, p_estado text, p_hash text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cobro public.pay_cobros;
  v_cambio boolean := false;
  v_aviso uuid;
  v_ledger uuid;
begin
  select * into v_cobro from public.pay_cobros where btcpay_factura_id = p_factura_id for update;
  if not found then
    raise exception '%', 'NO_ENCONTRADA: No encontramos ese cobro.' using errcode = 'P0001';
  end if;
  if p_estado is null or p_estado not in ('Settled', 'Expired', 'Invalid') then
    raise exception '%', 'DATOS_INVALIDOS: El estado de BTCPay no es uno que se pueda aplicar.' using errcode = 'P0001';
  end if;
  if p_hash is not null and p_hash !~ '^[0-9a-f]{64}$' then
    raise exception '%', 'DATOS_INVALIDOS: El hash del pago no es válido.' using errcode = 'P0001';
  end if;

  if p_estado = 'Settled' then
    if v_cobro.estado in ('pendiente', 'vencido') then
      update public.pay_cobros set estado = 'pagado', pagado_en = now(), hash_pago = coalesce(p_hash, hash_pago),
        actualizado_en = now()
      where id = v_cobro.id returning * into v_cobro;
      v_cambio := true;
    elsif v_cobro.estado = 'cancelado' and v_cobro.pago_tardio_en is null then
      update public.pay_cobros set pago_tardio_en = now(), hash_pago = coalesce(p_hash, hash_pago),
        actualizado_en = now()
      where id = v_cobro.id returning * into v_cobro;
      insert into public.auditoria (actor_id, accion, entidad, entidad_id, detalle)
      values (null, 'cobro.pago_tardio', 'cobro', v_cobro.id::text, jsonb_build_object('factura', p_factura_id));
      -- A late payment of a business charge is a sale for Ledger all the same. Its notice is queued here.
      if v_cobro.producto = 'negocios' then
        insert into public.pay_avisos (cobro_id, estado, destino) values (v_cobro.id, 'pagado', 'ledger')
        on conflict (cobro_id, estado, destino) do nothing
        returning id into v_ledger;
      end if;
    end if;
  elsif p_estado = 'Expired' and v_cobro.estado = 'pendiente' then
    update public.pay_cobros set estado = 'vencido', actualizado_en = now() where id = v_cobro.id returning * into v_cobro;
    v_cambio := true;
  elsif p_estado = 'Invalid' and v_cobro.estado = 'pendiente' then
    update public.pay_cobros set estado = 'cancelado', cancelado_en = now(), actualizado_en = now()
    where id = v_cobro.id returning * into v_cobro;
    v_cambio := true;
  end if;

  if v_cambio then
    insert into public.pay_avisos (cobro_id, estado, destino)
    select v_cobro.id, v_cobro.estado, 'cliente' where v_cobro.aviso_url is not null
    on conflict (cobro_id, estado, destino) do nothing
    returning id into v_aviso;
    if v_cobro.estado = 'pagado' and v_cobro.producto = 'negocios' then
      insert into public.pay_avisos (cobro_id, estado, destino) values (v_cobro.id, 'pagado', 'ledger')
      on conflict (cobro_id, estado, destino) do nothing
      returning id into v_ledger;
    end if;
    insert into public.auditoria (actor_id, accion, entidad, entidad_id, detalle)
    values (null, 'cobro.estado', 'cobro', v_cobro.id::text,
      jsonb_build_object('estado', v_cobro.estado, 'btcpay', p_estado));
  end if;

  return jsonb_build_object('cambio', v_cambio, 'cobro', to_jsonb(v_cobro), 'aviso_id', v_aviso, 'aviso_ledger_id', v_ledger);
end;
$$;

revoke execute on function public.pay_aplicar_btcpay(text, text, text) from public, anon, authenticated;
grant execute on function public.pay_aplicar_btcpay(text, text, text) to service_role;
