-- Cacao Pay: the sender gets the money back when nobody claims a paid Lightning transfer.
--
-- 1. The claim window is 7 days after the transfer was paid. The one constant is _pay_ventana_cobro; the
--    trigger _pay_vencer_cobro writes the end of the window (cobro_vence_en) when the transfer is paid.
-- 2. A claim starts only inside the window (pay_iniciar_cobro). After it, the claim link is expired.
-- 3. A refund starts only after the window, for a paid transfer that is still processing and not being
--    claimed (pay_iniciar_devolucion). It is reserved on the same row, under the same lock, as a claim:
--    "pagando" is stored before BTCPay is asked, and it stays there until BTCPay answers (pay_terminar_devolucion).
--    While a claim or a refund holds the reservation, the other one is refused, so the money leaves once.
-- 4. A refund attempt is limited to 10 per transfer per hour, as a claim is.
-- 5. The state devuelta is the only way a transfer ends with the money back. It is written only by
--    pay_terminar_devolucion.
-- Nothing here moves money. The server calls these functions with the service role.

-- ---------------------------------------------------------------------------------------------
-- The constant

-- The claim window: 7 days after the transfer was paid. The only place this number is written.
create function public._pay_ventana_cobro() returns interval
language sql immutable set search_path = public as $$
  select interval '7 days';
$$;

-- ---------------------------------------------------------------------------------------------
-- State

-- The state devuelta: the money went back to the sender, because nobody claimed the transfer in time.
alter type public.pay_estado add value if not exists 'devuelta';

-- ---------------------------------------------------------------------------------------------
-- Columns

alter table public.pay_transferencias
  -- When the claim window ends. Set once, when the transfer is paid (_pay_vencer_cobro).
  add column cobro_vence_en timestamptz,
  -- The refund: pagando while BTCPay is asked, pagado when it paid, fallido when it refused (a retry is allowed).
  add column devolucion_estado text check (devolucion_estado in ('pagando', 'pagado', 'fallido')),
  add column devolucion_factura text check (devolucion_factura is null or char_length(devolucion_factura) <= 2000),
  add column devolucion_hash text check (devolucion_hash is null or char_length(devolucion_hash) between 1 and 128),
  add column devolucion_motivo text check (devolucion_motivo is null or char_length(devolucion_motivo) <= 200),
  add column devolucion_intento_en timestamptz,
  add column devolucion_intentos integer not null default 0 check (devolucion_intentos >= 0),
  add column devolucion_intentos_desde timestamptz,
  -- When the money went back. Set together with the state devuelta.
  add column devuelta_en timestamptz;

-- Paid transfers get the end of their window too.
update public.pay_transferencias set cobro_vence_en = pagada_en + public._pay_ventana_cobro()
where pagada_en is not null and cobro_vence_en is null;

alter table public.pay_transferencias
  add constraint pay_transferencias_plazo_cobro check ((pagada_en is null) = (cobro_vence_en is null)),
  add constraint pay_transferencias_devolucion_coherente check (
    (devolucion_estado is null or devolucion_factura is not null)
    and (devolucion_estado <> 'pagado' or (devolucion_hash is not null and devuelta_en is not null))
    -- The text cast keeps the new enum value out of this statement, which PostgreSQL forbids in the same transaction.
    and (estado::text <> 'devuelta' or devolucion_estado = 'pagado')
  );

-- ---------------------------------------------------------------------------------------------
-- Window

-- Written when the transfer gets its paid date: the window runs from that moment.
create function public._pay_vencer_cobro() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.pagada_en is not null and new.cobro_vence_en is null then
    new.cobro_vence_en := new.pagada_en + public._pay_ventana_cobro();
  end if;
  return new;
end;
$$;

create trigger pay_transferencias_plazo_cobro
  before insert or update of pagada_en on public.pay_transferencias
  for each row execute function public._pay_vencer_cobro();

-- ---------------------------------------------------------------------------------------------
-- Claims: inside the window only, and never while a refund holds the reservation

-- The recipient starts a claim. Refused unless the sender has paid, the window is open, and no refund is
-- reserved for the transfer. The hash of the recipient's invoice is stored before BTCPay is asked to pay it.
-- A claim that ended 'fallido' may be retried only because that attempt was verified as failed.
-- Limit: 10 claim attempts per token per hour.
create or replace function public.pay_iniciar_cobro(p_token text, p_factura text, p_sats bigint, p_hash text)
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
  if v_transferencia.estado = 'devuelta' then
    raise exception '%', 'ESTADO_INVALIDO: Este envío se devolvió a quien lo mandó. No se puede cobrar.' using errcode = 'P0001';
  end if;

  if v_transferencia.cobro_estado = 'pagando' then
    raise exception '%', 'ESTADO_INVALIDO: Ya hay un cobro en curso.' using errcode = 'P0001';
  end if;
  if v_transferencia.cobro_estado = 'pagado' then
    raise exception '%', 'ESTADO_INVALIDO: Este envío ya se cobró.' using errcode = 'P0001';
  end if;
  if v_transferencia.devolucion_estado in ('pagando', 'pagado') then
    raise exception '%', 'ESTADO_INVALIDO: Quien envió el dinero lo está recuperando. No se puede cobrar.' using errcode = 'P0001';
  end if;

  if now() >= v_transferencia.cobro_vence_en then
    raise exception '%', 'COBRO_VENCIDO: El enlace de cobro venció. Quien te mandó el dinero puede recuperarlo.' using errcode = 'P0001';
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
-- Refunds: after the window only, and never while a claim holds the reservation

-- The sender asks for the money back. Only the sender of the transfer, once the window has closed, for a
-- paid transfer that is still processing. The amount is the one the sender paid (factura_sats). The refund is
-- reserved on the row under the same lock as a claim, before BTCPay is asked to pay the invoice.
-- Limit: 10 refund attempts per transfer per hour.
create function public.pay_iniciar_devolucion(p_transferencia uuid, p_actor uuid, p_factura text, p_sats bigint, p_hash text)
returns public.pay_transferencias
language plpgsql security definer set search_path = public as $$
declare
  v_transferencia public.pay_transferencias;
  v_ventana_abierta boolean;
begin
  select * into v_transferencia from public.pay_transferencias
  where id = p_transferencia for update;
  if not found then
    raise exception '%', 'NO_ENCONTRADA: No encontramos esa transferencia.' using errcode = 'P0001';
  end if;
  if p_actor is null or p_actor is distinct from v_transferencia.remitente_id then
    raise exception '%', 'NO_PERMITIDO: Solo quien envió puede recuperar el dinero.' using errcode = 'P0001';
  end if;
  if v_transferencia.entrega <> 'lightning' or v_transferencia.pagada_en is null then
    raise exception '%', 'ESTADO_INVALIDO: Este envío no tiene dinero pagado por Lightning para recuperar.' using errcode = 'P0001';
  end if;
  if v_transferencia.estado <> 'procesando' then
    raise exception '%', 'ESTADO_INVALIDO: Solo se recupera el dinero de un envío que todavía no se cobró.' using errcode = 'P0001';
  end if;

  if v_transferencia.cobro_estado = 'pagando' then
    raise exception '%', 'ESTADO_INVALIDO: Hay un cobro en curso. Esperá a que termine antes de recuperar el dinero.' using errcode = 'P0001';
  end if;
  if v_transferencia.cobro_estado = 'pagado' then
    raise exception '%', 'ESTADO_INVALIDO: Este envío ya se cobró.' using errcode = 'P0001';
  end if;
  if v_transferencia.devolucion_estado = 'pagando' then
    raise exception '%', 'ESTADO_INVALIDO: Ya hay una devolución en curso.' using errcode = 'P0001';
  end if;
  if v_transferencia.devolucion_estado = 'pagado' then
    raise exception '%', 'ESTADO_INVALIDO: Este dinero ya se devolvió.' using errcode = 'P0001';
  end if;

  if now() < v_transferencia.cobro_vence_en then
    raise exception '%', 'PLAZO_VIGENTE: Todavía se puede cobrar este envío. Vas a poder recuperar el dinero cuando venza el plazo.' using errcode = 'P0001';
  end if;

  v_ventana_abierta := v_transferencia.devolucion_intentos_desde is not null
    and v_transferencia.devolucion_intentos_desde > now() - interval '1 hour';
  if v_ventana_abierta and v_transferencia.devolucion_intentos >= 10 then
    raise exception '%', 'DEMASIADOS_INTENTOS: Demasiados intentos. Probá de nuevo en una hora.' using errcode = 'P0001';
  end if;

  if p_factura is null or char_length(p_factura) > 2000 or p_factura !~ '^ln(bc|tb|bcrt)[0-9a-z]+$' then
    raise exception '%', 'DATOS_INVALIDOS: Pegá una factura Lightning (empieza con lnbc, lntb o lnbcrt).' using errcode = 'P0001';
  end if;
  if p_sats is distinct from v_transferencia.factura_sats then
    raise exception '%', 'DATOS_INVALIDOS: La factura tiene que ser exactamente por ' || v_transferencia.factura_sats || ' sats.' using errcode = 'P0001';
  end if;
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then
    raise exception '%', 'DATOS_INVALIDOS: La factura no tiene el hash del pago.' using errcode = 'P0001';
  end if;

  update public.pay_transferencias set
    devolucion_estado = 'pagando',
    devolucion_factura = p_factura,
    devolucion_hash = p_hash,
    devolucion_motivo = null,
    devolucion_intento_en = now(),
    devolucion_intentos = case when v_ventana_abierta then devolucion_intentos + 1 else 1 end,
    devolucion_intentos_desde = case when v_ventana_abierta then devolucion_intentos_desde else now() end
  where id = v_transferencia.id
  returning * into v_transferencia;

  insert into public.pay_historial (transferencia_id, estado, detalle)
  values (v_transferencia.id, v_transferencia.estado, 'El remitente pidió recuperar el dinero por Lightning.');

  insert into public.auditoria (actor_id, accion, entidad, entidad_id, detalle)
  values (p_actor, 'transferencia.devolucion', 'transferencia', v_transferencia.id::text,
          jsonb_build_object('sats', p_sats));

  return v_transferencia;
end;
$$;

-- The server reports how the refund ended. Only a refund that is reserved (pagando) can end here.
-- p_ok = true: the money went back. The transfer moves to devuelta when it is still processing; if an
-- administrator closed it meanwhile, the refund is still recorded, and the history says so.
-- p_ok = false: BTCPay refused the payment, no money left; the sender can try again with another invoice.
create function public.pay_terminar_devolucion(p_transferencia uuid, p_ok boolean, p_hash text, p_motivo text)
returns public.pay_transferencias
language plpgsql security definer set search_path = public as $$
declare
  v_transferencia public.pay_transferencias;
  v_estado_previo public.pay_estado;
  v_motivo text;
begin
  select * into v_transferencia from public.pay_transferencias
  where id = p_transferencia for update;
  if not found then
    raise exception '%', 'NO_ENCONTRADA: No encontramos esa transferencia.' using errcode = 'P0001';
  end if;
  if v_transferencia.devolucion_estado is distinct from 'pagando' then
    raise exception '%', 'ESTADO_INVALIDO: No hay una devolución en curso para este envío.' using errcode = 'P0001';
  end if;
  if p_ok is null then
    raise exception '%', 'DATOS_INVALIDOS: Falta el resultado de la devolución.' using errcode = 'P0001';
  end if;

  if p_ok then
    if p_hash is null or char_length(p_hash) not between 1 and 128 then
      raise exception '%', 'DATOS_INVALIDOS: Falta el hash del pago.' using errcode = 'P0001';
    end if;

    v_estado_previo := v_transferencia.estado;
    update public.pay_transferencias set
      devolucion_estado = 'pagado',
      devolucion_hash = p_hash,
      devolucion_motivo = null,
      devuelta_en = now(),
      estado = case when v_estado_previo = 'procesando' then 'devuelta' else estado end
    where id = v_transferencia.id
    returning * into v_transferencia;

    if v_estado_previo = 'procesando' then
      insert into public.pay_historial (transferencia_id, estado, detalle)
      values (v_transferencia.id, 'devuelta', 'Devuelto por Lightning a quien lo envió.');

      insert into public.auditoria (actor_id, accion, entidad, entidad_id, detalle)
      values (null, 'transferencia.devuelta', 'transferencia', v_transferencia.id::text,
              jsonb_build_object('hacia', 'devuelta'));
    else
      insert into public.pay_historial (transferencia_id, estado, detalle)
      values (v_transferencia.id, v_transferencia.estado,
              'Devuelto por Lightning después de cerrar el envío. Revisar en BTCPay.');
    end if;
    return v_transferencia;
  end if;

  v_motivo := left(coalesce(nullif(btrim(p_motivo), ''), 'No se pudo devolver el dinero. Pedí otra factura.'), 200);
  update public.pay_transferencias set
    devolucion_estado = 'fallido',
    devolucion_motivo = v_motivo
  where id = v_transferencia.id
  returning * into v_transferencia;

  return v_transferencia;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Grants: only the server (service role) runs these. Helpers run as the owner only.

revoke execute on function public.pay_iniciar_cobro(text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.pay_iniciar_cobro(text, text, bigint, text) to service_role;

revoke execute on function public.pay_iniciar_devolucion(uuid, uuid, text, bigint, text) from public, anon, authenticated;
grant execute on function public.pay_iniciar_devolucion(uuid, uuid, text, bigint, text) to service_role;

revoke execute on function public.pay_terminar_devolucion(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.pay_terminar_devolucion(uuid, boolean, text, text) to service_role;

revoke execute on function public._pay_ventana_cobro() from public, anon, authenticated, service_role;
revoke execute on function public._pay_vencer_cobro() from public, anon, authenticated, service_role;
