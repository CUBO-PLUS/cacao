-- Cacao Media: real Lightning invoices through BTCPay Server, next to the simulated ones.
--
-- A paid story still gives permanent access, as in 20261014000003_media.sql. An invoice made by BTCPay is
-- marked proveedor 'btcpay' and confirmed only when BTCPay says it is Settled (media_confirmar_btcpay).
-- Same rules as the other migrations: the browser never writes here, and every grant is explicit.

alter table public.media_cobros
  add column proveedor text not null default 'simulado' check (proveedor in ('simulado', 'btcpay')),
  add column btcpay_factura_id text unique,
  add column btcpay_tienda_id text;

-- A BTCPay invoice must say which invoice and which store it belongs to.
alter table public.media_cobros add constraint media_cobros_btcpay_completo
  check (proveedor <> 'btcpay' or (btcpay_factura_id is not null and btcpay_tienda_id is not null));

-- Simulated invoices keep "lnsim1" and 40 hex characters. BTCPay invoices are BOLT11 Lightning requests.
alter table public.media_cobros drop constraint media_cobros_factura_check;
alter table public.media_cobros add constraint media_cobros_factura_check
  check (factura ~ '^lnsim1[0-9a-f]{40}$' or factura ~ '^lnbc[0-9a-z]+$');

-- ---------------------------------------------------------------------------------------------
-- Invoices

-- The live invoice for this reader and story: pending and not yet past its deadline. Null when there is none.
create function public.media_cobro_vigente(p_lector uuid, p_slug text) returns public.media_cobros
language plpgsql security definer set search_path = public as $$
declare
  v_cobro public.media_cobros;
begin
  select * into v_cobro from public.media_cobros
  where lector_id = p_lector and slug = btrim(coalesce(p_slug, '')) and estado = 'pendiente' and expira_en > now()
  order by creado_en desc
  limit 1;
  if found then
    return v_cobro;
  end if;
  return null;
end;
$$;

-- Same checks as media_crear_cobro. The invoice comes from BTCPay: its id, its store and its deadline are stored as given.
create function public.media_crear_cobro_btcpay(
  p_lector uuid,
  p_slug text,
  p_titulo text,
  p_precio_sats integer,
  p_cotizacion numeric,
  p_factura text,
  p_factura_id text,
  p_tienda text,
  p_expira timestamptz
) returns public.media_cobros
language plpgsql security definer set search_path = public as $$
declare
  v_slug text := btrim(coalesce(p_slug, ''));
  v_titulo text;
  v_cotizacion numeric := round(coalesce(p_cotizacion, 0), 2);
  v_cobro public.media_cobros;
begin
  if p_lector is null then
    raise exception '%', 'NO_ENCONTRADA: No encontramos ese lector.' using errcode = 'P0001';
  end if;
  perform 1 from public.media_lectores where id = p_lector for update;
  if not found then
    raise exception '%', 'NO_ENCONTRADA: No encontramos ese lector.' using errcode = 'P0001';
  end if;

  if char_length(v_slug) not between 1 and 120 then
    raise exception '%', 'DATOS_INVALIDOS: La historia no es válida.' using errcode = 'P0001';
  end if;
  v_titulo := public._texto_valido(p_titulo, 1, 200, 'El título de la historia tiene que tener entre 1 y 200 caracteres.');
  if p_precio_sats is null or p_precio_sats <= 0 then
    raise exception '%', 'DATOS_INVALIDOS: El precio tiene que ser mayor que cero.' using errcode = 'P0001';
  end if;
  if v_cotizacion <= 0 then
    raise exception '%', 'DATOS_INVALIDOS: La cotización tiene que ser mayor que cero.' using errcode = 'P0001';
  end if;
  if p_factura is null or p_factura !~ '^lnbc[0-9a-z]+$' then
    raise exception '%', 'DATOS_INVALIDOS: La factura no es válida.' using errcode = 'P0001';
  end if;
  if p_factura_id is null or p_factura_id !~ '^[A-Za-z0-9]{10,64}$' or p_tienda is null or p_tienda !~ '^[A-Za-z0-9]{10,64}$' then
    raise exception '%', 'DATOS_INVALIDOS: La factura no es de una tienda válida.' using errcode = 'P0001';
  end if;
  if p_expira is null or p_expira <= now() then
    raise exception '%', 'DATOS_INVALIDOS: El plazo de la factura no es válido.' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.media_accesos a where a.lector_id = p_lector and a.slug = v_slug) then
    raise exception '%', 'ESTADO_INVALIDO: Ya tenés acceso a esta historia.' using errcode = 'P0001';
  end if;

  select * into v_cobro from public.media_cobros
  where lector_id = p_lector and slug = v_slug and estado = 'pendiente' and expira_en > now()
  order by creado_en desc
  limit 1;
  if found then
    return v_cobro;
  end if;

  -- Any invoice still pending here is past its deadline: close it before the new one.
  update public.media_cobros set estado = 'vencida', cerrada_en = now(), motivo = 'Venció el plazo para pagar.'
  where lector_id = p_lector and slug = v_slug and estado = 'pendiente';

  insert into public.media_cobros (lector_id, slug, titulo, precio_sats, cotizacion_usd_btc,
    precio_usd_centavos, factura, estado, expira_en, proveedor, btcpay_factura_id, btcpay_tienda_id)
  values (p_lector, v_slug, v_titulo, p_precio_sats, v_cotizacion,
    ceil(p_precio_sats::numeric * v_cotizacion / 1000000)::integer,
    p_factura, 'pendiente', p_expira, 'btcpay', p_factura_id, p_tienda)
  returning * into v_cobro;

  return v_cobro;
end;
$$;

-- BTCPay says the invoice is Settled: the reader gets access. BTCPay is the authority here, so the
-- deadline is not checked: Settled means it was paid inside BTCPay's window. A paid invoice returns unchanged.
create function public.media_confirmar_btcpay(p_factura_id text) returns public.media_cobros
language plpgsql security definer set search_path = public as $$
declare
  v_cobro public.media_cobros;
begin
  select * into v_cobro from public.media_cobros where btcpay_factura_id = p_factura_id for update;
  if not found then
    raise exception '%', 'NO_ENCONTRADA: No encontramos esa factura.' using errcode = 'P0001';
  end if;
  if v_cobro.estado = 'pagada' then
    return v_cobro;
  end if;
  if v_cobro.estado = 'fallida' then
    raise exception '%', 'ESTADO_INVALIDO: Esta factura ya no se puede pagar.' using errcode = 'P0001';
  end if;

  update public.media_cobros set estado = 'pagada', pagada_en = now(), cerrada_en = null, motivo = null
  where id = v_cobro.id
  returning * into v_cobro;

  -- Two invoices for the same story can both be paid (an old one paid late, then a new one). The reader
  -- keeps the access from the first; the second payment is still recorded as paid.
  insert into public.media_accesos (lector_id, slug, cobro_id) values (v_cobro.lector_id, v_cobro.slug, v_cobro.id)
  on conflict (lector_id, slug) do nothing;

  return v_cobro;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Grants: only the server (service role) runs these.

revoke execute on function public.media_cobro_vigente(uuid, text) from public, anon, authenticated;
revoke execute on function public.media_crear_cobro_btcpay(uuid, text, text, integer, numeric, text, text, text, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.media_confirmar_btcpay(text) from public, anon, authenticated;

grant execute on function public.media_cobro_vigente(uuid, text) to service_role;
grant execute on function public.media_crear_cobro_btcpay(uuid, text, text, integer, numeric, text, text, text, timestamptz)
  to service_role;
grant execute on function public.media_confirmar_btcpay(text) to service_role;
