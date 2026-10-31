// Starts a booking. The server recomputes everything from the catalogue: the client only says
// which tour, which date and how many people.
//
// With BTCPay configured, the booking is a Lightning invoice: the browser
// polls /api/reservar/estado/ until BTCPay says the invoice is Settled. Without BTCPay this is the
// demo: nothing is charged and the booking is marked demo:true.
import { createHash, randomUUID } from 'node:crypto';
import type { APIContext } from 'astro';
import { crearFactura, enlaceBilleteraDePrueba } from '../../lib/btcpay';
import { configPay, crearCobroPay, ErrorPay, type ConfigPay } from '../../lib/cacaopay';
import { cotizacionUsdBtc } from '../../lib/precio';
import { cotizar, diaDe, hoyEnElSalvador, NOMBRE_DIA } from '../../lib/reparto';
import { MEDIA_URL, personas as limites, todosLosTours } from '../../lib/tours';
import { entornoServidor } from '../../lib/entorno';
import {
  btcpayEnPausa,
  construirReserva,
  datosDeCobro,
  MINUTOS_DE_PAGO,
  metadatosDeFactura,
  PAUSA_BTCPAY,
  pagosConfigurados,
  type TourReserva,
} from '../../lib/reserva';

export const prerender = false;

const error = (mensaje: string, status = 400) => Response.json({ error: mensaje }, { status });
const sinCache = { headers: { 'Cache-Control': 'no-store' } };
// The id the browser makes once per booking attempt (see the booking page script).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST({ request }: APIContext) {
  let c: { tour?: unknown; fecha?: unknown; personas?: unknown; intento?: unknown };
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

  const ahora = Date.now();
  const codigo = createHash('sha256').update(`${tour.id}|${fecha}|${n}|${ahora}|${Math.random()}`).digest('hex').slice(0, 8).toUpperCase();
  const reserva = { codigo, fecha, personas: n, ahora, mediaUrl: MEDIA_URL };

  const entorno = entornoServidor();
  // With CacaoPay configured (CACAO_PAY_URL and CACAO_PAY_API_KEY), the charge is made there. Otherwise BTCPay is used directly.
  const pay = configPay(entorno);
  if (pay) return reservarConPay(pay, tour, fecha, n, c.intento);
  const pagos = await pagosConfigurados(entorno);
  if (!pagos) {
    // Demo: no BTCPay configured, so the booking is confirmed without a payment and marked as demo.
    return Response.json(construirReserva(tour, reserva), sinCache);
  }

  const cotizacion = cotizar(d.precio, n);
  let cotizacionUsd: number;
  try {
    cotizacionUsd = await cotizacionUsdBtc({ env: entorno });
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
  } catch (e) {
    if (btcpayEnPausa(e)) return error(PAUSA_BTCPAY, 503);
    return error('No se pudo crear la factura. Probá de nuevo.', 502);
  }
}

/**
 * The booking through CacaoPay. The attempt id from the browser makes the Idempotency-Key (with the tour), so a double tap
 * or a retry of the same attempt finds the same charge. The code is derived from the same attempt, so both answers carry it.
 * The price and the datos come from the server, never from the browser.
 */
async function reservarConPay(pay: ConfigPay, tour: TourReserva, fecha: string, personas: number, intento: unknown): Promise<Response> {
  // A request without an attempt id gets a new one: the browser always sends it, so only a repeat from the browser is joined.
  const id = intento === undefined || intento === null ? randomUUID() : intento;
  if (typeof id !== 'string' || !UUID.test(id)) return error('Pedido inválido.');
  const hash = createHash('sha256').update(`${tour.id}|${id.toLowerCase()}`).digest('hex');
  const clave = `travel-${hash.slice(0, 40)}`;
  const codigo = hash.slice(0, 8).toUpperCase();
  const datos = datosDeCobro(tour, { codigo, fecha, personas });
  const total = Number(datos.subtotal);
  try {
    const cobro = await crearCobroPay(pay, {
      clave,
      sats: total,
      descripcion: `${tour.data.titulo} · ${fecha} · ${personas} persona(s)`.slice(0, 200),
      referencia: codigo,
      minutos: MINUTOS_DE_PAGO,
      datos,
    });
    if (!cobro.factura) return error('No se pudo crear la factura. Probá de nuevo.', 502);
    // The test-wallet link needs the address of the payment server: it is the origin of the invoice page.
    const base = cobro.enlace_pago?.replace(/\/i\/[^/]+\/?$/, '') ?? null;
    return Response.json(
      {
        estado: 'pendiente',
        factura: {
          id: cobro.id,
          bolt11: cobro.factura,
          sats: cobro.sats,
          expiraEn: cobro.expira_en,
          billeteraDePrueba: base ? enlaceBilleteraDePrueba({ url: base, clave: '' }, cobro.factura) : null,
        },
      },
      sinCache,
    );
  } catch (e) {
    if (e instanceof ErrorPay && e.estado === 409) return error('Ya se está creando esta reserva. Probá de nuevo en un momento.', 409);
    if (btcpayEnPausa(e)) return error(PAUSA_BTCPAY, 503);
    return error('No se pudo crear la factura. Probá de nuevo.', 502);
  }
}
