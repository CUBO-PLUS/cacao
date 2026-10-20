-- Cacao Pay: the recipient collects a Lightning transfer with a link.
--
-- A lightning transfer gets a claim token when it is created (trigger below). The recipient opens
-- /cobrar/<token>, pastes a BOLT11 invoice for exactly the sats of the transfer, and the server pays it
-- through BTCPay Server. The server then reports the outcome with pay_terminar_cobro, and only a paid
-- outcome moves the transfer to completada.
-- Nothing here moves money: these functions record what the server did. Demo: BTCPay runs on regtest.

-- ---------------------------------------------------------------------------------------------
-- Columns

alter table public.pay_transferencias
  -- Random, base64url of 32 bytes: the recipient's bearer link. Only lightning transfers have one.
  add column cobro_token text unique check (cobro_token is null or cobro_token ~ '^[A-Za-z0-9_-]{43}$'),
  -- pagando: an invoice is being paid. pagado: paid, the transfer is completada. fallido: retry allowed.
  add column cobro_estado text check (cobro_estado in ('pagando', 'pagado', 'fallido')),
  add column cobro_factura text check (cobro_factura is null or char_length(cobro_factura) <= 2000),
  add column cobro_hash text check (cobro_hash is null or char_length(cobro_hash) between 1 and 128),
  add column cobro_motivo text check (cobro_motivo is null or char_length(cobro_motivo) <= 200),
  add column cobrada_en timestamptz,
  add constraint pay_transferencias_cobro_coherente check (
    (cobro_token is null or entrega = 'lightning')
    and (cobro_estado is null or cobro_factura is not null)
    and (cobro_estado <> 'pagado' or (cobro_hash is not null and cobrada_en is not null))
  );

-- ---------------------------------------------------------------------------------------------
-- Token

-- 32 random bytes from two UUIDs (pgcrypto is not needed), in base64url without padding: 43 characters.
create function public._pay_nuevo_token() returns text
language sql volatile set search_path = public as $$
  select translate(
    encode(decode(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'hex'), 'base64'),
    '+/=', '-_');
$$;

-- Every lightning transfer gets its token when it is created.
create function public._pay_token_al_crear() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.entrega = 'lightning' and new.cobro_token is null then
    new.cobro_token := public._pay_nuevo_token();
  end if;
  return new;
end;
$$;

create trigger pay_transferencias_cobro_token
  before insert on public.pay_transferencias
  for each row execute function public._pay_token_al_crear();

-- Existing lightning transfers get a token too.
update public.pay_transferencias set cobro_token = public._pay_nuevo_token()
where entrega = 'lightning' and cobro_token is null;

-- ---------------------------------------------------------------------------------------------
-- Changes

-- The recipient asks to collect with this invoice. Only a processing transfer can be collected, and
-- only once at a time. The invoice must be for exactly the amount the recipient gets, in sats.
create function public.pay_iniciar_cobro(p_token text, p_factura text, p_sats bigint)
returns public.pay_transferencias
language plpgsql security definer set search_path = public as $$
declare
  v_transferencia public.pay_transferencias;
begin
  select * into v_transferencia from public.pay_transferencias
  where cobro_token = p_token for update;
  if not found or v_transferencia.entrega <> 'lightning' then
    raise exception '%', 'NO_ENCONTRADA: No encontramos ese envío.' using errcode = 'P0001';
  end if;

  if v_transferencia.estado = 'creada' then
    raise exception '%', 'ESTADO_INVALIDO: Tu envío todavía está esperando el pago de quien lo manda.' using errcode = 'P0001';
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

  if p_factura is null or char_length(p_factura) > 2000 or p_factura !~ '^ln(bc|tb|bcrt)[0-9a-z]+$' then
    raise exception '%', 'DATOS_INVALIDOS: Pegá una factura Lightning (empieza con lnbc, lntb o lnbcrt).' using errcode = 'P0001';
  end if;
  if p_sats is distinct from v_transferencia.monto_destino then
    raise exception '%', 'DATOS_INVALIDOS: La factura tiene que ser exactamente por ' || v_transferencia.monto_destino || ' sats.' using errcode = 'P0001';
  end if;

  update public.pay_transferencias set
    cobro_estado = 'pagando',
    cobro_factura = p_factura,
    cobro_motivo = null
  where id = v_transferencia.id
  returning * into v_transferencia;

  insert into public.pay_historial (transferencia_id, estado, detalle)
  values (v_transferencia.id, v_transferencia.estado, 'El destinatario pidió cobrar por Lightning.');

  return v_transferencia;
end;
$$;

-- The server reports how the payment of the invoice ended. Only a payment that is still being made
-- (pagando) can end here. p_ok = true moves the transfer to completada, as pay_completar does with no
-- actor; p_ok = false records the reason, and the recipient can try again with another invoice.
create function public.pay_terminar_cobro(p_token text, p_ok boolean, p_hash text, p_motivo text)
returns public.pay_transferencias
language plpgsql security definer set search_path = public as $$
declare
  v_transferencia public.pay_transferencias;
  v_motivo text;
begin
  select * into v_transferencia from public.pay_transferencias
  where cobro_token = p_token for update;
  if not found then
    raise exception '%', 'NO_ENCONTRADA: No encontramos ese envío.' using errcode = 'P0001';
  end if;
  if v_transferencia.cobro_estado is distinct from 'pagando' then
    raise exception '%', 'ESTADO_INVALIDO: No hay un cobro en curso para este envío.' using errcode = 'P0001';
  end if;
  if p_ok is null then
    raise exception '%', 'DATOS_INVALIDOS: Falta el resultado del cobro.' using errcode = 'P0001';
  end if;

  if p_ok then
    if p_hash is null or char_length(p_hash) not between 1 and 128 then
      raise exception '%', 'DATOS_INVALIDOS: Falta el hash del pago.' using errcode = 'P0001';
    end if;

    update public.pay_transferencias set
      cobro_estado = 'pagado',
      cobro_hash = p_hash,
      cobro_motivo = null,
      cobrada_en = now()
    where id = v_transferencia.id
    returning * into v_transferencia;

    if v_transferencia.estado = 'procesando' then
      return public._pay_avanzar(v_transferencia.id, null, 'completada', 'Cobrado por Lightning.', null);
    end if;

    -- The payment went through, but an administrator had already closed the transfer. The money is
    -- recorded; the state is left as it is so the history shows what happened.
    insert into public.pay_historial (transferencia_id, estado, detalle)
    values (v_transferencia.id, v_transferencia.estado,
            'Cobrado por Lightning después de cerrar el envío. Revisar en BTCPay.');
    return v_transferencia;
  end if;

  v_motivo := left(coalesce(nullif(btrim(p_motivo), ''), 'No se pudo pagar la factura. Pedí otra factura.'), 200);
  update public.pay_transferencias set
    cobro_estado = 'fallido',
    cobro_motivo = v_motivo
  where id = v_transferencia.id
  returning * into v_transferencia;

  return v_transferencia;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Grants: only the server (service role) runs these. Helpers run as the owner only.

revoke execute on function public.pay_iniciar_cobro(text, text, bigint) from public, anon, authenticated;
revoke execute on function public.pay_terminar_cobro(text, boolean, text, text) from public, anon, authenticated;

grant execute on function public.pay_iniciar_cobro(text, text, bigint) to service_role;
grant execute on function public.pay_terminar_cobro(text, boolean, text, text) to service_role;

revoke execute on function public._pay_nuevo_token() from public, anon, authenticated, service_role;
revoke execute on function public._pay_token_al_crear() from public, anon, authenticated, service_role;
