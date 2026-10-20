// Starts a booking. The server recomputes everything from the catalogue: the client only says
// which tour, which date, how many people, and optionally shows a reader token.
//
// With BTCPay configured, the booking is a Lightning invoice and no pase is signed yet: the browser
// polls /api/reservar/estado/ until BTCPay says the invoice is Settled. Without BTCPay this is the
// demo: nothing is charged and the booking is marked demo:true.
import { createHash } from 'node:crypto';
import type { APIContext } from 'astro';
import { crearFactura, enlaceBilleteraDePrueba } from '../../lib/btcpay';
import { cotizacionUsdBtc } from '../../lib/precio';
import { cotizar, diaDe, hoyEnElSalvador, NOMBRE_DIA } from '../../lib/reparto';
import { MEDIA_URL, personas as limites, todosLosTours } from '../../lib/tours';
import { esLector } from '../../lib/lector';
import {
  construirReserva,
  MINUTOS_DE_PAGO,
  metadatosDeFactura,
  pagosConfigurados,
} from '../../lib/reserva';

export const prerender = false;

const error = (mensaje: string, status = 400) => Response.json({ error: mensaje }, { status });
const sinCache = { headers: { 'Cache-Control': 'no-store' } };

export async function POST({ request }: APIContext) {
  let c: { tour?: unknown; fecha?: unknown; personas?: unknown; lector?: unknown };
  try {
    c = await request.json();
  } catch {
    return error('Pedido inválido.');
  }
  // JSON can also be null, a number or an array: only an object carries the booking fields.
  if (typeof c !== 'object' || c === null || Array.isArray(c)) return error('Pedido inválido.');

  const tour = (await todosLosTours()).find((t) => t.id === c.tour);
  if (!tour) return error('Esa experiencia no existe.', 404);
  const d = tour.data;

  const fecha = typeof c.fecha === 'string' ? c.fecha : '';
  const dia = diaDe(fecha);
  const hoy = hoyEnElSalvador();
  if (!dia) return error('Elegí una fecha.');
  if (fecha <= hoy) return error('La fecha tiene que ser a partir de mañana.');
  if (!d.salidas.includes(dia)) {
    return error(`Esta experiencia no sale los ${NOMBRE_DIA[dia]}. Sale: ${d.salidas.map((s) => NOMBRE_DIA[s]).join(', ')}.`);
  }

  const { min, max } = limites(d.grupo);
  const n = Number(c.personas);
  if (!Number.isInteger(n) || n < min || n > max) return error(`El grupo es de ${min} a ${max} personas.`);

  const lector = esLector(c.lector, d.historias);
  const ahora = Date.now();
  const codigo = createHash('sha256').update(`${tour.id}|${fecha}|${n}|${ahora}|${Math.random()}`).digest('hex').slice(0, 8).toUpperCase();
  const reserva = { codigo, fecha, personas: n, lector, ahora, mediaUrl: MEDIA_URL };

  const pagos = pagosConfigurados(process.env);
  if (!pagos) {
    // Demo: no BTCPay configured, so the booking is confirmed without a payment and marked as demo.
    return Response.json(construirReserva(tour, reserva), sinCache);
  }

  const cotizacion = cotizar(d.precio, n, lector);
  let cotizacionUsd: number;
  try {
    cotizacionUsd = await cotizacionUsdBtc();
  } catch {
    return error('No hay cotización del bitcoin. Probá de nuevo en un minuto.', 503);
  }

  try {
    const factura = await crearFactura(pagos.config, {
      storeId: pagos.storeId,
      sats: cotizacion.total,
      minutos: MINUTOS_DE_PAGO,
      metadata: metadatosDeFactura(tour, {
        codigo,
        fecha,
        personas: n,
        lector,
        cotizacionUsdBtc: cotizacionUsd,
        usdCentavos: Math.ceil((cotizacion.total * cotizacionUsd) / 1e6),
      }),
    });
    if (!factura.bolt11) return error('No se pudo crear la factura. Probá de nuevo.', 502);
    return Response.json(
      {
        estado: 'pendiente',
        factura: {
          id: factura.id,
          bolt11: factura.bolt11,
          sats: factura.sats,
          expiraEn: factura.expiraEn.toISOString(),
          billeteraDePrueba: enlaceBilleteraDePrueba(pagos.config, factura.bolt11),
        },
      },
      sinCache,
    );
  } catch {
    return error('No se pudo crear la factura. Probá de nuevo.', 502);
  }
}
