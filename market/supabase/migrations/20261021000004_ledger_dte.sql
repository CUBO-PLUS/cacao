-- CacaoLedger on the web: the tax documents emitted for paid tickets, and the sync log's emission counts.
--
-- Same rules as 20261021000002_ledger.sql: RLS on, no grants to anon or authenticated, service_role only.
--
-- Demo limitation: ledger_siguiente_correlativo consumes the number before the document is built, so a
-- rejected document keeps its number (recorded here as estado 'rechazado'). Hacienda numbering tolerates
-- gaps only through invalidation, so a real emission would need that step.

-- ---------------------------------------------------------------------------------------------
-- Documents (one per ticket: the web emits each ticket once)

create table public.ledger_dtes (
  codigo_generacion text primary key
    check (codigo_generacion ~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$'),
  ticket_id text not null references public.ledger_tickets (id),
  tipo_dte text not null check (tipo_dte in ('01', '03')),
  -- Always set: the number is taken before the document is built, so a refused document keeps it.
  numero_control text not null unique,
  ambiente text not null check (ambiente in ('00', '01')),
  estado text not null check (estado in ('aceptado', 'rechazado')),
  -- Simulated reception seal. Present exactly when the document was accepted.
  sello text,
  -- Observations joined with new lines when the document was refused.
  motivo text,
  -- The document as built, as the CLI writes it to datos/dte/. Empty object when it could not be built.
  documento jsonb not null,
  creado_en timestamptz not null default now(),
  check ((estado = 'aceptado') = (sello is not null)),
  check (estado = 'aceptado' or motivo is not null)
);
-- One document per ticket. The unique index also stops two syncs from emitting the same ticket twice.
create unique index ledger_dtes_ticket on public.ledger_dtes (ticket_id);

-- ---------------------------------------------------------------------------------------------
-- Sync log: how many documents the run emitted and refused

alter table public.ledger_sincronizaciones
  add column emitidos int check (emitidos is null or emitidos >= 0),
  add column rechazados int check (rechazados is null or rechazados >= 0);

alter table public.ledger_dtes enable row level security;

revoke all on public.ledger_dtes from anon, authenticated;
grant all on public.ledger_dtes to service_role;
