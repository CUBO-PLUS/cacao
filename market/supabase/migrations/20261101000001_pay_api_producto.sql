-- Cacao Pay: the product of a payments API client is bound to the client. A request can no longer name its product:
-- every charge of a client carries the client's product, which Ledger reads as metadata.producto.
-- 1. pay_api_clientes.producto is required. pay_crear_cliente_api takes it, and so does every new client.
-- 2. pay_reservar_cobro takes the product from the client, so the argument is gone.
-- 3. 'negocios' labels the sales of businesses that charge at the counter (CacaoPay para negocios). Ledger's import
--    accepts only media, travel, market and pay today, so an invoice labelled 'negocios' is left out by Ledger until
--    Ledger adds the product.

alter table public.pay_api_clientes add column producto text;
-- Clients made before this migration had no product bound. They are labelled 'pay' until someone sets the real one.
update public.pay_api_clientes set producto = 'pay' where producto is null;
alter table public.pay_api_clientes alter column producto set not null;
alter table public.pay_api_clientes add constraint pay_api_clientes_producto_check
  check (producto in ('media', 'travel', 'market', 'pay', 'negocios'));

alter table public.pay_cobros drop constraint pay_cobros_producto_check;
alter table public.pay_cobros add constraint pay_cobros_producto_check
  check (producto in ('media', 'travel', 'market', 'pay', 'negocios'));

-- ---------------------------------------------------------------------------------------------
-- Clients: the product is required and stored with the client.

drop function public.pay_crear_cliente_api(text, text, text, text, boolean, text, text[]);

create function public.pay_crear_cliente_api(p_nombre text, p_prefijo text, p_clave_hash text, p_tienda text,
  p_puede_elegir boolean, p_aviso_secreto text, p_producto text, p_tiendas text[] default '{}')
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
  if p_producto is null or p_producto not in ('media', 'travel', 'market', 'pay', 'negocios') then
    raise exception '%', 'DATOS_INVALIDOS: El producto del cliente no es válido.' using errcode = 'P0001';
  end if;
  if not coalesce(p_puede_elegir, false) and coalesce(cardinality(p_tiendas), 0) > 0 then
    raise exception '%', 'DATOS_INVALIDOS: Para cobrar en otras tiendas la clave tiene que poder elegir tienda.' using errcode = 'P0001';
  end if;

  insert into public.pay_api_clientes (nombre, prefijo, clave_hash, tienda_btcpay, puede_elegir_tienda, aviso_secreto, producto)
  values (public._texto_valido(p_nombre, 1, 80, 'El nombre tiene que tener entre 1 y 80 caracteres.'),
    p_prefijo, p_clave_hash, p_tienda, coalesce(p_puede_elegir, false), p_aviso_secreto, p_producto)
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

-- ---------------------------------------------------------------------------------------------
-- Charges: no product argument. The charge carries the client's product.

drop function public.pay_reservar_cobro(uuid, text, text, text, text, bigint, bigint, bigint, numeric, text, text, text, text, integer);

create function public.pay_reservar_cobro(p_cliente uuid, p_clave text, p_huella text, p_tienda text, p_moneda text,
  p_monto bigint, p_sats bigint, p_usd_centavos bigint, p_cotizacion numeric, p_descripcion text, p_referencia text,
  p_aviso_url text, p_vence_en_segundos integer)
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
    v_descripcion, v_referencia, v_cliente.producto, p_aviso_url, p_vence_en_segundos)
  returning * into v_cobro;

  return jsonb_build_object('situacion', 'nuevo', 'cobro', to_jsonb(v_cobro));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Grants for the functions that changed signature.

revoke execute on function public.pay_crear_cliente_api(text, text, text, text, boolean, text, text, text[]) from public, anon, authenticated;
grant execute on function public.pay_crear_cliente_api(text, text, text, text, boolean, text, text, text[]) to service_role;

revoke execute on function public.pay_reservar_cobro(uuid, text, text, text, text, bigint, bigint, bigint, numeric, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.pay_reservar_cobro(uuid, text, text, text, text, bigint, bigint, bigint, numeric, text, text, text, integer)
  to service_role;
