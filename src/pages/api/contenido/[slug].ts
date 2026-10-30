// The locked part of a story. Served to a valid `pago` token that covers this story (the reader's own
// unlock), or to a browser whose cookie shows it paid.
// The text is read from public.media_cerrado with the service role (see lib/servidor/cerrado.ts).
import type { APIContext } from 'astro';
import { verificar } from '../../../lib/firma';
import { hayBase } from '../../../lib/servidor/bd';
import { cerradoDe } from '../../../lib/servidor/cerrado';
import { historiaDePago, respuestaError, TEXTO_NO_DISPONIBLE, tieneAcceso } from '../../../lib/servidor/cobros';
import { cookieLector } from '../../../lib/servidor/lector';

export const prerender = false;

const PRIVADO = { 'Cache-Control': 'private, no-store', Vary: 'Authorization, Cookie' };

export async function GET(context: APIContext) {
  if (!hayBase()) {
    return Response.json(
      { error: 'No podemos abrir la historia en este momento. Probá de nuevo más tarde.' },
      { status: 503, headers: PRIVADO },
    );
  }
  const slug = context.params.slug ?? '';
  let html: string | null;
  try {
    html = await cerradoDe(slug);
  } catch (error) {
    return respuestaError(error);
  }
  if (html === null) {
    // A paid story with no row in media_cerrado is a missing text, not an unknown story.
    if (await historiaDePago(slug)) {
      return Response.json({ error: TEXTO_NO_DISPONIBLE }, { status: 503, headers: PRIVADO });
    }
    return Response.json({ error: 'Esa historia no existe o es gratis.' }, { status: 404, headers: PRIVADO });
  }

  const token = (context.request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const pago = verificar(token);
  if (pago && pago.tipo === 'pago' && pago.slugs.includes(slug)) {
    return Response.json({ html, expira: pago.exp, tipo: pago.tipo }, { headers: PRIVADO });
  }

  // No valid token: the cookie still proves the reader paid, so access outlives the stored token.
  const lector = cookieLector(context);
  if (lector) {
    try {
      if (await tieneAcceso(lector, slug)) {
        return Response.json({ html, tipo: 'acceso' }, { headers: PRIVADO });
      }
    } catch (error) {
      return respuestaError(error);
    }
  }
  return Response.json({ error: 'Acceso vencido o inválido.' }, { status: 401, headers: PRIVADO });
}
