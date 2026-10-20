-- CacaoLedger on the web: tickets, correlativos and the BTCPay sync log.
--
-- The CLI keeps its JSON files in datos/. The web app reads and writes these tables with the service
-- role, from the server. The browser never touches them. Same rules as the other migrations: RLS on,
-- no grants to anon or authenticated, and every function is security definer with execute for
-- service_role only.

-- ---------------------------------------------------------------------------------------------
-- Tickets

create table public.ledger_tickets (
  id text primary key check (id ~ '^TK-[0-9]{8}-[0-9A-F]{4}$'),
  creado_en timestamptz not null,
  estado text not null check (estado in ('abierto', 'pagado', 'emitido', 'rechazado')),
  cliente text not null check (cliente in ('consumidor', 'contribuyente')),
  -- Product that made the sale. CacaoMarket orders are "market"; null for tickets typed by hand.
  producto text check (producto is null or producto in ('media', 'travel', 'market', 'pay')),
  origen_plataforma text check (origen_plataforma is null or origen_plataforma in ('cacaomarket', 'btcpay')),
  origen_numero text check (origen_numero is null or char_length(origen_numero) between 1 and 200),
  check ((origen_plataforma is null) = (origen_numero is null)),
  -- Cents, VAT included, as the customer pays them. Computed from the lines by ledger_guardar_ticket.
  total_centavos integer not null check (total_centavos >= 0),
  sats bigint check (sats is null or sats > 0),
  payment_hash text unique,
  pagado_en timestamptz,
  -- Lowercase text the search box matches: the id, the origin number and the line descriptions.
  buscar text not null default '',
  -- The whole Ticket object, as the CLI writes it to datos/tickets/<id>.json.
  datos jsonb not null,
  unique (origen_plataforma, origen_numero)
);
create index ledger_tickets_creado on public.ledger_tickets (creado_en desc);
create index ledger_tickets_producto on public.ledger_tickets (producto);
create index ledger_tickets_estado on public.ledger_tickets (estado);

-- ---------------------------------------------------------------------------------------------
-- Correlativos (last number used per serie, for the DTE control number)

create table public.ledger_correlativos (
  serie text primary key check (char_length(serie) between 1 and 20),
  ultimo bigint not null check (ultimo >= 0)
);

-- ---------------------------------------------------------------------------------------------
-- Sync log (BTCPay imports)

create table public.ledger_sincronizaciones (
  id bigserial primary key,
  empezo timestamptz not null default now(),
  termino timestamptz,
  nuevas int check (nuevas is null or nuevas >= 0),
  repetidas int check (repetidas is null or repetidas >= 0),
  omitidas int check (omitidas is null or omitidas >= 0),
  error text check (error is null or char_length(error) <= 2000),
  origen text not null default 'btcpay' check (char_length(origen) between 1 and 40)
);

alter table public.ledger_tickets enable row level security;
alter table public.ledger_correlativos enable row level security;
alter table public.ledger_sincronizaciones enable row level security;

revoke all on public.ledger_tickets, public.ledger_correlativos, public.ledger_sincronizaciones
  from anon, authenticated;
grant all on public.ledger_tickets, public.ledger_correlativos, public.ledger_sincronizaciones
  to service_role;
grant usage, select on sequence public.ledger_sincronizaciones_id_seq to service_role;

-- ---------------------------------------------------------------------------------------------
-- Functions

-- Stores a ticket by id. Creates it or replaces it. The columns come from the JSON, so the
-- ticket object is the only source. Another ticket with the same payment hash or the same origin
-- is refused with DUPLICADO, never overwritten.
create function public.ledger_guardar_ticket(p_ticket jsonb) returns public.ledger_tickets
language plpgsql security definer set search_path = public as $$
declare
  v_id text := p_ticket ->> 'id';
  v_cliente text := p_ticket ->> 'cliente';
  v_estado text := p_ticket ->> 'estado';
  v_plataforma text := p_ticket #>> '{origen,plataforma}';
  v_numero text := p_ticket #>> '{origen,numero}';
  v_producto text;
  v_hash text := p_ticket #>> '{pago,paymentHash}';
  v_sats bigint := (p_ticket #>> '{pago,sats}')::bigint;
  v_pagado timestamptz := (p_ticket #>> '{pago,momento}')::timestamptz;
  v_creado timestamptz := (p_ticket ->> 'creado')::timestamptz;
  v_total integer;
  v_buscar text;
  v_otro text;
  v_fila public.ledger_tickets;
begin
  if v_id is null or v_id !~ '^TK-[0-9]{8}-[0-9A-F]{4}$' then
    raise exception '%', 'DATOS_INVALIDOS: El identificador del ticket no tiene la forma TK-AAAAMMDD-XXXX.' using errcode = 'P0001';
  end if;

  if v_hash is not null then
    select t.id into v_otro from public.ledger_tickets t where t.payment_hash = v_hash and t.id <> v_id limit 1;
    if found then
      raise exception '%', 'DUPLICADO: el pago ya cubre el ticket ' || v_otro || '.' using errcode = 'P0001';
    end if;
  end if;

  if v_plataforma is not null then
    select t.id into v_otro from public.ledger_tickets t
    where t.origen_plataforma = v_plataforma and t.origen_numero = v_numero and t.id <> v_id limit 1;
    if found then
      raise exception '%', 'DUPLICADO: el origen ' || v_plataforma || ' ' || v_numero || ' ya está en el ticket ' || v_otro || '.'
        using errcode = 'P0001';
    end if;
  end if;

  -- Same rule as the CLI: a CacaoMarket order is "market" and a BTCPay invoice carries its own product.
  v_producto := case when v_plataforma = 'cacaomarket' then 'market' else p_ticket #>> '{origen,producto}' end;

  -- Total in integers, as lib dinero.ts computes it. Consumer lines already include IVA. Business
  -- lines add IVA on the net amount: floor((13 * n + 50) / 100), per line.
  select coalesce(sum(case when v_cliente = 'consumidor' then b else b + ((13 * b + 50) / 100) end), 0)::integer
    into v_total
  from (
    select (l ->> 'precioCentavos')::bigint * (l ->> 'cantidad')::bigint as b
    from jsonb_array_elements(p_ticket -> 'lineas') as l
  ) s;

  select lower(concat_ws(' ', v_id, v_numero, (
    select string_agg(l ->> 'descripcion', ' ') from jsonb_array_elements(p_ticket -> 'lineas') as l
  )))
    into v_buscar;

  insert into public.ledger_tickets (
    id, creado_en, estado, cliente, producto, origen_plataforma, origen_numero, total_centavos,
    sats, payment_hash, pagado_en, buscar, datos
  ) values (
    v_id, v_creado, v_estado, v_cliente, v_producto, v_plataforma, v_numero, v_total,
    v_sats, v_hash, v_pagado, coalesce(v_buscar, ''), p_ticket
  )
  on conflict (id) do update set
    estado = excluded.estado,
    cliente = excluded.cliente,
    producto = excluded.producto,
    origen_plataforma = excluded.origen_plataforma,
    origen_numero = excluded.origen_numero,
    total_centavos = excluded.total_centavos,
    sats = excluded.sats,
    payment_hash = excluded.payment_hash,
    pagado_en = excluded.pagado_en,
    buscar = excluded.buscar,
    datos = excluded.datos
  returning * into v_fila;

  return v_fila;
end;
$$;

-- Next number of a serie: the first call returns 1. Atomic, so two requests never get the same number.
create function public.ledger_siguiente_correlativo(p_serie text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_ultimo bigint;
begin
  if p_serie is null or char_length(p_serie) not between 1 and 20 then
    raise exception '%', 'DATOS_INVALIDOS: La serie del correlativo tiene que tener entre 1 y 20 caracteres.' using errcode = 'P0001';
  end if;
  insert into public.ledger_correlativos as c (serie, ultimo) values (p_serie, 1)
  on conflict (serie) do update set ultimo = c.ultimo + 1
  returning c.ultimo into v_ultimo;
  return v_ultimo;
end;
$$;

revoke execute on function public.ledger_guardar_ticket(jsonb) from public, anon, authenticated;
revoke execute on function public.ledger_siguiente_correlativo(text) from public, anon, authenticated;
grant execute on function public.ledger_guardar_ticket(jsonb) to service_role;
grant execute on function public.ledger_siguiente_correlativo(text) to service_role;
