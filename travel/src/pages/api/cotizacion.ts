// BTC/USD rate for the approximate dollar values on the pages. Public and read-only: the price is the same
// one the booking API uses, and it is cached for a minute.
import type { APIContext } from 'astro';
import { entornoServidor } from '../../lib/entorno';
import { cotizacionUsdBtc } from '../../lib/precio';

export const prerender = false;

export async function GET(_: APIContext) {
  try {
    const usdPorBtc = await cotizacionUsdBtc({ env: entornoServidor() });
    return Response.json({ usdPorBtc }, { headers: { 'Cache-Control': 'public, max-age=60' } });
  } catch {
    return Response.json({ error: 'No hay cotización del bitcoin.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
