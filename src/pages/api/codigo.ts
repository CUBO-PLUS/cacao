// Restores a paid story on this browser from the access code the reader saved after paying.
// The code is checked here, on the server: its signature, its expiry, and that it names this story.
// Wrong codes are rate-limited per client: after too many, the route answers 429 for a while.
// Answers the same pass the page keeps, so the text still goes through /api/contenido with it.
import type { APIContext } from 'astro';
import { historiaDePago, sinGuardar } from '../../lib/servidor/cobros';
import { intentosCodigo, limpiarCodigo, pasePorCodigo } from '../../lib/codigo';

export const prerender = false;

export async function POST(context: APIContext) {
  const clave = context.clientAddress || 'desconocida';
  if (intentosCodigo.bloqueado(clave)) {
    return Response.json(
      { error: 'Hiciste demasiados intentos. Esperá unos minutos y probá de nuevo.' },
      { status: 429, headers: sinGuardar },
    );
  }

  let datos: { slug?: unknown; codigo?: unknown };
  try {
    datos = (await context.request.json()) as { slug?: unknown; codigo?: unknown };
  } catch {
    return Response.json({ error: 'Pedido inválido.' }, { status: 400, headers: sinGuardar });
  }

  const historia = await historiaDePago(datos.slug);
  if (!historia) {
    return Response.json({ error: 'Esa historia no existe o es gratis.' }, { status: 404, headers: sinGuardar });
  }
  const codigo = limpiarCodigo(datos.codigo);
  if (!codigo) {
    return Response.json({ error: 'Escribí o pegá tu código de acceso.' }, { status: 400, headers: sinGuardar });
  }

  const pase = pasePorCodigo(codigo, historia.slug);
  if (!pase) {
    intentosCodigo.registrarFallo(clave);
    // Same answer for a forged, expired, or other-story code: nothing tells the caller which.
    return Response.json(
      { error: 'Ese código no sirve para esta historia. Revisá que esté completo, o que no haya vencido.' },
      { status: 401, headers: sinGuardar },
    );
  }
  return Response.json({ token: codigo, expira: pase.exp }, { headers: sinGuardar });
}
