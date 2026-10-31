-- CacaoLedger API (v1), and the notices Pay sends to Ledger. Runs after 20261101000002_pay_negocios.sql.
--
-- Same rules as the other ledger and pay migrations: RLS on, no grants to anon or authenticated, every function
-- security definer with search_path set, and execute for service_role only.
--
-- 1. Clients of the API (ledger_clientes_api): only the SHA-256 hash of the key is stored. grupo = true lets a client
--    read the month's reports (the group owner). A revoked key is refused like an unknown one.
-- 2. Rate limit (ledger_api_cuota): one counter per client and minute.
-- 3. Sales of the API (ledger_ventas_api). One row per sale. A sale of product 'negocios' (a business that charges
--    with CacaoPay) is stored only here, with its negocio_id, and never becomes a ticket: no ledger_tickets row, so no
--    group total, book, export or document can count it. Dedupe: factura_id is unique (one BTCPay invoice, one sale),
--    payment_hash and ticket_id are unique, and (cliente_id, clave_idempotencia) and (cliente_id, referencia) are unique.
-- 4. ledger_reservar_venta_api takes or finds the sale of a key. ledger_completar_venta_api links the ticket it made.
-- 5. ledger_tickets.producto accepts 'negocios', so the importer can name such an invoice and skip it.
-- 6. pay_avisos has a destination: 'cliente' (the client's aviso_url, as before) or 'ledger' (a business sale reported to
--    CacaoLedger once, when it becomes pagado). A Ledger notice is never given up: it is retried until Ledger answers.

-- ---------------------------------------------------------------------------------------------
-- Tables

create table public.ledger_clientes_api (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (char_length(nombre) between 1 and 80),
  prefijo text not null unique check (prefijo ~ '^cl_[A-Za-z0-9_-]{8}$'),
  clave_hash text not null check (clave_hash ~ '^[0-9a-f]{64}$'),
  grupo boolean not null default false,
  creado_en timestamptz not null default now(),
  revocado_en timestamptz
);

create table public.ledger_api_cuotas (
  cliente_id uuid primary key references public.ledger_clientes_api (id) on delete cascade,
  ventana timestamptz not null,
  usos integer not null check (usos >= 0)
);

create table public.ledger_ventas_api (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.ledger_clientes_api (id),
  clave_idempotencia text not null check (char_length(clave_idempotencia) between 8 and 128),
  huella text not null check (huella ~ '^[0-9a-f]{64}$'),
  referencia text not null check (char_length(referencia) between 1 and 120),
  producto text not null check (producto in ('media', 'travel', 'market', 'pay', 'negocios')),
  negocio_id uuid references public.negocios (id),
  descripcion text not null check (char_length(descripcion) between 1 and 200),
  monto_centavos integer not null check (monto_centavos between 1 and 2147483647),
  medio text not null check (medio in ('lightning', 'efectivo')),
  factura_id text unique check (char_length(factura_id) between 1 and 200),
  payment_hash text unique check (payment_hash ~ '^[0-9a-f]{64}$'),
  sats bigint check (sats is null or sats > 0),
  tasa_usd_btc numeric(14, 2) check (tasa_usd_btc is null or tasa_usd_btc > 0),
  ticket_id text unique references public.ledger_tickets (id),
  estado text not null default 'reservada' check (estado in ('reservada', 'registrada')),
  creado_en timestamptz not null default now(),
  unique (cliente_id, clave_idempotencia),
  unique (cliente_id, referencia),
  constraint ledger_ventas_api_negocio check ((producto = 'negocios') = (negocio_id is not null)),
  constraint ledger_ventas_api_negocio_sin_ticket check (producto <> 'negocios' or ticket_id is null),
  constraint ledger_ventas_api_medio check ((medio = 'lightning') = (
    factura_id is not null and payment_hash is not null and sats is not null and tasa_usd_btc is not null)),
  constraint ledger_ventas_api_registrada check ((estado = 'registrada') = (ticket_id is not null or producto = 'negocios'))
);
create index ledger_ventas_api_creado on public.ledger_ventas_api (creado_en desc);
create index ledger_ventas_api_cliente on public.ledger_ventas_api (cliente_id, creado_en desc);

alter table public.ledger_clientes_api enable row level security;
alter table public.ledger_api_cuotas enable row level security;
alter table public.ledger_ventas_api enable row level security;

revoke all on public.ledger_clientes_api, public.ledger_api_cuotas, public.ledger_ventas_api from public, anon, authenticated;
grant all on public.ledger_clientes_api, public.ledger_api_cuotas, public.ledger_ventas_api to service_role;

-- The ticket product accepts 'negocios' (see the header). No ticket is ever written with it.
alter table public.ledger_tickets drop constraint ledger_tickets_producto_check;
alter table public.ledger_tickets add constraint ledger_tickets_producto_check
  check (producto is null or producto in ('media', 'travel', 'market', 'pay', 'negocios'));

-- ---------------------------------------------------------------------------------------------
-- Functions: API clients and rate limit

-- Counts one request of a client. At most p_maximo in each minute. Returns false when over.
create function public.ledger_api_cuota(p_cliente uuid, p_maximo integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_usos integer;
begin
  if p_cliente is null or p_maximo is null or p_maximo < 1 then
    raise exception '%', 'DATOS_INVALIDOS: El límite no es válido.' using errcode = 'P0001';
  end if;
  insert into public.ledger_api_cuotas (cliente_id, ventana, usos) values (p_cliente, now(), 1)
  on conflict (cliente_id) do update set
    ventana = case when public.ledger_api_cuotas.ventana <= now() - interval '60 seconds'
      then now() else public.ledger_api_cuotas.ventana end,
    usos = case when public.ledger_api_cuotas.ventana <= now() - interval '60 seconds'
      then 1 else public.ledger_api_cuotas.usos + 1 end
  returning usos into v_usos;
  return v_usos <= p_maximo;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Functions: sales

-- Takes or finds the sale of one request. The same key (or reference) with the same body is the same sale; with another
-- body it is a conflict. A 'negocios' sale is registered at once, with no ticket. Any other sale waits as 'reservada'
-- until its ticket is linked by ledger_completar_venta_api.
create function public.ledger_reservar_venta_api(p_cliente uuid, p_clave text, p_huella text, p_referencia text,
  p_producto text, p_negocio uuid, p_descripcion text, p_monto integer, p_medio text, p_factura text, p_hash text,
  p_sats bigint, p_tasa numeric)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cliente public.ledger_clientes_api;
  v_venta public.ledger_ventas_api;
begin
  select * into v_cliente from public.ledger_clientes_api where id = p_cliente;
  if not found or v_cliente.revocado_en is not null then
    raise exception '%', 'NO_AUTORIZADO: La clave no es válida.' using errcode = 'P0001';
  end if;

  if p_clave is null or char_length(p_clave) not between 8 and 128 then
    raise exception '%', 'DATOS_INVALIDOS: La clave de idempotencia no es válida.' using errcode = 'P0001';
  end if;
  if p_huella is null or p_huella !~ '^[0-9a-f]{64}$' then
    raise exception '%', 'DATOS_INVALIDOS: La huella de la venta no es válida.' using errcode = 'P0001';
  end if;
  if p_referencia is null or char_length(p_referencia) not between 1 and 120 then
    raise exception '%', 'DATOS_INVALIDOS: La referencia tiene que tener entre 1 y 120 caracteres.' using errcode = 'P0001';
  end if;
  if p_producto is null or p_producto not in ('media', 'travel', 'market', 'pay', 'negocios') then
    raise exception '%', 'DATOS_INVALIDOS: El producto no es válido.' using errcode = 'P0001';
  end if;
  if (p_producto = 'negocios') <> (p_negocio is not null) then
    raise exception '%', 'DATOS_INVALIDOS: Una venta de negocios necesita negocio_id, y solo esas.' using errcode = 'P0001';
  end if;
  if p_descripcion is null or char_length(p_descripcion) not between 1 and 200 then
    raise exception '%', 'DATOS_INVALIDOS: La descripción tiene que tener entre 1 y 200 caracteres.' using errcode = 'P0001';
  end if;
  if p_monto is null or p_monto < 1 or p_monto > 2147483647 then
    raise exception '%', 'DATOS_INVALIDOS: El monto no es válido.' using errcode = 'P0001';
  end if;
  if p_medio is null or p_medio not in ('lightning', 'efectivo') then
    raise exception '%', 'DATOS_INVALIDOS: El medio tiene que ser lightning o efectivo.' using errcode = 'P0001';
  end if;
  if p_medio = 'lightning' then
    if p_factura is null or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' or p_sats is null or p_sats <= 0
       or p_tasa is null or p_tasa <= 0 then
      raise exception '%', 'DATOS_INVALIDOS: Un pago por lightning necesita factura, hash, sats y tasa.' using errcode = 'P0001';
    end if;
  elsif p_factura is not null or p_hash is not null or p_sats is not null or p_tasa is not null then
    raise exception '%', 'DATOS_INVALIDOS: Un pago en efectivo no lleva datos de lightning.' using errcode = 'P0001';
  end if;

  select * into v_venta from public.ledger_ventas_api where cliente_id = p_cliente and clave_idempotencia = p_clave;
  if not found then
    select * into v_venta from public.ledger_ventas_api where cliente_id = p_cliente and referencia = p_referencia;
  end if;
  if found then
    if v_venta.huella <> p_huella then
      raise exception '%', 'IDEMPOTENCIA_CONFLICTO: Esa clave o esa referencia ya se usó con otra venta.' using errcode = 'P0001';
    end if;
    return jsonb_build_object('situacion', 'existente', 'venta', to_jsonb(v_venta));
  end if;

  begin
    insert into public.ledger_ventas_api (cliente_id, clave_idempotencia, huella, referencia, producto, negocio_id,
      descripcion, monto_centavos, medio, factura_id, payment_hash, sats, tasa_usd_btc, estado)
    values (p_cliente, p_clave, p_huella, p_referencia, p_producto, p_negocio, p_descripcion, p_monto, p_medio,
      p_factura, p_hash, p_sats, p_tasa, case when p_producto = 'negocios' then 'registrada' else 'reservada' end)
    returning * into v_venta;
  exception when unique_violation then
    -- Another request took the key, the reference, the invoice or the payment hash first.
    select * into v_venta from public.ledger_ventas_api where cliente_id = p_cliente
      and (clave_idempotencia = p_clave or referencia = p_referencia) limit 1;
    if found and v_venta.huella = p_huella then
      return jsonb_build_object('situacion', 'existente', 'venta', to_jsonb(v_venta));
    elsif found then
      raise exception '%', 'IDEMPOTENCIA_CONFLICTO: Esa clave o esa referencia ya se usó con otra venta.' using errcode = 'P0001';
    end if;
    raise exception '%', 'DUPLICADO: ese pago ya tiene una venta registrada.' using errcode = 'P0001';
  end;
  return jsonb_build_object('situacion', 'nueva', 'venta', to_jsonb(v_venta));
end;
$$;

-- Links the ticket a reserved sale made. Linking the same ticket again changes nothing. A ticket already linked to
-- another sale is refused with DUPLICADO.
create function public.ledger_completar_venta_api(p_id uuid, p_ticket text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_venta public.ledger_ventas_api;
begin
  update public.ledger_ventas_api set ticket_id = p_ticket, estado = 'registrada'
  where id = p_id and estado = 'reservada'
  returning * into v_venta;
  if found then
    return to_jsonb(v_venta);
  end if;
  select * into v_venta from public.ledger_ventas_api where id = p_id;
  if not found then
    raise exception '%', 'NO_ENCONTRADA: No encontramos esa venta.' using errcode = 'P0001';
  end if;
  if v_venta.ticket_id = p_ticket then
    return to_jsonb(v_venta);
  end if;
  raise exception '%', 'ESTADO_INVALIDO: La venta ya tiene otro ticket.' using errcode = 'P0001';
exception when unique_violation then
  raise exception '%', 'DUPLICADO: ese ticket ya es de otra venta.' using errcode = 'P0001';
end;
$$;

revoke execute on function public.ledger_api_cuota(uuid, integer) from public, anon, authenticated;
grant execute on function public.ledger_api_cuota(uuid, integer) to service_role;
revoke execute on function public.ledger_reservar_venta_api(uuid, text, text, text, text, uuid, text, integer, text, text, text, bigint, numeric)
  from public, anon, authenticated;
grant execute on function public.ledger_reservar_venta_api(uuid, text, text, text, text, uuid, text, integer, text, text, text, bigint, numeric)
  to service_role;
revoke execute on function public.ledger_completar_venta_api(uuid, text) from public, anon, authenticated;
grant execute on function public.ledger_completar_venta_api(uuid, text) to service_role;

-- ---------------------------------------------------------------------------------------------
-- Pay: notices with a destination

alter table public.pay_avisos add column destino text not null default 'cliente' check (destino in ('cliente', 'ledger'));
alter table public.pay_avisos drop constraint pay_avisos_cobro_id_estado_key;
alter table public.pay_avisos add constraint pay_avisos_cobro_estado_destino_key unique (cobro_id, estado, destino);

-- A state change writes the client's notice (when the charge has an address) and, for a paid business charge, one
-- notice to Ledger. Both are written in this transaction, so a Ledger outage never touches the charge.
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

create or replace function public.pay_cancelar_cobro(p_cliente uuid, p_id uuid) returns jsonb
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

  insert into public.pay_avisos (cobro_id, estado, destino)
  select v_cobro.id, v_cobro.estado, 'cliente' where v_cobro.aviso_url is not null
  on conflict (cobro_id, estado, destino) do nothing
  returning id into v_aviso;

  insert into public.auditoria (actor_id, accion, entidad, entidad_id, detalle)
  values (null, 'cobro.estado', 'cobro', v_cobro.id::text, jsonb_build_object('estado', 'cancelado', 'btcpay', 'cliente'));

  return jsonb_build_object('cambio', true, 'cobro', to_jsonb(v_cobro), 'aviso_id', v_aviso);
end;
$$;

-- The claim also returns the destination. A Ledger notice ignores the attempt limit: it is retried until Ledger answers.
drop function public.pay_reclamar_avisos(integer, integer, uuid);

create function public.pay_reclamar_avisos(p_limite integer, p_duracion_segundos integer, p_aviso uuid default null)
returns table (aviso_id uuid, cobro_id uuid, estado_cobro text, token uuid, intentos integer, destino text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  if p_limite is null or p_limite not between 1 and 100 then
    raise exception '%', 'DATOS_INVALIDOS: El lote de avisos no es válido.' using errcode = 'P0001';
  end if;
  if p_duracion_segundos is null or p_duracion_segundos not between 10 and 3600 then
    raise exception '%', 'DATOS_INVALIDOS: La duración del reclamo no es válida.' using errcode = 'P0001';
  end if;

  update public.pay_avisos a set entrega = 'muerto', muerto_en = now(), reclamo = null, reclamado_hasta = null,
    ultimo_error = left(coalesce(a.ultimo_error, 'Sin respuesta del receptor.'), 200)
  where a.entrega = 'pendiente' and a.destino = 'cliente' and a.intentos >= public._aviso_maximo_intentos()
    and (a.reclamado_hasta is null or a.reclamado_hasta <= now())
    and (p_aviso is null or a.id = p_aviso);

  return query
  with tomados as (
    update public.pay_avisos a set intentos = a.intentos + 1, reclamo = gen_random_uuid(),
      reclamado_hasta = now() + make_interval(secs => p_duracion_segundos)
    where a.id in (
      select s.id from public.pay_avisos s
      where s.entrega = 'pendiente' and s.proximo_intento_en <= now()
        and (s.destino = 'ledger' or s.intentos < public._aviso_maximo_intentos())
        and (s.reclamado_hasta is null or s.reclamado_hasta <= now())
        and (p_aviso is null or s.id = p_aviso)
      order by s.proximo_intento_en
      for update skip locked
      limit p_limite)
    returning a.id, a.cobro_id, a.estado, a.reclamo, a.intentos, a.destino
  )
  select t.id, t.cobro_id, t.estado, t.reclamo, t.intentos, t.destino from tomados t;
end;
$$;

-- Records the outcome of one attempt. A Ledger notice never becomes muerto: it waits its turn again.
create or replace function public.pay_cerrar_aviso(p_aviso uuid, p_token uuid, p_ok boolean, p_error text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_aviso public.pay_avisos;
begin
  select * into v_aviso from public.pay_avisos where id = p_aviso for update;
  if not found then
    return 'ninguno';
  end if;
  if v_aviso.entrega = 'entregado' then
    return 'entregado';
  end if;

  if coalesce(p_ok, false) then
    update public.pay_avisos set entrega = 'entregado', enviado_en = now(), muerto_en = null, reclamo = null,
      reclamado_hasta = null, ultimo_error = null
    where id = p_aviso;
    return 'entregado';
  end if;

  if v_aviso.entrega = 'muerto' then
    return 'muerto';
  end if;
  if v_aviso.reclamo is distinct from p_token then
    return 'reclamo_ajeno';
  end if;

  if v_aviso.destino = 'cliente' and v_aviso.intentos >= public._aviso_maximo_intentos() then
    update public.pay_avisos set entrega = 'muerto', muerto_en = now(), reclamo = null, reclamado_hasta = null,
      ultimo_error = left(p_error, 200)
    where id = p_aviso;
    return 'muerto';
  end if;

  update public.pay_avisos set proximo_intento_en = now() + public._aviso_espera(v_aviso.intentos), reclamo = null,
    reclamado_hasta = null, ultimo_error = left(p_error, 200)
  where id = p_aviso;
  return 'pendiente';
end;
$$;

revoke execute on function public.pay_reclamar_avisos(integer, integer, uuid) from public, anon, authenticated;
grant execute on function public.pay_reclamar_avisos(integer, integer, uuid) to service_role;
revoke execute on function public.pay_cerrar_aviso(uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.pay_cerrar_aviso(uuid, uuid, boolean, text) to service_role;
revoke execute on function public.pay_aplicar_btcpay(text, text, text) from public, anon, authenticated;
grant execute on function public.pay_aplicar_btcpay(text, text, text) to service_role;
revoke execute on function public.pay_cancelar_cobro(uuid, uuid) from public, anon, authenticated;
grant execute on function public.pay_cancelar_cobro(uuid, uuid) to service_role;
