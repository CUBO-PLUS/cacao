-- CacaoLedger, web: the monthly plan of a business and its dues, charged through CacaoPay.
-- Runs after 20261104000099_ledger_atestaciones_contingencia.sql.
--
-- Same rules as the other ledger migrations: RLS on, no grants to anon or authenticated, service_role only.
--
-- 1. ledger_planes: the plan an account chose (semilla, cosecha or despacho) and when. One row per account.
-- 2. ledger_cuotas: one due per account and month. It keeps the CacaoPay charge that pays it, and how many charges
--    were made: a Lightning invoice lives 24 hours at most, so an unpaid month may need a new one.

create table public.ledger_planes (
  usuario_id uuid primary key references public.usuarios (id) on delete cascade,
  plan text not null check (plan in ('semilla', 'cosecha', 'despacho')),
  elegido_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

alter table public.ledger_planes enable row level security;
revoke all on public.ledger_planes from anon, authenticated;
grant all on public.ledger_planes to service_role;

create table public.ledger_cuotas (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  -- The month, El Salvador time: '2026-11'.
  periodo text not null check (periodo ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  plan text not null check (plan in ('semilla', 'cosecha', 'despacho')),
  -- Plan price plus 13 % IVA, in cents.
  usd_centavos integer not null check (usd_centavos > 0),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'pagada')),
  -- The current CacaoPay charge, and how many were made for this due (each one is a new idempotency key).
  cobro_id uuid,
  intentos integer not null default 0 check (intentos >= 0),
  creada_en timestamptz not null default now(),
  pagada_en timestamptz,
  unique (usuario_id, periodo),
  constraint ledger_cuotas_pagada check ((estado = 'pagada') = (pagada_en is not null))
);

alter table public.ledger_cuotas enable row level security;
revoke all on public.ledger_cuotas from anon, authenticated;
grant all on public.ledger_cuotas to service_role;
