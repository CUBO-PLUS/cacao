-- Cacao Pay: the payments API (v1). Media, Travel and Market charge through Pay instead of calling BTCPay.
--
-- 1. API clients. A key is shown once: only its SHA-256 hash is stored, with a visible prefix to find it. A client
--    charges its own store. Another store is allowed only when puede_elegir_tienda is set and the store is listed
--    for that client (pay_api_tiendas). Each request counts against a per-key limit (pay_api_cuota).
-- 2. Charges (pay_cobros). An Idempotency-Key is unique per client: a repeat returns the first charge, and a repeat
--    with another body is refused (pay_reservar_cobro). The invoice is made outside the database, so the charge is
--    reserved first, with no invoice, and the invoice is recorded afterwards (pay_registrar_factura_cobro). A
--    reservation that BTCPay refused is released (pay_liberar_reserva).
-- 3. States change only in functions that lock the row. A charge is paid only when BTCPay says Settled
--    (pay_aplicar_btcpay). A cancelled charge that BTCPay later settles keeps its state and records the payment as
--    late (pago_tardio_en), so a paid charge can never be cancelled (pay_cancelar_cobro).
-- 4. Notices (pay_avisos) are written in the same change as the state, once per charge and state.
-- Nothing here moves money. The server calls these functions with the service role.

-- ---------------------------------------------------------------------------------------------
-- Tables

create table public.pay_api_clientes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (char_length(btrim(nombre)) between 1 and 80),
  -- The first characters of the key, shown in lists. Unique, so the key is found by its prefix.
  prefijo text not null unique check (prefijo ~ '^cp_[A-Za-z0-9_-]{8}$'),
  -- SHA-256 of the whole key, in hex. The key itself is never stored.
  clave_hash text not null unique check (clave_hash ~ '^[0-9a-f]{64}$'),
  -- The store this client charges by default.
  tienda_btcpay text not null check (tienda_btcpay ~ '^[A-Za-z0-9]{10,64}$'),
  puede_elegir_tienda boolean not null default false,
  -- Secret that signs the notices sent to the client (Cacao-Firma). Read by the server only.
  aviso_secreto text not null check (aviso_secreto ~ '^[0-9a-f]{64}$'),
  -- Requests in the current minute, and when that minute started.
  cuota_ventana_en timestamptz,
  cuota_usos integer not null default 0 check (cuota_usos >= 0),
  creado_en timestamptz not null default now(),
  revocado_en timestamptz
);

create table public.pay_api_tiendas (
  cliente_id uuid not null references public.pay_api_clientes (id) on delete cascade,
  tienda_btcpay text not null check (tienda_btcpay ~ '^[A-Za-z0-9]{10,64}$'),
  primary key (cliente_id, tienda_btcpay)
);

create table public.pay_cobros (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.pay_api_clientes (id),
  clave_idempotencia text not null check (char_length(clave_idempotencia) between 8 and 128),
  -- Hash of the request body: the same key with another body is refused.
  huella text not null check (huella ~ '^[0-9a-f]{64}$'),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'pagado', 'vencido', 'cancelado')),
  tienda_btcpay text not null check (tienda_btcpay ~ '^[A-Za-z0-9]{10,64}$'),
  moneda text not null check (moneda in ('USD', 'SATS')),
  -- What the client asked for: US cents when moneda is USD, sats when SATS.
  monto bigint not null check (monto > 0),
  -- Computed by the server and stored: the sats the invoice asks for, its US cents and the BTC price used.
  sats bigint not null check (sats > 0),
  usd_centavos bigint not null check (usd_centavos > 0),
  cotizacion_usd_btc numeric not null check (cotizacion_usd_btc > 0),
  descripcion text not null check (char_length(btrim(descripcion)) between 1 and 200),
  referencia text not null check (char_length(btrim(referencia)) between 1 and 120),
  producto text not null check (producto in ('media', 'travel', 'market', 'pay')),
  aviso_url text check (aviso_url is null or char_length(aviso_url) <= 500),
  vence_en_segundos integer not null check (vence_en_segundos between 300 and 86400),
  -- Null while the reservation waits for its invoice.
  btcpay_factura_id text unique check (btcpay_factura_id ~ '^[A-Za-z0-9]{10,64}$'),
  factura text check (factura is null or char_length(factura) <= 2000),
  expira_en timestamptz,
  hash_pago text check (hash_pago is null or hash_pago ~ '^[0-9a-f]{64}$'),
  pagado_en timestamptz,
  cancelado_en timestamptz,
  -- A payment that arrived after the charge was cancelled. It is recorded, not counted as paid.
  pago_tardio_en timestamptz,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (cliente_id, clave_idempotencia),
  constraint pay_cobros_factura_completa check ((btcpay_factura_id is null) = (factura is null)
    and (factura is null) = (expira_en is null)),
  constraint pay_cobros_pagado_coherente check ((estado = 'pagado') = (pagado_en is not null)),
  constraint pay_cobros_cancelado_coherente check ((estado = 'cancelado') = (cancelado_en is not null))
);

create table public.pay_avisos (
  id uuid primary key default gen_random_uuid(),
  cobro_id uuid not null references public.pay_cobros (id) on delete cascade,
  -- The state the notice reports. One notice per charge and state.
  estado text not null check (estado in ('pagado', 'vencido', 'cancelado')),
  intentos integer not null default 0 check (intentos >= 0),
  ultimo_error text check (char_length(ultimo_error) <= 200),
  enviado_en timestamptz,
  creado_en timestamptz not null default now(),
  unique (cobro_id, estado)
);

alter table public.pay_api_clientes enable row level security;
alter table public.pay_api_tiendas enable row level security;
alter table public.pay_cobros enable row level security;
alter table public.pay_avisos enable row level security;

revoke all on public.pay_api_clientes, public.pay_api_tiendas, public.pay_cobros, public.pay_avisos
  from public, anon, authenticated;
grant all on public.pay_api_clientes, public.pay_api_tiendas, public.pay_cobros, public.pay_avisos to service_role;

-- ---------------------------------------------------------------------------------------------
-- Clients and limits

-- Creates a client with its key hash and its notice secret. The key itself is shown once, by the script.
create function public.pay_crear_cliente_api(p_nombre text, p_prefijo text, p_clave_hash text, p_tienda text,
  p_puede_elegir boolean, p_aviso_secreto text, p_tiendas text[] default '{}')
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_tienda text;
begin
  if p_prefijo is null or p_prefijo !~ '^cp_[A-Za-z0-9_-]{8}$'
     or p_clave_hash is null or p_clave_hash !~ '^[0-9a-f]{64}$'
     or p_aviso_secreto is null or p_aviso_secreto !~ '^[0-9a-f]{64}$'
     or p_tienda is null or p_tienda !~ '^[A-Za-z0-9]{10,64}$' then
    raise exception '%', 'DATOS_INVALIDOS: La clave o la tienda no son válidas.' using errcode = 'P0001';
  end if;
  if not coalesce(p_puede_elegir, false) and coalesce(cardinality(p_tiendas), 0) > 0 then
    raise exception '%', 'DATOS_INVALIDOS: Para cobrar en otras tiendas la clave tiene que poder elegir tienda.' using errcode = 'P0001';
  end if;

  insert into public.pay_api_clientes (nombre, prefijo, clave_hash, tienda_btcpay, puede_elegir_tienda, aviso_secreto)
  values (public._texto_valido(p_nombre, 1, 80, 'El nombre tiene que tener entre 1 y 80 caracteres.'),
    p_prefijo, p_clave_hash, p_tienda, coalesce(p_puede_elegir, false), p_aviso_secreto)
  returning id into v_id;

  foreach v_tienda in array coalesce(p_tiendas, '{}') loop
    if v_tienda !~ '^[A-Za-z0-9]{10,64}$' then
      raise exception '%', 'DATOS_INVALIDOS: Una de las tiendas no es válida.' using errcode = 'P0001';
    end if;
    insert into public.pay_api_tiendas (cliente_id, tienda_btcpay) values (v_id, v_tienda)
    on conflict do nothing;
  end loop;

  return v_id;
end;
$$;

-- Revokes a key by its prefix. A revoked key is refused from then on.
create function public.pay_revocar_cliente_api(p_prefijo text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.pay_api_clientes set revocado_en = now()
  where prefijo = p_prefijo and revocado_en is null;
  return found;
end;
$$;

-- Counts one request for a client. At most p_maximo per minute; the next minute starts a new count.
-- Returns false when the client is over the limit. Locks the client row, so concurrent requests count once each.
create function public.pay_api_cuota(p_cliente uuid, p_maximo integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v public.pay_api_clientes;
begin
  if p_maximo is null or p_maximo < 1 then
    raise exception '%', 'DATOS_INVALIDOS: El límite de peticiones no es válido.' using errcode = 'P0001';
  end if;
  select * into v from public.pay_api_clientes where id = p_cliente for update;
  if not found then
    return false;
  end if;
  if v.cuota_ventana_en is null or v.cuota_ventana_en <= now() - interval '1 minute' then
    update public.pay_api_clientes set cuota_ventana_en = now(), cuota_usos = 1 where id = p_cliente;
    return true;
  end if;
  if v.cuota_usos >= p_maximo then
    return false;
  end if;
  update public.pay_api_clientes set cuota_usos = cuota_usos + 1 where id = p_cliente;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Charges

-- Reserves a charge for an Idempotency-Key. Under the client's lock:
--   nuevo:     no charge had this key. The server makes the invoice next.
--   existente: the key has its invoice: the first charge is returned, and no invoice is made.
--   retomar:   a reservation without an invoice that is older than a minute (its request died): taken over.
--   refused:   the same key with another body (IDEMPOTENCIA_CONFLICTO), a reservation still in progress
--              (IDEMPOTENCIA_EN_CURSO), a store the key may not charge (NO_PERMITIDO), a revoked key (NO_AUTORIZADO).
create function public.pay_reservar_cobro(p_cliente uuid, p_clave text, p_huella text, p_tienda text, p_moneda text,
  p_monto bigint, p_sats bigint, p_usd_centavos bigint, p_cotizacion numeric, p_descripcion text, p_referencia text,
  p_producto text, p_aviso_url text, p_vence_en_segundos integer)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cliente public.pay_api_clientes;
  v_cobro public.pay_cobros;
  v_descripcion text;
  v_referencia text;
begin
  select * into v_cliente from public.pay_api_clientes where id = p_cliente for update;
  if not found or v_cliente.revocado_en is not null then
    raise exception '%', 'NO_AUTORIZADO: La clave no es válida.' using errcode = 'P0001';
  end if;

  if p_tienda is distinct from v_cliente.tienda_btcpay then
    if not v_cliente.puede_elegir_tienda or not exists (
      select 1 from public.pay_api_tiendas t where t.cliente_id = p_cliente and t.tienda_btcpay = p_tienda
    ) then
      raise exception '%', 'NO_PERMITIDO: Esta clave no puede cobrar en esa tienda.' using errcode = 'P0001';
    end if;
  end if;

  if p_clave is null or char_length(p_clave) not between 8 and 128 then
    raise exception '%', 'DATOS_INVALIDOS: La clave de idempotencia no es válida.' using errcode = 'P0001';
  end if;
  if p_huella is null or p_huella !~ '^[0-9a-f]{64}$' then
    raise exception '%', 'DATOS_INVALIDOS: La huella del cobro no es válida.' using errcode = 'P0001';
  end if;
  if p_moneda is null or p_moneda not in ('USD', 'SATS') then
    raise exception '%', 'DATOS_INVALIDOS: La moneda tiene que ser USD o SATS.' using errcode = 'P0001';
  end if;
  if p_monto is null or p_monto <= 0 or p_sats is null or p_sats <= 0
     or p_usd_centavos is null or p_usd_centavos <= 0 or p_cotizacion is null or p_cotizacion <= 0 then
    raise exception '%', 'DATOS_INVALIDOS: El monto no es válido.' using errcode = 'P0001';
  end if;
  if p_producto is null or p_producto not in ('media', 'travel', 'market', 'pay') then
    raise exception '%', 'DATOS_INVALIDOS: El producto no es válido.' using errcode = 'P0001';
  end if;
  if p_vence_en_segundos is null or p_vence_en_segundos not between 300 and 86400 then
    raise exception '%', 'DATOS_INVALIDOS: El plazo tiene que estar entre 300 y 86400 segundos.' using errcode = 'P0001';
  end if;
  if p_aviso_url is not null and char_length(p_aviso_url) > 500 then
    raise exception '%', 'DATOS_INVALIDOS: La dirección de aviso es demasiado larga.' using errcode = 'P0001';
  end if;
  v_descripcion := public._texto_valido(p_descripcion, 1, 200, 'La descripción tiene que tener entre 1 y 200 caracteres.');
  v_referencia := public._texto_valido(p_referencia, 1, 120, 'La referencia tiene que tener entre 1 y 120 caracteres.');

  select * into v_cobro from public.pay_cobros where cliente_id = p_cliente and clave_idempotencia = p_clave;
  if found then
    if v_cobro.huella <> p_huella then
      raise exception '%', 'IDEMPOTENCIA_CONFLICTO: Esa clave ya se usó con otro cobro.' using errcode = 'P0001';
    end if;
    if v_cobro.btcpay_factura_id is not null then
      return jsonb_build_object('situacion', 'existente', 'cobro', to_jsonb(v_cobro));
    end if;
    if v_cobro.actualizado_en > now() - interval '60 seconds' then
      raise exception '%', 'IDEMPOTENCIA_EN_CURSO: Ya se está creando el cobro con esa clave. Probá de nuevo en un momento.' using errcode = 'P0001';
    end if;
    update public.pay_cobros set actualizado_en = now() where id = v_cobro.id returning * into v_cobro;
    return jsonb_build_object('situacion', 'retomar', 'cobro', to_jsonb(v_cobro));
  end if;

  insert into public.pay_cobros (cliente_id, clave_idempotencia, huella, tienda_btcpay, moneda, monto, sats,
    usd_centavos, cotizacion_usd_btc, descripcion, referencia, producto, aviso_url, vence_en_segundos)
  values (p_cliente, p_clave, p_huella, p_tienda, p_moneda, p_monto, p_sats, p_usd_centavos, p_cotizacion,
    v_descripcion, v_referencia, p_producto, p_aviso_url, p_vence_en_segundos)
  returning * into v_cobro;

  return jsonb_build_object('situacion', 'nuevo', 'cobro', to_jsonb(v_cobro));
end;
$$;

-- Records the invoice BTCPay made for a reserved charge. Repeating the same invoice changes nothing.
create function public.pay_registrar_factura_cobro(p_id uuid, p_factura_id text, p_factura text, p_expira timestamptz)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cobro public.pay_cobros;
begin
  select * into v_cobro from public.pay_cobros where id = p_id for update;
  if not found then
    raise exception '%', 'NO_ENCONTRADA: No encontramos ese cobro.' using errcode = 'P0001';
  end if;
  if v_cobro.btcpay_factura_id is not null then
    if v_cobro.btcpay_factura_id = p_factura_id then
      return to_jsonb(v_cobro);
    end if;
    raise exception '%', 'ESTADO_INVALIDO: Este cobro ya tiene una factura.' using errcode = 'P0001';
  end if;
  if p_factura_id is null or p_factura_id !~ '^[A-Za-z0-9]{10,64}$'
     or p_factura is null or char_length(p_factura) not between 1 and 2000 or p_factura !~ '^ln[0-9a-z]+$'
     or p_expira is null then
    raise exception '%', 'DATOS_INVALIDOS: La factura no es válida.' using errcode = 'P0001';
  end if;

  update public.pay_cobros set btcpay_factura_id = p_factura_id, factura = p_factura, expira_en = p_expira,
    actualizado_en = now()
  where id = p_id
  returning * into v_cobro;
  return to_jsonb(v_cobro);
end;
$$;

-- Drops a reservation that BTCPay refused, so the same key can try again. Only without an invoice.
create function public.pay_liberar_reserva(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  delete from public.pay_cobros where id = p_id and btcpay_factura_id is null;
  return found;
end;
$$;

-- The charge, for its own client only. Null for anyone else, so the charge is not found.
create function public.pay_leer_cobro(p_cliente uuid, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cobro public.pay_cobros;
begin
  select * into v_cobro from public.pay_cobros where id = p_id and cliente_id = p_cliente;
  if not found then
    return null;
  end if;
  return to_jsonb(v_cobro);
end;
$$;

-- BTCPay says the invoice of a charge is Settled, Expired or Invalid. Only the server calls this, after it has read
-- the invoice from BTCPay. Returns cambio (the state changed) and the aviso to send, when there is one.
--   Settled:  pendiente or vencido -> pagado. cancelado stays cancelado; the payment is recorded as late.
--   Expired:  pendiente -> vencido.
--   Invalid:  pendiente -> cancelado.
create function public.pay_aplicar_btcpay(p_factura_id text, p_estado text, p_hash text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cobro public.pay_cobros;
  v_cambio boolean := false;
  v_aviso uuid;
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
    insert into public.pay_avisos (cobro_id, estado)
    select v_cobro.id, v_cobro.estado where v_cobro.aviso_url is not null
    on conflict (cobro_id, estado) do nothing
    returning id into v_aviso;
    insert into public.auditoria (actor_id, accion, entidad, entidad_id, detalle)
    values (null, 'cobro.estado', 'cobro', v_cobro.id::text,
      jsonb_build_object('estado', v_cobro.estado, 'btcpay', p_estado));
  end if;

  return jsonb_build_object('cambio', v_cambio, 'cobro', to_jsonb(v_cobro), 'aviso_id', v_aviso);
end;
$$;

-- The client cancels its own pending charge. A paid charge cannot be cancelled. Cancelling again changes nothing.
create function public.pay_cancelar_cobro(p_cliente uuid, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cobro public.pay_cobros;
  v_aviso uuid;
begin
  select * into v_cobro from public.pay_cobros where id = p_id for update;
  if not found or v_cobro.cliente_id <> p_cliente then
    raise exception '%', 'NO_ENCONTRADA: No encontramos ese cobro.' using errcode = 'P0001';
  end if;
  if v_cobro.estado = 'pagado' then
    raise exception '%', 'ESTADO_INVALIDO: Este cobro ya está pagado: no se puede cancelar.' using errcode = 'P0001';
  end if;
  if v_cobro.estado = 'cancelado' then
    return jsonb_build_object('cambio', false, 'cobro', to_jsonb(v_cobro), 'aviso_id', null);
  end if;
  if v_cobro.estado <> 'pendiente' then
    raise exception '%', 'ESTADO_INVALIDO: Este cobro ya venció y no se puede cancelar.' using errcode = 'P0001';
  end if;

  update public.pay_cobros set estado = 'cancelado', cancelado_en = now(), actualizado_en = now()
  where id = p_id returning * into v_cobro;

  insert into public.pay_avisos (cobro_id, estado)
  select v_cobro.id, v_cobro.estado where v_cobro.aviso_url is not null
  on conflict (cobro_id, estado) do nothing
  returning id into v_aviso;

  insert into public.auditoria (actor_id, accion, entidad, entidad_id, detalle)
  values (null, 'cobro.estado', 'cobro', v_cobro.id::text, jsonb_build_object('estado', 'cancelado', 'btcpay', 'cliente'));

  return jsonb_build_object('cambio', true, 'cobro', to_jsonb(v_cobro), 'aviso_id', v_aviso);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Notices

-- The server records one attempt of a notice. A notice that was sent is not marked again.
create function public.pay_marcar_aviso(p_aviso uuid, p_ok boolean, p_error text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.pay_avisos set
    intentos = intentos + 1,
    enviado_en = case when p_ok then now() else enviado_en end,
    ultimo_error = case when p_ok then null else left(p_error, 200) end
  where id = p_aviso and enviado_en is null;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Grants: only the server (service role) runs these functions.

revoke execute on function public.pay_crear_cliente_api(text, text, text, text, boolean, text, text[]) from public, anon, authenticated;
grant execute on function public.pay_crear_cliente_api(text, text, text, text, boolean, text, text[]) to service_role;

revoke execute on function public.pay_revocar_cliente_api(text) from public, anon, authenticated;
grant execute on function public.pay_revocar_cliente_api(text) to service_role;

revoke execute on function public.pay_api_cuota(uuid, integer) from public, anon, authenticated;
grant execute on function public.pay_api_cuota(uuid, integer) to service_role;

revoke execute on function public.pay_reservar_cobro(uuid, text, text, text, text, bigint, bigint, bigint, numeric, text, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.pay_reservar_cobro(uuid, text, text, text, text, bigint, bigint, bigint, numeric, text, text, text, text, integer)
  to service_role;

revoke execute on function public.pay_registrar_factura_cobro(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.pay_registrar_factura_cobro(uuid, text, text, timestamptz) to service_role;

revoke execute on function public.pay_liberar_reserva(uuid) from public, anon, authenticated;
grant execute on function public.pay_liberar_reserva(uuid) to service_role;

revoke execute on function public.pay_leer_cobro(uuid, uuid) from public, anon, authenticated;
grant execute on function public.pay_leer_cobro(uuid, uuid) to service_role;

revoke execute on function public.pay_aplicar_btcpay(text, text, text) from public, anon, authenticated;
grant execute on function public.pay_aplicar_btcpay(text, text, text) to service_role;

revoke execute on function public.pay_cancelar_cobro(uuid, uuid) from public, anon, authenticated;
grant execute on function public.pay_cancelar_cobro(uuid, uuid) to service_role;

revoke execute on function public.pay_marcar_aviso(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.pay_marcar_aviso(uuid, boolean, text) to service_role;
