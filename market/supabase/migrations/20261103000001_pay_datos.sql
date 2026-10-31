-- Cacao Pay: datos. A client stores what it needs to rebuild its own record from a charge later (for example a
-- booking). Pay keeps the text as sent, never reads it, and never sends it to BTCPay or in a notice.
-- 1. pay_cobros.datos: a JSON object as text, at most 2000 bytes. The client that made the charge reads it back
--    (pay_leer_cobro returns the whole row to its owner only).
-- 2. pay_reservar_cobro takes p_datos. The fingerprint (huella) covers it, so a repeat of the key with other datos is
--    refused with IDEMPOTENCIA_CONFLICTO.

alter table public.pay_cobros add column datos text;
alter table public.pay_cobros add constraint pay_cobros_datos_check
  check (datos is null or (octet_length(datos) <= 2000 and jsonb_typeof(datos::jsonb) = 'object'));

-- ---------------------------------------------------------------------------------------------
-- Charges: the same function with datos as the last argument. The old signature goes; its grant goes with it.

drop function public.pay_reservar_cobro(uuid, text, text, text, text, bigint, bigint, bigint, numeric, text, text, text, integer);

create function public.pay_reservar_cobro(p_cliente uuid, p_clave text, p_huella text, p_tienda text, p_moneda text,
  p_monto bigint, p_sats bigint, p_usd_centavos bigint, p_cotizacion numeric, p_descripcion text, p_referencia text,
  p_aviso_url text, p_vence_en_segundos integer, p_datos text default null)
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
  if p_datos is not null and (octet_length(p_datos) > 2000 or jsonb_typeof(p_datos::jsonb) <> 'object') then
    raise exception '%', 'DATOS_INVALIDOS: Los datos tienen que ser un objeto JSON de hasta 2000 bytes.' using errcode = 'P0001';
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
    usd_centavos, cotizacion_usd_btc, descripcion, referencia, producto, aviso_url, vence_en_segundos, datos)
  values (p_cliente, p_clave, p_huella, p_tienda, p_moneda, p_monto, p_sats, p_usd_centavos, p_cotizacion,
    v_descripcion, v_referencia, v_cliente.producto, p_aviso_url, p_vence_en_segundos, p_datos)
  returning * into v_cobro;

  return jsonb_build_object('situacion', 'nuevo', 'cobro', to_jsonb(v_cobro));
end;
$$;

revoke execute on function public.pay_reservar_cobro(uuid, text, text, text, text, bigint, bigint, bigint, numeric, text, text, text, integer, text)
  from public, anon, authenticated;
grant execute on function public.pay_reservar_cobro(uuid, text, text, text, text, bigint, bigint, bigint, numeric, text, text, text, integer, text)
  to service_role;
