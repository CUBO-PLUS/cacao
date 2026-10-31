-- Cacao Pay: notices become a durable queue. pay_avisos is the outbox: the server sends from the table, never from
-- memory, so a restart loses nothing. The state change and its notice are written in one transaction (pay_aplicar_btcpay
-- and pay_cancelar_cobro insert the notice in the same function that changes the charge).
-- 1. Delivery state (entrega): pendiente, entregado or muerto. enviado_en is the time of delivery; muerto_en the time a
--    notice was given up. A dead notice stays in the table, visible, and is never deleted.
-- 2. Retries: proximo_intento_en. After failed attempt n the next one waits 30 seconds times 2 to the power n-1, capped
--    at one hour. intentos counts the attempts started: a claim counts, so a sender that dies still used its attempt.
--    After 10 attempts without an answer the notice is muerto.
-- 3. Claims: pay_reclamar_avisos takes due notices with for update skip locked and gives each one a token and a lease
--    (reclamado_hasta). A sender that crashed keeps its claim only until the lease ends; another sender takes the notice.
-- 4. pay_cerrar_aviso records the outcome. A failure counts only for the claim that made it; a delivery is always kept.
-- Delivery is at least once: a notice can reach the client twice when a sender dies after the client answered. Every
-- attempt sends the same Cacao-Aviso-Id, so the client can discard the repeat.

-- ---------------------------------------------------------------------------------------------
-- Table

alter table public.pay_avisos
  add column entrega text not null default 'pendiente' check (entrega in ('pendiente', 'entregado', 'muerto')),
  add column proximo_intento_en timestamptz not null default now(),
  add column reclamo uuid,
  add column reclamado_hasta timestamptz,
  add column muerto_en timestamptz;

update public.pay_avisos set entrega = 'entregado' where enviado_en is not null;

alter table public.pay_avisos add constraint pay_avisos_entrega_coherente check (
  (entrega = 'entregado') = (enviado_en is not null) and (entrega = 'muerto') = (muerto_en is not null));

create index pay_avisos_pendientes_idx on public.pay_avisos (proximo_intento_en) where entrega = 'pendiente';

-- ---------------------------------------------------------------------------------------------
-- Rules, in one place

create function public._aviso_maximo_intentos() returns integer
language sql immutable as $$ select 10 $$;

-- The wait after failed attempt n: 30 s, 1 min, 2 min ... capped at one hour.
create function public._aviso_espera(p_intentos integer) returns interval
language sql immutable as $$
  select make_interval(secs => least(3600, 30 * power(2, greatest(p_intentos, 1) - 1)))
$$;

-- ---------------------------------------------------------------------------------------------
-- Functions

-- Takes due notices for one sender. Each one gets a new token, a lease of p_duracion_segundos, and one more attempt.
-- p_aviso restricts the claim to one notice (the one a state change just wrote). A notice whose attempts ran out and
-- whose last sender is gone is given up here, so it is visible as muerto.
create function public.pay_reclamar_avisos(p_limite integer, p_duracion_segundos integer, p_aviso uuid default null)
returns table (aviso_id uuid, cobro_id uuid, estado_cobro text, token uuid, intentos integer)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  if p_limite is null or p_limite not between 1 and 100 then
    raise exception '%', 'DATOS_INVALIDOS: El lote de avisos no es válido.' using errcode = 'P0001';
  end if;
  if p_duracion_segundos is null or p_duracion_segundos not between 10 and 3600 then
    raise exception '%', 'DATOS_INVALIDOS: La duración del reclamo no es válida.' using errcode = 'P0001';
  end if;

  update public.pay_avisos a set entrega = 'muerto', muerto_en = now(), reclamo = null, reclamado_hasta = null,
    ultimo_error = left(coalesce(a.ultimo_error, 'Sin respuesta del receptor.'), 200)
  where a.entrega = 'pendiente' and a.intentos >= public._aviso_maximo_intentos()
    and (a.reclamado_hasta is null or a.reclamado_hasta <= now())
    and (p_aviso is null or a.id = p_aviso);

  return query
  with tomados as (
    update public.pay_avisos a set intentos = a.intentos + 1, reclamo = gen_random_uuid(),
      reclamado_hasta = now() + make_interval(secs => p_duracion_segundos)
    where a.id in (
      select s.id from public.pay_avisos s
      where s.entrega = 'pendiente' and s.proximo_intento_en <= now()
        and s.intentos < public._aviso_maximo_intentos()
        and (s.reclamado_hasta is null or s.reclamado_hasta <= now())
        and (p_aviso is null or s.id = p_aviso)
      order by s.proximo_intento_en
      for update skip locked
      limit p_limite)
    returning a.id, a.cobro_id, a.estado, a.reclamo, a.intentos
  )
  select t.id, t.cobro_id, t.estado, t.reclamo, t.intentos from tomados t;
end;
$$;

-- Records the outcome of one attempt. Returns what the notice is now: entregado, pendiente (retry at proximo_intento_en),
-- muerto (no attempts left), reclamo_ajeno (a failure from a sender whose claim already ended) or ninguno.
create function public.pay_cerrar_aviso(p_aviso uuid, p_token uuid, p_ok boolean, p_error text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_aviso public.pay_avisos;
begin
  select * into v_aviso from public.pay_avisos where id = p_aviso for update;
  if not found then
    return 'ninguno';
  end if;
  if v_aviso.entrega = 'entregado' then
    return 'entregado';
  end if;

  if coalesce(p_ok, false) then
    update public.pay_avisos set entrega = 'entregado', enviado_en = now(), muerto_en = null, reclamo = null,
      reclamado_hasta = null, ultimo_error = null
    where id = p_aviso;
    return 'entregado';
  end if;

  if v_aviso.entrega = 'muerto' then
    return 'muerto';
  end if;
  if v_aviso.reclamo is distinct from p_token then
    return 'reclamo_ajeno';
  end if;

  if v_aviso.intentos >= public._aviso_maximo_intentos() then
    update public.pay_avisos set entrega = 'muerto', muerto_en = now(), reclamo = null, reclamado_hasta = null,
      ultimo_error = left(p_error, 200)
    where id = p_aviso;
    return 'muerto';
  end if;

  update public.pay_avisos set proximo_intento_en = now() + public._aviso_espera(v_aviso.intentos), reclamo = null,
    reclamado_hasta = null, ultimo_error = left(p_error, 200)
  where id = p_aviso;
  return 'pendiente';
end;
$$;

-- The old single-step recorder is replaced by the claim and the outcome above.
drop function public.pay_marcar_aviso(uuid, boolean, text);

-- ---------------------------------------------------------------------------------------------
-- Grants: only the server (service role) runs the queue. The rules are used by those functions only.

revoke execute on function public._aviso_maximo_intentos() from public, anon, authenticated;
revoke execute on function public._aviso_espera(integer) from public, anon, authenticated;

revoke execute on function public.pay_reclamar_avisos(integer, integer, uuid) from public, anon, authenticated;
grant execute on function public.pay_reclamar_avisos(integer, integer, uuid) to service_role;

revoke execute on function public.pay_cerrar_aviso(uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.pay_cerrar_aviso(uuid, uuid, boolean, text) to service_role;
