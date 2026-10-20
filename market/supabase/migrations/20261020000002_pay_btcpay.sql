-- Cacao Pay: the sender pays a transfer in Lightning through BTCPay Server.
--
-- A transfer gets one invoice at a time. The server creates it in BTCPay, stores it here, and moves
-- the transfer to "procesando" only when BTCPay says the invoice is Settled (pay_confirmar_btcpay).
-- A webhook only says "look again": nothing here trusts the webhook body.
-- Demo: BTCPay runs on regtest, so these invoices have no value.

-- ---------------------------------------------------------------------------------------------
-- Columns

alter table public.pay_transferencias
  add column btcpay_factura_id text unique check (btcpay_factura_id is null or btcpay_factura_id ~ '^[A-Za-z0-9]{10,64}$'),
  add column btcpay_tienda_id text check (btcpay_tienda_id is null or btcpay_tienda_id ~ '^[A-Za-z0-9]{10,64}$'),
  -- The BOLT11 Lightning invoice the sender pays.
  add column factura text check (factura is null or char_length(factura) <= 2000),
  add column factura_sats bigint check (factura_sats is null or factura_sats > 0),
  -- The same amount in US cents, at the BTC price used for the invoice.
  add column factura_usd_centavos bigint check (factura_usd_centavos is null or factura_usd_centavos > 0),
  add column factura_expira timestamptz,
  add column pagada_en timestamptz;

-- ---------------------------------------------------------------------------------------------
-- Changes

-- The sender asks for an invoice for a transfer that is only created. Stores the invoice BTCPay made.
-- While an earlier invoice is still live, the caller must reuse it (ESTADO_INVALIDO).
create function public.pay_registrar_factura(p_transferencia uuid, p_actor uuid, p_factura_id text,
  p_tienda text, p_factura text, p_sats bigint, p_expira timestamptz, p_usd_centavos bigint)
returns public.pay_transferencias
language plpgsql security definer set search_path = public as $$
declare
  v_transferencia public.pay_transferencias;
begin
  select * into v_transferencia from public.pay_transferencias where id = p_transferencia for update;
  if not found then
    raise exception '%', 'NO_ENCONTRADA: No encontramos esa transferencia.' using errcode = 'P0001';
  end if;
  if p_actor is null or p_actor is distinct from v_transferencia.remitente_id then
    raise exception '%', 'NO_PERMITIDO: Solo quien envía puede pagar la transferencia.' using errcode = 'P0001';
  end if;
  if v_transferencia.estado <> 'creada' then
    raise exception '%', 'ESTADO_INVALIDO: Esta transferencia ya no se puede pagar.' using errcode = 'P0001';
  end if;
  if v_transferencia.factura_expira is not null and v_transferencia.factura_expira > now() then
    raise exception '%', 'ESTADO_INVALIDO: Ya hay una factura vigente para este envío.' using errcode = 'P0001';
  end if;
  if p_factura_id is null or p_factura_id !~ '^[A-Za-z0-9]{10,64}$'
     or p_tienda is null or p_tienda !~ '^[A-Za-z0-9]{10,64}$'
     or p_factura is null or char_length(p_factura) not between 1 and 2000
     or p_sats is null or p_sats <= 0
     or p_expira is null or p_expira <= now()
     or p_usd_centavos is null or p_usd_centavos <= 0 then
    raise exception '%', 'DATOS_INVALIDOS: La factura no es válida.' using errcode = 'P0001';
  end if;

  update public.pay_transferencias set
    btcpay_factura_id = p_factura_id,
    btcpay_tienda_id = p_tienda,
    factura = p_factura,
    factura_sats = p_sats,
    factura_usd_centavos = p_usd_centavos,
    factura_expira = p_expira
  where id = p_transferencia
  returning * into v_transferencia;

  insert into public.auditoria (actor_id, accion, entidad, entidad_id, detalle)
  values (p_actor, 'transferencia.factura', 'transferencia', p_transferencia::text,
          jsonb_build_object('sats', p_sats));

  return v_transferencia;
end;
$$;

-- BTCPay says this invoice is Settled. Moves the transfer to "procesando" as the sender's "Enviar ahora"
-- did. Repeating the call changes nothing. A cancelled or failed transfer is refused.
create function public.pay_confirmar_btcpay(p_factura_id text) returns public.pay_transferencias
language plpgsql security definer set search_path = public as $$
declare
  v_transferencia public.pay_transferencias;
begin
  select * into v_transferencia from public.pay_transferencias
  where btcpay_factura_id = p_factura_id for update;
  if not found then
    raise exception '%', 'NO_ENCONTRADA: No encontramos esa factura.' using errcode = 'P0001';
  end if;

  if v_transferencia.estado = 'creada' then
    update public.pay_transferencias set pagada_en = now() where id = v_transferencia.id;
    return public._pay_avanzar(v_transferencia.id, v_transferencia.remitente_id, 'procesando',
      'Pagado con Lightning. Transferencia en proceso.', null);
  end if;

  if v_transferencia.estado in ('procesando', 'completada') then
    return v_transferencia;
  end if;

  raise exception '%', 'ESTADO_INVALIDO: Esta transferencia ya no se puede procesar.' using errcode = 'P0001';
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Grants: only the server (service role) runs these.

revoke execute on function public.pay_registrar_factura(uuid, uuid, text, text, text, bigint, timestamptz, bigint)
  from public, anon, authenticated;
revoke execute on function public.pay_confirmar_btcpay(text) from public, anon, authenticated;

grant execute on function public.pay_registrar_factura(uuid, uuid, text, text, text, bigint, timestamptz, bigint)
  to service_role;
grant execute on function public.pay_confirmar_btcpay(text) to service_role;
