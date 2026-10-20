-- CacaoLedger security and numbering fixes. Runs after 20261021000004_ledger_dte.sql.
--
-- Same rules as the ledger migrations: RLS on, no grants to anon or authenticated, every function security
-- definer with search_path set, and execute for service_role only.
--
-- What changes:
-- 1. A lease (ledger_candados) so two sync runs never overlap. PostgREST runs each rpc in its own transaction,
--    so a session advisory lock would be released at once; a row with an expiry works across calls.
-- 2. A reservation (ledger_reservar_dte) that takes the control number only when the ticket has no document
--    yet. The placeholder row and the correlativo are written in the same transaction, so two runs never
--    number the same ticket twice. A reserved row is completed by the next run that finds it.
-- 3. ledger_guardar_ticket refuses to overwrite a ticket with another origin or payment (DUPLICADO).

-- ---------------------------------------------------------------------------------------------
-- 1. Lease

create table public.ledger_candados (
  nombre text primary key check (char_length(nombre) between 1 and 40),
  -- The lease ends at this instant. Another caller may take it after that.
  hasta timestamptz not null,
  dueno text not null check (char_length(dueno) between 1 and 80)
);

alter table public.ledger_candados enable row level security;
revoke all on public.ledger_candados from anon, authenticated;
grant all on public.ledger_candados to service_role;

-- True when the caller got the lease: it was free, or its previous holder let it expire.
create function public.ledger_tomar_candado(p_nombre text, p_dueno text, p_segundos int) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_ok boolean;
begin
  if p_nombre is null or char_length(p_nombre) not between 1 and 40
     or p_dueno is null or char_length(p_dueno) not between 1 and 80
     or p_segundos is null or p_segundos not between 1 and 3600 then
    raise exception '%', 'DATOS_INVALIDOS: El candado necesita nombre, dueño y entre 1 y 3600 segundos.' using errcode = 'P0001';
  end if;
  insert into public.ledger_candados as c (nombre, hasta, dueno)
  values (p_nombre, now() + make_interval(secs => p_segundos), p_dueno)
  on conflict (nombre) do update set hasta = excluded.hasta, dueno = excluded.dueno
    where c.hasta < now()
  returning true into v_ok;
  return coalesce(v_ok, false);
end;
$$;

-- Releases the lease only for its holder. Returns false when the lease was not theirs (or had expired).
create function public.ledger_soltar_candado(p_nombre text, p_dueno text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  delete from public.ledger_candados where nombre = p_nombre and dueno = p_dueno;
  return found;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. Reservation of the control number

-- The state "reservado" and the correlativo the row holds. The numero_control is a placeholder until the document is built.
alter table public.ledger_dtes add column correlativo bigint;

-- Drop every check on ledger_dtes and add them back with names, so the new state is allowed.
do $$
declare
  r record;
begin
  for r in select c.conname from pg_constraint c where c.conrelid = 'public.ledger_dtes'::regclass and c.contype = 'c' loop
    execute format('alter table public.ledger_dtes drop constraint %I', r.conname);
  end loop;
end;
$$;

alter table public.ledger_dtes
  add constraint ledger_dtes_codigo_check
    check (codigo_generacion ~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$'),
  add constraint ledger_dtes_tipo_check check (tipo_dte in ('01', '03')),
  add constraint ledger_dtes_ambiente_check check (ambiente in ('00', '01')),
  add constraint ledger_dtes_estado_check check (estado in ('reservado', 'aceptado', 'rechazado')),
  add constraint ledger_dtes_sello_check check ((estado = 'aceptado') = (sello is not null)),
  add constraint ledger_dtes_motivo_check check (estado in ('reservado', 'aceptado') or motivo is not null),
  add constraint ledger_dtes_correlativo_check check (correlativo is null or correlativo >= 1),
  add constraint ledger_dtes_reserva_check check (estado <> 'reservado' or correlativo is not null);

-- Reserves the document of a ticket: takes the next number of the serie and inserts the placeholder row (unique on
-- ticket_id) in the same transaction. Returns null when the ticket already has a row, and then no number is taken.
-- A transaction lock on the ticket makes the check and the insert one step, so two runs never both take a number.
create function public.ledger_reservar_dte(p_ticket text, p_serie text, p_tipo text, p_codigo text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_numero bigint;
begin
  if p_tipo not in ('01', '03')
     or p_codigo is null or p_codigo !~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$' then
    raise exception '%', 'DATOS_INVALIDOS: El tipo o el código de generación de la reserva no son válidos.' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ledger_reservar_dte:' || p_ticket, 0));
  if exists (select 1 from public.ledger_dtes where ticket_id = p_ticket) then
    return null;
  end if;

  v_numero := public.ledger_siguiente_correlativo(p_serie);
  insert into public.ledger_dtes (
    codigo_generacion, ticket_id, tipo_dte, numero_control, ambiente, estado, sello, motivo, documento, creado_en,
    correlativo
  ) values (
    p_codigo, p_ticket, p_tipo, 'RESERVADO-' || p_codigo, '00', 'reservado', null, null, '{}'::jsonb, now(),
    v_numero
  );
  return v_numero;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. Tickets: no overwrite with another origin or payment

create or replace function public.ledger_guardar_ticket(p_ticket jsonb) returns public.ledger_tickets
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
  v_previo public.ledger_tickets;
  v_fila public.ledger_tickets;
begin
  if v_id is null or v_id !~ '^TK-[0-9]{8}-[0-9A-F]{4}$' then
    raise exception '%', 'DATOS_INVALIDOS: El identificador del ticket no tiene la forma TK-AAAAMMDD-XXXX.' using errcode = 'P0001';
  end if;

  -- The same ticket id with another origin or another payment is never overwritten.
  select * into v_previo from public.ledger_tickets t where t.id = v_id;
  if found then
    if (v_previo.origen_plataforma is not null
        and (v_previo.origen_plataforma is distinct from v_plataforma or v_previo.origen_numero is distinct from v_numero))
       or (v_previo.payment_hash is not null and v_previo.payment_hash is distinct from v_hash) then
      raise exception '%', 'DUPLICADO: el ticket ' || v_id || ' ya existe con otro origen o pago.' using errcode = 'P0001';
    end if;
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

  -- A concurrent insert of another ticket with the same hash or origin reaches the unique indexes: report it as DUPLICADO.
  begin
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
  exception
    when unique_violation then
      raise exception '%', 'DUPLICADO: el ticket ' || v_id || ' choca con otro ticket por pago u origen.' using errcode = 'P0001';
  end;

  return v_fila;
end;
$$;

revoke execute on function public.ledger_tomar_candado(text, text, int) from public, anon, authenticated;
revoke execute on function public.ledger_soltar_candado(text, text) from public, anon, authenticated;
revoke execute on function public.ledger_reservar_dte(text, text, text, text) from public, anon, authenticated;
grant execute on function public.ledger_tomar_candado(text, text, int) to service_role;
grant execute on function public.ledger_soltar_candado(text, text) to service_role;
grant execute on function public.ledger_reservar_dte(text, text, text, text) to service_role;
