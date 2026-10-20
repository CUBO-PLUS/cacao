-- Adds BTCPay Server as a payment provider. Each business has its own BTCPay store, and the store id is
-- kept server-only: the column is not granted to anon or authenticated (see 20261012000003_privilegios.sql,
-- which lists the readable columns of negocios), so it never reaches a browser.

-- A value added with ALTER TYPE cannot be used in the same transaction, so the function below casts the
-- literal at run time, when the value already exists.
alter type public.tipo_proveedor add value if not exists 'btcpay';

alter table public.negocios
  add column if not exists btcpay_tienda_id text unique
    check (btcpay_tienda_id is null or btcpay_tienda_id ~ '^[A-Za-z0-9]{10,64}$');

-- Points a business at its BTCPay store and switches its provider to btcpay. Called by the setup script
-- with the service role, after the store exists in BTCPay.
create or replace function public.asignar_tienda_btcpay(p_negocio uuid, p_tienda text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_tienda is null or p_tienda !~ '^[A-Za-z0-9]{10,64}$' then
    raise exception '%', 'DATOS_INVALIDOS: La tienda de BTCPay no es válida.' using errcode = 'P0001';
  end if;

  update public.negocios
     set btcpay_tienda_id = p_tienda,
         tipo_proveedor_pago = 'btcpay'::text::public.tipo_proveedor
   where id = p_negocio;
  if not found then
    raise exception '%', 'NO_ENCONTRADA: No encontramos ese negocio.' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.asignar_tienda_btcpay(uuid, text) from public, anon, authenticated;
grant execute on function public.asignar_tienda_btcpay(uuid, text) to service_role;
