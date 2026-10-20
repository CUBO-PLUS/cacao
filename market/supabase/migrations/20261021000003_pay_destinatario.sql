-- Cacao Pay: the recipient finds the transfers sent to them, and a paid transfer cannot be cancelled.
--
-- A transfer keeps the contact the sender typed. When someone signs in with that phone or email, the
-- server links the transfers to their account (pay_vincular_recibidos), so they show in /recibidos.
-- Nothing here moves money.

-- ---------------------------------------------------------------------------------------------
-- Helpers

-- Digits of a phone, without the country code: "+503 7000 0002" and "50370000002" are both "70000002".
-- Anything that is not a phone keeps its digits as they are.
create function public._pay_telefono_digitos(p_texto text) returns text
language sql immutable set search_path = public as $$
  select case
    when length(d) = 11 and left(d, 3) = '503' then right(d, 8)
    else d
  end
  from (select regexp_replace(coalesce(p_texto, ''), '\D', '', 'g') as d) as t;
$$;

revoke execute on function public._pay_telefono_digitos(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Linking the recipient

-- Links the transfers sent to this user's phone or email to the user. Only transfers with no recipient yet
-- are linked, and never one the user sent to themselves. Returns how many transfers were linked.
-- A phone matches on its digits; an email matches in lower case. A user with no contact links nothing.
create function public.pay_vincular_recibidos(p_usuario uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_contacto text;
  v_telefono text;
  v_filas integer;
begin
  select u.telefono into v_contacto from public.usuarios u where u.id = p_usuario;
  if not found or btrim(coalesce(v_contacto, '')) = '' then
    return 0;
  end if;

  if v_contacto like '%@%' then
    update public.pay_transferencias set destinatario_id = p_usuario
    where destinatario_id is null
      and remitente_id <> p_usuario
      and destinatario_contacto like '%@%'
      and lower(btrim(destinatario_contacto)) = lower(btrim(v_contacto));
  else
    v_telefono := public._pay_telefono_digitos(v_contacto);
    if length(v_telefono) < 8 then
      return 0;
    end if;
    update public.pay_transferencias set destinatario_id = p_usuario
    where destinatario_id is null
      and remitente_id <> p_usuario
      and destinatario_contacto not like '%@%'
      and public._pay_telefono_digitos(destinatario_contacto) = v_telefono;
  end if;

  get diagnostics v_filas = row_count;
  return v_filas;
end;
$$;

revoke execute on function public.pay_vincular_recibidos(uuid) from public, anon, authenticated;
grant execute on function public.pay_vincular_recibidos(uuid) to service_role;

-- ---------------------------------------------------------------------------------------------
-- Cancelling

-- Same as before, plus: a transfer that was paid in Lightning cannot be cancelled (pagada_en).
create or replace function public.pay_cancelar(p_transferencia uuid, p_actor uuid) returns public.pay_transferencias
language plpgsql security definer set search_path = public as $$
declare
  v_transferencia public.pay_transferencias;
begin
  select * into v_transferencia from public.pay_transferencias where id = p_transferencia for update;
  if not found then
    raise exception '%', 'NO_ENCONTRADA: No encontramos esa transferencia.' using errcode = 'P0001';
  end if;
  if p_actor is null or p_actor is distinct from v_transferencia.remitente_id then
    raise exception '%', 'NO_PERMITIDO: Solo quien envió la transferencia puede cancelarla.' using errcode = 'P0001';
  end if;
  if v_transferencia.pagada_en is not null then
    raise exception '%', 'ESTADO_INVALIDO: Este envío ya se pagó. No se puede cancelar.' using errcode = 'P0001';
  end if;
  if v_transferencia.estado <> 'creada' then
    raise exception '%', 'ESTADO_INVALIDO: Solo se puede cancelar una transferencia antes de procesarla.' using errcode = 'P0001';
  end if;

  return public._pay_avanzar(p_transferencia, p_actor, 'cancelada', 'Cancelada por quien envió.', null);
end;
$$;
