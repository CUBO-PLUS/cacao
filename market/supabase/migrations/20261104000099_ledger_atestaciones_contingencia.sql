-- CacaoLedger, web: rate attestation chain, simulated outage switch, and the contingency state of a document.
-- Runs after 20261103000001_pay_datos.sql.
--
-- Same rules as the other ledger migrations: RLS on, no grants to anon or authenticated, service_role only.
--
-- What changes:
-- 1. ledger_atestaciones: the rate attestation of each Lightning payment, chained like the CLI's (src/atestacion.ts).
--    Each row keeps the hash of the record before it (anterior) and its own hash. The hash is computed in the
--    application with the same canonical JSON as the CLI; the database only refuses to append out of order.
-- 2. ledger_anexar_atestacion: appends one record under an advisory lock. A ticket keeps at most one record.
-- 3. ledger_simulacion: a single row with the owner's SIMULATED outage of Hacienda. It changes nothing at the Ministry.
-- 4. ledger_dtes accepts the state "contingencia": a document built with tipoOperacion 2 that waits to be sent.

-- ---------------------------------------------------------------------------------------------
-- 1. Attestation chain

create table public.ledger_atestaciones (
  -- Position in the chain. Assigned by the database, in the order records were appended.
  orden bigint generated always as identity primary key,
  ticket_id text not null unique check (ticket_id ~ '^TK-[0-9]{8}-[0-9A-F]{4}$'),
  codigo_generacion text not null check (codigo_generacion ~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$'),
  -- Hash of the record before this one; 64 zeros for the first record.
  anterior text not null check (anterior ~ '^[0-9a-f]{64}$'),
  -- SHA-256 of the canonical JSON of {anterior, contenido}.
  hash text not null unique check (hash ~ '^[0-9a-f]{64}$'),
  -- The record itself: every field of the attestation except anterior and hash.
  contenido jsonb not null check (jsonb_typeof(contenido) = 'object'),
  creado_en timestamptz not null default now()
);

alter table public.ledger_atestaciones enable row level security;
revoke all on public.ledger_atestaciones from anon, authenticated;
grant all on public.ledger_atestaciones to service_role;

-- Appends a record whose anterior is the hash of the last record. A record for a ticket that already has one is
-- returned unchanged and nothing is written. A record that does not follow the chain is refused (CADENA_DESALINEADA).
create function public.ledger_anexar_atestacion(p_ticket text, p_codigo text, p_anterior text, p_hash text, p_contenido jsonb)
returns public.ledger_atestaciones
language plpgsql security definer set search_path = public as $$
declare
  v_fila public.ledger_atestaciones;
  v_ultimo text;
begin
  if p_ticket is null or p_codigo is null or p_anterior is null or p_hash is null or p_contenido is null then
    raise exception '%', 'DATOS_INVALIDOS: La atestación necesita ticket, código, anterior, hash y contenido.' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ledger_atestaciones', 0));
  select a.* into v_fila from public.ledger_atestaciones a where a.ticket_id = p_ticket;
  if found then
    return v_fila;
  end if;
  select a.hash into v_ultimo from public.ledger_atestaciones a order by a.orden desc limit 1;
  if coalesce(v_ultimo, repeat('0', 64)) <> p_anterior then
    raise exception '%', 'CADENA_DESALINEADA: La atestación no sigue al último registro de la cadena.' using errcode = 'P0001';
  end if;
  insert into public.ledger_atestaciones (ticket_id, codigo_generacion, anterior, hash, contenido)
  values (p_ticket, p_codigo, p_anterior, p_hash, p_contenido)
  returning * into v_fila;
  return v_fila;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. Simulated outage of Hacienda (demo control, owner only in the web)

create table public.ledger_simulacion (
  id smallint primary key check (id = 1),
  -- True while the simulated outage is on: documents are built with tipoOperacion 2 and wait.
  caida boolean not null default false,
  -- When the outage started (null while it is off).
  desde timestamptz,
  actualizado_en timestamptz not null default now()
);

insert into public.ledger_simulacion (id, caida) values (1, false) on conflict (id) do nothing;

alter table public.ledger_simulacion enable row level security;
revoke all on public.ledger_simulacion from anon, authenticated;
grant all on public.ledger_simulacion to service_role;

-- ---------------------------------------------------------------------------------------------
-- 3. Contingency state of a document

alter table public.ledger_dtes drop constraint ledger_dtes_estado_check;
alter table public.ledger_dtes drop constraint ledger_dtes_motivo_check;
alter table public.ledger_dtes
  add constraint ledger_dtes_estado_check check (estado in ('reservado', 'aceptado', 'rechazado', 'contingencia')),
  add constraint ledger_dtes_motivo_check check (estado in ('reservado', 'aceptado', 'contingencia') or motivo is not null);

-- The functions that take the service role only: grants are explicit for the new objects.
revoke execute on function public.ledger_anexar_atestacion(text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.ledger_anexar_atestacion(text, text, text, text, jsonb) to service_role;
