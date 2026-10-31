-- CacaoPay para negocios: a business that charges at its counter, on top of the payments API.
-- 1. negocios (shared with Market) gets tipo_negocio. It is empty for a Market business until its owner activates
--    CacaoPay, which asks for it then. One business per account: negocios.usuario_id is unique.
-- 2. pay_negocios holds the CacaoPay state of a business: its BTCPay store and its API client. Activation runs in
--    steps, and each step is recorded before the next one:
--      pay_negocio_reclamar   takes the activation for 60 seconds. A second request in that time gets 'en_curso'.
--      pay_negocio_guardar_tienda records the store id as soon as BTCPay makes the store.
--      pay_negocio_crear_cliente makes the API client and marks the business 'activo', in one transaction.
--    A failed step releases the claim (pay_negocio_soltar). A retry resumes at the recorded store: no second store.
-- 3. pay_cuotas_publicas counts the requests of the public page (/pagar/{negocio}), which makes invoices for
--    anonymous visitors. pay_cuota_publica is the limit.
-- Nothing here moves money. The server calls these functions with the service role.

-- ---------------------------------------------------------------------------------------------
-- Tables

alter table public.negocios add column tipo_negocio text
  check (tipo_negocio in ('cafeteria', 'restaurante', 'tienda', 'servicios', 'otro'));

create table public.pay_negocios (
  negocio_id uuid primary key references public.negocios (id) on delete cascade,
  estado text not null default 'activando' check (estado in ('activando', 'activo')),
  -- The BTCPay store of the business. Recorded before the client is made.
  tienda_btcpay text unique check (tienda_btcpay ~ '^[A-Za-z0-9]{10,64}$'),
  -- The payments API client that charges for the business. Made once, with the activation.
  cliente_id uuid unique references public.pay_api_clientes (id),
  -- When an activation attempt started. Released on a failure.
  reclamado_en timestamptz,
  creado_en timestamptz not null default now(),
  activo_en timestamptz,
  constraint pay_negocios_activo_coherente check ((estado = 'activo') = (cliente_id is not null and activo_en is not null)),
  constraint pay_negocios_cliente_con_tienda check (cliente_id is null or tienda_btcpay is not null)
);

create table public.pay_cuotas_publicas (
  clave text primary key check (char_length(clave) between 1 and 200),
  ventana timestamptz not null,
  usos integer not null check (usos >= 0)
);

alter table public.pay_negocios enable row level security;
alter table public.pay_cuotas_publicas enable row level security;

revoke all on public.pay_negocios, public.pay_cuotas_publicas from public, anon, authenticated;
grant all on public.pay_negocios, public.pay_cuotas_publicas to service_role;

-- ---------------------------------------------------------------------------------------------
-- Activation

-- Takes the activation of the account's business. Creates the business when it has none (name, type and location
-- are then required), or completes its type when it has none yet (a Market business). Returns:
--   activo:     the business already charges with CacaoPay.
--   en_curso:   another request is activating it now (taken less than 60 seconds ago).
--   reclamado:  this request holds the claim: it may make the store and the client.
create function public.pay_negocio_reclamar(p_usuario uuid, p_nombre text, p_tipo text, p_ubicacion text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_negocio public.negocios;
  v_pn public.pay_negocios;
  v_nombre text;
  v_ubicacion text;
  v_situacion text;
begin
  if p_usuario is null or not exists (select 1 from public.usuarios where id = p_usuario) then
    raise exception '%', 'NO_AUTORIZADO: Entrá de nuevo para cobrar con tu negocio.' using errcode = 'P0001';
  end if;

  select * into v_negocio from public.negocios where usuario_id = p_usuario for update;
  if not found then
    if p_tipo is null or p_tipo not in ('cafeteria', 'restaurante', 'tienda', 'servicios', 'otro') then
      raise exception '%', 'DATOS_INVALIDOS: Elegí el tipo de negocio.' using errcode = 'P0001';
    end if;
    v_nombre := public._texto_valido(p_nombre, 2, 80, 'El nombre del negocio tiene que tener entre 2 y 80 caracteres.');
    v_ubicacion := public._texto_valido(p_ubicacion, 1, 160, 'Escribí dónde está el negocio.');
    insert into public.negocios (usuario_id, nombre, ubicacion, tipo_negocio)
    values (p_usuario, v_nombre, v_ubicacion, p_tipo)
    on conflict (usuario_id) do nothing
    returning * into v_negocio;
    if not found then
      select * into v_negocio from public.negocios where usuario_id = p_usuario for update;
    end if;
  elsif v_negocio.tipo_negocio is null then
    if p_tipo is null or p_tipo not in ('cafeteria', 'restaurante', 'tienda', 'servicios', 'otro') then
      raise exception '%', 'DATOS_INVALIDOS: Elegí el tipo de negocio.' using errcode = 'P0001';
    end if;
    update public.negocios set tipo_negocio = p_tipo where id = v_negocio.id returning * into v_negocio;
  end if;

  insert into public.pay_negocios (negocio_id) values (v_negocio.id) on conflict (negocio_id) do nothing;
  select * into v_pn from public.pay_negocios where negocio_id = v_negocio.id for update;

  if v_pn.estado = 'activo' then
    v_situacion := 'activo';
  elsif v_pn.reclamado_en is not null and v_pn.reclamado_en > now() - interval '60 seconds' then
    v_situacion := 'en_curso';
  else
    update public.pay_negocios set reclamado_en = now() where negocio_id = v_negocio.id returning * into v_pn;
    v_situacion := 'reclamado';
  end if;

  return jsonb_build_object('situacion', v_situacion, 'negocio', to_jsonb(v_negocio), 'activacion', to_jsonb(v_pn));
end;
$$;

-- Releases the claim after a failed step, so the owner can try again at once. The store already made stays recorded.
create function public.pay_negocio_soltar(p_negocio uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.pay_negocios set reclamado_en = null where negocio_id = p_negocio and estado = 'activando';
end;
$$;

-- Records the store BTCPay made for the business. Recording the same store again changes nothing.
create function public.pay_negocio_guardar_tienda(p_negocio uuid, p_tienda text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_pn public.pay_negocios;
begin
  if p_tienda is null or p_tienda !~ '^[A-Za-z0-9]{10,64}$' then
    raise exception '%', 'DATOS_INVALIDOS: La tienda no es válida.' using errcode = 'P0001';
  end if;
  select * into v_pn from public.pay_negocios where negocio_id = p_negocio for update;
  if not found then
    raise exception '%', 'NO_ENCONTRADA: No encontramos ese negocio.' using errcode = 'P0001';
  end if;
  if v_pn.tienda_btcpay is not null then
    if v_pn.tienda_btcpay = p_tienda then
      return;
    end if;
    raise exception '%', 'ESTADO_INVALIDO: Este negocio ya tiene otra tienda.' using errcode = 'P0001';
  end if;
  update public.pay_negocios set tienda_btcpay = p_tienda where negocio_id = p_negocio;
end;
$$;

-- Makes the business's API client, on its recorded store, and marks the business active. One transaction: either
-- both happen or neither does. A business that is already active keeps its client.
create function public.pay_negocio_crear_cliente(p_negocio uuid, p_prefijo text, p_clave_hash text, p_aviso_secreto text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_pn public.pay_negocios;
  v_nombre text;
  v_cliente uuid;
begin
  select * into v_pn from public.pay_negocios where negocio_id = p_negocio for update;
  if not found then
    raise exception '%', 'NO_ENCONTRADA: No encontramos ese negocio.' using errcode = 'P0001';
  end if;
  if v_pn.estado = 'activo' then
    return v_pn.cliente_id;
  end if;
  if v_pn.tienda_btcpay is null then
    raise exception '%', 'ESTADO_INVALIDO: Falta la tienda del negocio.' using errcode = 'P0001';
  end if;

  select nombre into v_nombre from public.negocios where id = p_negocio;
  v_cliente := public.pay_crear_cliente_api(v_nombre, p_prefijo, p_clave_hash, v_pn.tienda_btcpay, false, p_aviso_secreto,
    'negocios', '{}');

  update public.pay_negocios set cliente_id = v_cliente, estado = 'activo', activo_en = now(), reclamado_en = null
  where negocio_id = p_negocio;
  return v_cliente;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Public page limit

-- Counts one request under a key. At most p_maximo in each window of p_ventana_segundos. Returns false when over.
create function public.pay_cuota_publica(p_clave text, p_maximo integer, p_ventana_segundos integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_usos integer;
begin
  if p_clave is null or char_length(p_clave) not between 1 and 200 or p_maximo is null or p_maximo < 1
     or p_ventana_segundos is null or p_ventana_segundos < 1 then
    raise exception '%', 'DATOS_INVALIDOS: El límite no es válido.' using errcode = 'P0001';
  end if;
  insert into public.pay_cuotas_publicas (clave, ventana, usos) values (p_clave, now(), 1)
  on conflict (clave) do update set
    ventana = case when public.pay_cuotas_publicas.ventana <= now() - make_interval(secs => p_ventana_segundos)
      then now() else public.pay_cuotas_publicas.ventana end,
    usos = case when public.pay_cuotas_publicas.ventana <= now() - make_interval(secs => p_ventana_segundos)
      then 1 else public.pay_cuotas_publicas.usos + 1 end
  returning usos into v_usos;
  return v_usos <= p_maximo;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Grants: only the server (service role) runs these functions.

revoke execute on function public.pay_negocio_reclamar(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.pay_negocio_reclamar(uuid, text, text, text) to service_role;

revoke execute on function public.pay_negocio_soltar(uuid) from public, anon, authenticated;
grant execute on function public.pay_negocio_soltar(uuid) to service_role;

revoke execute on function public.pay_negocio_guardar_tienda(uuid, text) from public, anon, authenticated;
grant execute on function public.pay_negocio_guardar_tienda(uuid, text) to service_role;

revoke execute on function public.pay_negocio_crear_cliente(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.pay_negocio_crear_cliente(uuid, text, text, text) to service_role;

revoke execute on function public.pay_cuota_publica(text, integer, integer) from public, anon, authenticated;
grant execute on function public.pay_cuota_publica(text, integer, integer) to service_role;
