// Tells the booking page whether a Lightning invoice has been paid. The answer comes from BTCPay, never
// from the browser: a booking is returned only when BTCPay says the invoice is Settled.
import type { APIContext } from 'astro';
import { ErrorBtcpay, leerFactura } from '../../../lib/btcpay';
import { MEDIA_URL, todosLosTours } from '../../../lib/tours';
import { pagosConfigurados, reconstruirReserva, ErrorReserva } from '../../../lib/reserva';

export const prerender = false;

const error = (mensaje: string, status: number) => Response.json({ error: mensaje }, { status });
const sinCache = { headers: { 'Cache-Control': 'no-store' } };

export async function GET({ url }: APIContext) {
  const pagos = pagosConfigurados(process.env);
  if (!pagos) return error('Los pagos no están configurados.', 503);

  const facturaId = url.searchParams.get('id') ?? '';
  let factura;
  try {
    factura = await leerFactura(pagos.config, pagos.storeId, facturaId);
  } catch (e) {
    // An id that is malformed or not in this store counts as unknown.
    if (e instanceof ErrorBtcpay && (e.estado === 400 || e.estado === 404)) return error('Factura no encontrada.', 404);
    return error('No se pudo consultar el pago. Probá de nuevo.', 502);
  }

  if (factura.metadata.producto !== 'travel') return error('Factura no encontrada.', 404);
  if (factura.estado === 'Expired' || factura.estado === 'Invalid') {
    return Response.json({ estado: 'vencida' }, sinCache);
  }
  if (factura.estado !== 'Settled') return Response.json({ estado: 'pendiente' }, sinCache);

  // Settled: rebuild the booking from the invoice metadata and check the total against the invoice.
  const tours = await todosLosTours();
  const tour = tours.find((t) => t.id === factura.metadata.tour);
  try {
    const reserva = reconstruirReserva(tour, factura.metadata, factura.sats, {
      ahora: Date.now(),
      mediaUrl: MEDIA_URL,
      facturaId: factura.id,
    });
    return Response.json(reserva, sinCache);
  } catch (e) {
    if (e instanceof ErrorReserva) return error(e.message, e.estado);
    throw e;
  }
}
