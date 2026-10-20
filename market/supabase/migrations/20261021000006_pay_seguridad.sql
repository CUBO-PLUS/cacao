-- Cacao Pay: safety rules for the money.
--
-- 1. A Lightning transfer is never paid out by hand: only BTCPay's Settled invoice moves it, and a claim
--    needs that payment first (pagada_en).
-- 2. A claim records the hash of its invoice before BTCPay is asked to pay it, so a crash can be reconciled.
--    A retry after 'fallido' is allowed only because that attempt was verified as failed.
-- 3. The sender's quote is refreshed before a new invoice when it is older than the validity (pay_recotizar).
-- 4. A paid transfer cannot be marked as failed.
-- 5. Every invoice issued is recorded (pay_facturas). A payment for a cancelled or failed transfer is kept
--    as a late payment to return (pago_tardio_en), instead of being refused.
-- 6. A public claim is limited to 10 attempts per token per hour.
-- Nothing here moves money. The server calls these functions with the service role.

-- ---------------------------------------------------------------------------------------------
-- Columns

alter table public.pay_transferencias
  -- Claim attempts in the current hour, and when that hour started.
  add column cobro_intentos integer not null default 0 check (cobro_intentos >= 0),
  add column cobro_intentos_desde timestamptz,
  -- When the current claim attempt started: a payment that BTCPay has never seen for 10 minutes is failed.
  add column cobro_intento_en timestamptz,
  -- A payment that arrived after the transfer was cancelled or failed. The money must be returned.
  add column pago_tardio_en timestamptz,
  -- When the quote in use was made. A quote older than the validity is made again before a new invoice.
  add column cotizada_en timestamptz;

update public.pay_transferencias set cotizada_en = creada_en where cotizada_en is null;
alter table public.pay_transferencias alter column cotizada_en set not null;
alter table public.pay_transferencias alter column cotizada_en set default now();

-- ---------------------------------------------------------------------------------------------
-- Invoices issued: every one, so a late payment of an older invoice is still recognized.

create table public.pay_facturas (
  btcpay_factura_id text primary key check (btcpay_factura_id ~ '^[A-Za-z0-9]{10,64}$'),
  transferencia_id uuid not null references public.pay_transferencias (id) on delete cascade,
  factura text not null check (char_length(factura) between 1 and 2000),
  sats bigint not null check (sats > 0),
  expira timestamptz not null,
  creado_en timestamptz not null default now()
);
create index pay_facturas_transferencia on public.pay_facturas (transferencia_id);

alter table public.pay_facturas enable row level security;
revoke all on public.pay_facturas from anon, authenticated;
grant all on public.pay_facturas to service_role;

-- The invoice each transfer already has becomes the first row of the record.
insert into public.pay_facturas (btcpay_factura_id, transferencia_id, factura, sats, expira)
select btcpay_factura_id, id, factura, factura_sats, factura_expira
from public.pay_transferencias
where btcpay_factura_id is not null and factura is not null
  and factura_sats is not null and factura_expira is not null
on conflict (btcpay_factura_id) do nothing;

-- ---------------------------------------------------------------------------------------------
-- Quotes

-- The sender refreshes the quote of a transfer that is only created and has no live invoice. The values
-- are computed by the server and checked here, as pay_crear_transferencia does.
create function public.pay_recotizar(p_transferencia uuid, p_actor uuid, p_tasa numeric, p_tasa_fuente text,
  p_comision integer, p_monto_destino bigint)
returns public.pay_transferencias
language plpgsql security definer set search_path = public as $$
declare
  v_transferencia public.pay_transferencias;
  v_fuente text;
  v_tasa numeric;
  v_comision integer;
  v_neto integer;
  v_destino bigint;
begin
  select * into v_transferencia from public.pay_transferencias where id = p_transferencia for update;
  if not found then
    raise exception '%', 'NO_ENCONTRADA: No encontramos esa transferencia.' using errcode = 'P0001';
  end if;
  if p_actor is null or p_actor is distinct from v_transferencia.remitente_id then
    raise exception '%', 'NO_PERMITIDO: Solo quien envía puede actualizar la cotización.' using errcode = 'P0001';
  end if;
  if v_transferencia.estado <> 'creada' or v_transferencia.pagada_en is not null then
    raise exception '%', 'ESTADO_INVALIDO: Esta transferencia ya no se puede cotizar de nuevo.' using errcode = 'P0001';
  end if;
  if v_transferencia.factura_expira is not null and v_transferencia.factura_expira > now() then
    raise exception '%', 'ESTADO_INVALIDO: Hay una factura vigente para este envío.' using errcode = 'P0001';
  end if;

  v_fuente := public._texto_valido(p_tasa_fuente, 1, 80, 'Indicá de dónde sale la tasa.');
  if p_tasa is null or round(p_tasa, 8) <= 0 then
    raise exception '%', 'DATOS_INVALIDOS: La tasa tiene que ser mayor que cero.' using errcode = 'P0001';
  end if;
  v_tasa := round(p_tasa, 8);
  if v_transferencia.moneda_origen = 'USD' and v_transferencia.moneda_destino = 'USD' and v_tasa <> 1 then
    raise exception '%', 'DATOS_INVALIDOS: La tasa no coincide con la tasa vigente.' using errcode = 'P0001';
  end if;
  if v_transferencia.moneda_origen = 'EUR' and v_transferencia.moneda_destino = 'USD'
     and v_tasa is distinct from (select t.tasa from public.pay_tasas t where t.par = 'EUR/USD') then
    raise exception '%', 'DATOS_INVALIDOS: La tasa no coincide con la tasa vigente.' using errcode = 'P0001';
  end if;

  select c.comision, c.neto, c.monto_destino into v_comision, v_neto, v_destino
  from public._pay_calcular(v_transferencia.monto_origen_centavos, v_transferencia.entrega, v_tasa,
    v_transferencia.moneda_destino) c;
  if v_destino <= 0 then
    raise exception '%', 'DATOS_INVALIDOS: Con estos montos el destinatario recibiría cero.' using errcode = 'P0001';
  end if;
  if p_comision is null or p_monto_destino is null
     or p_comision <> v_comision or p_monto_destino <> v_destino then
    raise exception '%', 'DATOS_INVALIDOS: Los montos no coinciden con el cálculo del servidor.' using errcode = 'P0001';
  end if;

  update public.pay_transferencias set
    comision_centavos = v_comision,
    neto_centavos = v_neto,
    tasa = v_tasa,
    tasa_fuente = v_fuente,
    monto_destino = v_destino,
    cotizada_en = now()
  where id = p_transferencia
  returning * into v_transferencia;

  insert into public.pay_historial (transferencia_id, estado, detalle)
  values (p_transferencia, 'creada', 'Cotización actualizada');

  insert into public.auditoria (actor_id, accion, entidad, entidad_id, detalle)
  values (p_actor, 'transferencia.cotizacion', 'transferencia', p_transferencia::text,
          jsonb_build_object('monto_destino', v_destino));

  return v_transferencia;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Changes of state

-- Procesar never moves a Lightning transfer: BTCPay's settled invoice does (pay_confirmar_btcpay).
create or replace function public.pay_procesar(p_transferencia uuid, p_actor uuid) returns public.pay_transferencias
language plpgsql security definer set search_path = public as $$
declare
  v_transferencia public.pay_transferencias;
begin
  select * into v_transferencia from public.pay_transferencias where id = p_transferencia for update;
  if not found then
    raise exception '%', 'NO_ENCONTRADA: No encontramos esa transferencia.' using errcode = 'P0001';
  end if;
  if p_actor is null or (p_actor is distinct from v_transferencia.remitente_id and not public._pay_es_admin(p_actor)) then
    raise exception '%', 'NO_PERMITIDO: Solo quien envía o un administrador puede procesar la transferencia.' using errcode = 'P0001';
  end if;
  if v_transferencia.entrega = 'lightning' then
    raise exception '%', 'NO_PERMITIDO: Un envío por Lightning sale cuando quien envía paga la factura.' using errcode = 'P0001';
  end if;
  if v_transferencia.estado <> 'creada' then
    raise exception '%', 'ESTADO_INVALIDO: Esta transferencia ya no se puede procesar.' using errcode = 'P0001';
  end if;

  return public._pay_avanzar(p_transferencia, p_actor, 'procesando', 'Transferencia en proceso.', null);
end;
$$;

-- A paid transfer cannot be marked as failed: its money must be returned first.
create or replace function public.pay_fallar(p_transferencia uuid, p_actor uuid, p_motivo text) returns public.pay_transferencias
language plpgsql security definer set search_path = public as $$
declare
  v_transferencia public.pay_transferencias;
  v_motivo text;
begin
  select * into v_transferencia from public.pay_transferencias where id = p_transferencia for update;
  if not found then
    raise exception '%', 'NO_ENCONTRADA: No encontramos esa transferencia.' using errcode = 'P0001';
  end if;
  if p_actor is not null and not public._pay_es_admin(p_actor) then
    raise exception '%', 'NO_PERMITIDO: Solo un administrador puede marcar la transferencia como fallida.' using errcode = 'P0001';
  end if;
  v_motivo := public._texto_valido(p_motivo, 4, 200, 'El motivo tiene que tener entre 4 y 200 caracteres.');
  if v_transferencia.pagada_en is not null then
    raise exception '%', 'ESTADO_INVALIDO: Este envío ya está pagado: hay que devolver el dinero antes de marcarlo como fallido.' using errcode = 'P0001';
  end if;
  if v_transferencia.estado not in ('creada', 'procesando') then
    raise exception '%', 'ESTADO_INVALIDO: Esta transferencia ya no se puede marcar como fallida.' using errcode = 'P0001';
  end if;

  return public._pay_avanzar(p_transferencia, p_actor, 'fallida', 'Transferencia fallida: ' || v_motivo, v_motivo);
end;
$$;

-- The sender asks for an invoice: the one just made is recorded too (pay_facturas).
create or replace function public.pay_registrar_factura(p_transferencia uuid, p_actor uuid, p_factura_id text,
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

  insert into public.pay_facturas (btcpay_factura_id, transferencia_id, factura, sats, expira)
  values (p_factura_id, p_transferencia, p_factura, p_sats, p_expira);

  insert into public.auditoria (actor_id, accion, entidad, entidad_id, detalle)
  values (p_actor, 'transferencia.factura', 'transferencia', p_transferencia::text,
          jsonb_build_object('sats', p_sats));

  return v_transferencia;
end;
$$;

-- BTCPay says an invoice of this transfer is Settled. Any invoice the transfer has issued counts.
--   creada: the payment is recorded and the transfer moves to procesando, as before.
--   procesando or completada: nothing to do, the call changes nothing.
--   cancelada or fallida: the money arrived for a closed transfer. It is kept as a late payment (pago_tardio_en)
--     so an administrator returns it. Not an error: the webhook must not be retried for it.
create or replace function public.pay_confirmar_btcpay(p_factura_id text) returns public.pay_transferencias
language plpgsql security definer set search_path = public as $$
declare
  v_transferencia public.pay_transferencias;
  v_transferencia_id uuid;
begin
  select pf.transferencia_id into v_transferencia_id from public.pay_facturas pf
  where pf.btcpay_factura_id = p_factura_id;
  if not found then
    raise exception '%', 'NO_ENCONTRADA: No encontramos esa factura.' using errcode = 'P0001';
  end if;

  select * into v_transferencia from public.pay_transferencias where id = v_transferencia_id for update;

  if v_transferencia.estado = 'creada' then
    update public.pay_transferencias set pagada_en = coalesce(pagada_en, now()) where id = v_transferencia.id;
    return public._pay_avanzar(v_transferencia.id, v_transferencia.remitente_id, 'procesando',
      'Pagado con Lightning. Transferencia en proceso.', null);
  end if;

  if v_transferencia.estado in ('procesando', 'completada') then
    return v_transferencia;
  end if;

  -- Cancelada or fallida: record the late payment once, however many times the webhook repeats.
  if v_transferencia.pago_tardio_en is null then
    update public.pay_transferencias set pago_tardio_en = now() where id = v_transferencia.id
    returning * into v_transferencia;

    insert into public.pay_historial (transferencia_id, estado, detalle)
    values (v_transferencia.id, v_transferencia.estado,
      case when v_transferencia.estado = 'cancelada'
        then 'Pago recibido después de cancelar: hay que devolverlo.'
        else 'Pago recibido después de cerrar el envío: hay que devolverlo.' end);

    insert into public.auditoria (actor_id, accion, entidad, entidad_id, detalle)
    values (null, 'transferencia.pago_tardio', 'transferencia', v_transferencia.id::text,
            jsonb_build_object('factura', p_factura_id));
  end if;

  select * into v_transferencia from public.pay_transferencias where id = v_transferencia_id;
  return v_transferencia;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Claims

-- The recipient starts a claim. Refused unless the sender has paid (pagada_en). The hash of the
-- recipient's invoice is stored before BTCPay is asked to pay it. A claim that ended 'fallido' may be
-- retried only because that attempt was verified as failed by the server (pay_terminar_cobro).
-- Limit: 10 claim attempts per token per hour.
drop function if exists public.pay_iniciar_cobro(text, text, bigint);

create function public.pay_iniciar_cobro(p_token text, p_factura text, p_sats bigint, p_hash text)
returns public.pay_transferencias
language plpgsql security definer set search_path = public as $$
declare
  v_transferencia public.pay_transferencias;
  v_ventana_abierta boolean;
begin
  select * into v_transferencia from public.pay_transferencias
  where cobro_token = p_token for update;
  if not found or v_transferencia.entrega <> 'lightning' then
    raise exception '%', 'NO_ENCONTRADA: No encontramos ese envío.' using errcode = 'P0001';
  end if;

  if v_transferencia.estado = 'creada' then
    raise exception '%', 'ESTADO_INVALIDO: Tu envío todavía está esperando el pago de quien lo manda.' using errcode = 'P0001';
  end if;
  if v_transferencia.pagada_en is null then
    raise exception '%', 'ESTADO_INVALIDO: Tu envío todavía no está pagado. No se puede cobrar.' using errcode = 'P0001';
  end if;
  if v_transferencia.estado = 'completada' then
    raise exception '%', 'ESTADO_INVALIDO: Este envío ya se cobró.' using errcode = 'P0001';
  end if;
  if v_transferencia.estado = 'cancelada' then
    raise exception '%', 'ESTADO_INVALIDO: Este envío se canceló. No se puede cobrar.' using errcode = 'P0001';
  end if;
  if v_transferencia.estado = 'fallida' then
    raise exception '%', 'ESTADO_INVALIDO: Este envío no se pudo entregar. No se puede cobrar.' using errcode = 'P0001';
  end if;

  if v_transferencia.cobro_estado = 'pagando' then
    raise exception '%', 'ESTADO_INVALIDO: Ya hay un cobro en curso.' using errcode = 'P0001';
  end if;
  if v_transferencia.cobro_estado = 'pagado' then
    raise exception '%', 'ESTADO_INVALIDO: Este envío ya se cobró.' using errcode = 'P0001';
  end if;

  v_ventana_abierta := v_transferencia.cobro_intentos_desde is not null
    and v_transferencia.cobro_intentos_desde > now() - interval '1 hour';
  if v_ventana_abierta and v_transferencia.cobro_intentos >= 10 then
    raise exception '%', 'DEMASIADOS_INTENTOS: Demasiados intentos. Probá de nuevo en una hora.' using errcode = 'P0001';
  end if;

  if p_factura is null or char_length(p_factura) > 2000 or p_factura !~ '^ln(bc|tb|bcrt)[0-9a-z]+$' then
    raise exception '%', 'DATOS_INVALIDOS: Pegá una factura Lightning (empieza con lnbc, lntb o lnbcrt).' using errcode = 'P0001';
  end if;
  if p_sats is distinct from v_transferencia.monto_destino then
    raise exception '%', 'DATOS_INVALIDOS: La factura tiene que ser exactamente por ' || v_transferencia.monto_destino || ' sats.' using errcode = 'P0001';
  end if;
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then
    raise exception '%', 'DATOS_INVALIDOS: La factura no tiene el hash del pago.' using errcode = 'P0001';
  end if;

  update public.pay_transferencias set
    cobro_estado = 'pagando',
    cobro_factura = p_factura,
    cobro_hash = p_hash,
    cobro_motivo = null,
    cobro_intento_en = now(),
    cobro_intentos = case when v_ventana_abierta then cobro_intentos + 1 else 1 end,
    cobro_intentos_desde = case when v_ventana_abierta then cobro_intentos_desde else now() end
  where id = v_transferencia.id
  returning * into v_transferencia;

  insert into public.pay_historial (transferencia_id, estado, detalle)
  values (v_transferencia.id, v_transferencia.estado, 'El destinatario pidió cobrar por Lightning.');

  return v_transferencia;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Grants: only the server (service role) runs these. Helpers run as the owner only.

revoke execute on function public.pay_recotizar(uuid, uuid, numeric, text, integer, bigint) from public, anon, authenticated;
grant execute on function public.pay_recotizar(uuid, uuid, numeric, text, integer, bigint) to service_role;

revoke execute on function public.pay_iniciar_cobro(text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.pay_iniciar_cobro(text, text, bigint, text) to service_role;
