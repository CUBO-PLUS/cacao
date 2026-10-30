import { clerkMiddleware } from '@clerk/nextjs/server';
import type { NextFetchEvent, NextRequest } from 'next/server';

import { existeCobro } from '@/servidor/cobro';
import { existeCodigo } from '@/servidor/transferencias';

const clerk = clerkMiddleware();

// The 404 of an unknown link is decided here, before the page streams. A page that calls notFound() streams
// after the loading boundary has sent its 200, so its status could not change.
type Ausencia = { titulo: string; texto: string; enlace: string; etiqueta: string };

const SIN_ENVIO: Ausencia = {
  titulo: 'No encontramos un envío con ese código',
  texto: 'Revisá el código que te pasaron. Se ve así: CP-7F3K-92QD.',
  enlace: '/rastrear',
  etiqueta: 'Probar otro código',
};

const SIN_COBRO: Ausencia = {
  titulo: 'Este enlace de cobro no existe',
  texto: 'Puede que el enlace esté mal o que ya no sirva. Pedile a quien te mandó el dinero que te mande otro.',
  enlace: '/',
  etiqueta: 'Ir al inicio',
};

// Only the existence is read, and a failed read never blocks the page: the page decides then.
async function ausenciaDe(ruta: string): Promise<Ausencia | null> {
  const partes = ruta.replace(/\/+$/, '').split('/');
  if (partes.length !== 3 || (partes[1] !== 't' && partes[1] !== 'cobrar')) return null;
  try {
    if (partes[1] === 't') return (await existeCodigo(partes[2])) ? null : SIN_ENVIO;
    return (await existeCobro(partes[2])) ? null : SIN_COBRO;
  } catch (error) {
    console.error('Comprobar el enlace:', error instanceof Error ? error.message : error);
    return null;
  }
}

function respuestaNoEncontrada(ausencia: Ausencia): Response {
  const html = `<!doctype html>
<html lang="es-SV">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${ausencia.titulo} · CacaoPay</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;box-sizing:border-box;font-family:system-ui,sans-serif;background:#fffaf4;color:#2a1912}
main{max-width:32rem;display:grid;gap:12px;line-height:1.5}
h1{font-size:1.75rem;margin:0}
a{color:#5a3221;font-weight:600}
</style>
</head>
<body>
<main>
<h1>${ausencia.titulo}</h1>
<p>${ausencia.texto}</p>
<p><a href="${ausencia.enlace}">${ausencia.etiqueta}</a></p>
</main>
</body>
</html>`;
  return new Response(html, {
    status: 404,
    headers: { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex, nofollow' },
  });
}

// Runs before each page request. Clerk refreshes the session token when needed, so Server
// Components and actions see a valid one. It never redirects: pages decide that. Unknown tracking
// codes and claim links get a 404 here.
export default async function proxy(request: NextRequest, evento: NextFetchEvent) {
  const ausencia = await ausenciaDe(request.nextUrl.pathname);
  if (ausencia) return respuestaNoEncontrada(ausencia);
  return clerk(request, evento);
}

// Static files skip the proxy: images, fonts, the manifest and Next's own assets.
export const config = {
  matcher: ['/((?!_next/static|_next/image|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|webmanifest)$).*)'],
};
