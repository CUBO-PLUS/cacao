-- Cacao: the public address of BTCPay Server, read at run time instead of being baked into each Vercel project.
--
-- The demo tunnel changes its address each time it starts. infra/btcpay/vigia.ps1 keeps this row current, and
-- every product reads it with url_btcpay(). A product falls back to its BTCPAY_URL variable when the row is missing.
-- The address is public anyway (the test-wallet links carry it), so url_btcpay is open to browsers.
-- Only the service role writes the address, through fijar_url_btcpay. The table itself is closed to browsers.

create table public.config_publica (
  clave text primary key,
  valor text not null,
  actualizado_en timestamptz not null default now()
);

alter table public.config_publica enable row level security;
revoke all on public.config_publica from public, anon, authenticated;

-- The public address of BTCPay, without a trailing slash. Null when the row is missing.
create function public.url_btcpay() returns text
language sql security definer stable set search_path = public as $$
  select valor from public.config_publica where clave = 'btcpay_url';
$$;

revoke execute on function public.url_btcpay() from public;
grant execute on function public.url_btcpay() to anon, authenticated, service_role;

-- Stores the address of BTCPay. Only https, a host name, no path and no trailing slash.
create function public.fijar_url_btcpay(p_url text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if p_url is null or p_url !~ '^https://[a-z0-9.-]+$' then
    raise exception '%', 'DATOS_INVALIDOS: La dirección de BTCPay tiene que ser https, sin ruta ni barra final.' using errcode = 'P0001';
  end if;

  insert into public.config_publica (clave, valor, actualizado_en)
  values ('btcpay_url', p_url, now())
  on conflict (clave) do update set valor = excluded.valor, actualizado_en = excluded.actualizado_en;

  return p_url;
end;
$$;

revoke execute on function public.fijar_url_btcpay(text) from public, anon, authenticated;
grant execute on function public.fijar_url_btcpay(text) to service_role;
