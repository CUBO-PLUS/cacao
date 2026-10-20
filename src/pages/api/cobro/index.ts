// Asks for an invoice to read one paid story. The price and title come from the server's own data.
// A reader who already paid gets the pass straight away.
import type { APIContext } from 'astro';
import { bd, hayBase } from '../../../lib/servidor/bd';
import {
  historiaDePago,
  modoDemo,
  respuestaError,
  SEGUNDOS_PARA_PAGAR,
  sinGuardar,
  TEXTO_NO_DISPONIBLE,
  tieneAcceso,
  tokenDeAcceso,
  vistaCobro,
  type Cobro,
} from '../../../lib/servidor/cobros';
import { cerradoDe } from '../../../lib/servidor/cerrado';
import { lectorDe } from '../../../lib/servidor/lector';
import { registrarEvento } from '../../../lib/servidor/eventos';
import { cotizacionUsdBtc } from '../../../lib/servidor/precio';
import { crearFactura, type ConfigBtcpay } from '../../../lib/servidor/btcpay';
import { configBtcpay, tiendaBtcpay } from '../../../lib/servidor/pagos-btcpay';

export const prerender = false;

const SIN_BASE = 'Los pagos no están disponibles en este momento.';
const SIN_FACTURA = 'No pudimos crear la factura en este momento. Probá de nuevo en un rato.';

/** The invoice of a reader who has no access yet, made by BTCPay Server (real Lightning). */
async function cobroBtcpay(
  lector: string,
  historia: { slug: string; titulo: string; precioSats: number },
  config: ConfigBtcpay,
  tienda: string,
): Promise<Response> {
  try {
    // One live invoice per reader and story: show it again instead of making another at BTCPay.
    const { data: vigente, error: errorVigente } = await bd().rpc('media_cobro_vigente', {
      p_lector: lector,
      p_slug: historia.slug,
    });
    if (errorVigente) throw errorVigente;
    const viva = (Array.isArray(vigente) ? vigente[0] : vigente) as Cobro | null;
    if (viva) return Response.json(vistaCobro(viva, config), { headers: sinGuardar });

    // The invoice needs a BTC price: the database stores the dollar value and refuses zero.
    let cotizacion: number;
    let factura: Awaited<ReturnType<typeof crearFactura>>;
    try {
      cotizacion = await cotizacionUsdBtc();
      factura = await crearFactura(config, {
        storeId: tienda,
        sats: historia.precioSats,
        minutos: SEGUNDOS_PARA_PAGAR / 60,
        metadata: {
          producto: 'media',
          orderId: `${historia.slug}:${lector}`,
          itemDesc: `Historia: ${historia.titulo}`,
          usdCentavos: Math.ceil((historia.precioSats * cotizacion) / 1_000_000),
          cotizacionUsdBtc: cotizacion,
        },
      });
    } catch (error) {
      // BTCPay or the price service is down, or refused the invoice. The reader can try again.
      console.error(error);
      return Response.json({ error: SIN_FACTURA }, { status: 503, headers: sinGuardar });
    }
    if (!factura.bolt11) {
      return Response.json({ error: SIN_FACTURA }, { status: 503, headers: sinGuardar });
    }

    const { data, error } = await bd().rpc('media_crear_cobro_btcpay', {
      p_lector: lector,
      p_slug: historia.slug,
      p_titulo: historia.titulo,
      p_precio_sats: historia.precioSats,
      p_cotizacion: cotizacion,
      p_factura: factura.bolt11,
      p_factura_id: factura.id,
      p_tienda: tienda,
      p_expira: factura.expiraEn.toISOString(),
    });
    if (error) return respuestaError(error);

    const cobro = (Array.isArray(data) ? data[0] : data) as Cobro;
    await registrarEvento({
      sesion: lector,
      nombre: 'creo_cobro',
      ruta: `/historias/${historia.slug}/`,
      objeto: historia.slug,
    });
    return Response.json(vistaCobro(cobro, config), { headers: sinGuardar });
  } catch (error) {
    return respuestaError(error);
  }
}

export async function POST(context: APIContext) {
  let slug: unknown;
  try {
    ({ slug } = await context.request.json());
  } catch {
    return Response.json({ error: 'Pedido inválido.' }, { status: 400, headers: sinGuardar });
  }
  const historia = await historiaDePago(slug);
  if (!historia) {
    return Response.json({ error: 'Esa historia no existe o es gratis.' }, { status: 404, headers: sinGuardar });
  }
  if (!hayBase()) {
    return Response.json({ error: SIN_BASE }, { status: 503, headers: sinGuardar });
  }

  let lector: string;
  try {
    // A paid story without locked text cannot be sold: the invoice would open nothing.
    if ((await cerradoDe(historia.slug)) === null) {
      return Response.json({ error: TEXTO_NO_DISPONIBLE }, { status: 503, headers: sinGuardar });
    }
    lector = await lectorDe(context);
    if (await tieneAcceso(lector, historia.slug)) {
      return Response.json({ estado: 'pagada', token: tokenDeAcceso(historia.slug).token }, { headers: sinGuardar });
    }
  } catch (error) {
    return respuestaError(error);
  }

  // Outside the demo, the invoice is a real Lightning invoice from BTCPay Server, or there is no payment at all.
  if (!modoDemo()) {
    const config = configBtcpay();
    const tienda = tiendaBtcpay();
    if (!config || !tienda) {
      return Response.json({ error: SIN_BASE }, { status: 503, headers: sinGuardar });
    }
    return cobroBtcpay(lector, historia, config, tienda);
  }

  // The invoice needs a BTC price: the database stores the dollar value and refuses zero.
  let cotizacion: number;
  try {
    cotizacion = await cotizacionUsdBtc();
  } catch (error) {
    console.error(error);
    const mensaje = error instanceof Error ? error.message.replace(/^[A-Z_]+:\s*/, '') : 'No pudimos consultar el precio.';
    return Response.json({ error: mensaje }, { status: 503, headers: sinGuardar });
  }

  // Demo only: the simulated invoice.
  const { data, error } = await bd().rpc('media_crear_cobro', {
    p_lector: lector,
    p_slug: historia.slug,
    p_titulo: historia.titulo,
    p_precio_sats: historia.precioSats,
    p_cotizacion: cotizacion,
    p_segundos: SEGUNDOS_PARA_PAGAR,
  });
  if (error) return respuestaError(error);

  const cobro = (Array.isArray(data) ? data[0] : data) as Cobro;
  await registrarEvento({
    sesion: lector,
    nombre: 'creo_cobro',
    ruta: `/historias/${historia.slug}/`,
    objeto: historia.slug,
  });
  return Response.json(vistaCobro(cobro), { headers: sinGuardar });
}
