// The state of one invoice. Only the reader who owns it gets an answer; anyone else gets 404.
import type { APIContext } from 'astro';
import { bd, hayBase } from '../../../../lib/servidor/bd';
import {
  cobroDe,
  respuestaError,
  sinGuardar,
  tokenDeAcceso,
  UUID,
  vencerCobros,
  vistaCobro,
  type Cobro,
} from '../../../../lib/servidor/cobros';
import { leerFactura } from '../../../../lib/servidor/btcpay';
import { configBtcpay } from '../../../../lib/servidor/pagos-btcpay';
import { registrarEvento } from '../../../../lib/servidor/eventos';
import { cookieLector } from '../../../../lib/servidor/lector';

export const prerender = false;

/**
 * Asks BTCPay about a pending BTCPay invoice. Only a Settled invoice counts: the database then records the payment.
 * Any BTCPay error answers null, so the invoice stays pending and the next poll tries again.
 */
async function confirmarEnBtcpay(cobro: Cobro, lector: string): Promise<Cobro | null> {
  const config = configBtcpay();
  if (!config || !cobro.btcpay_factura_id || !cobro.btcpay_tienda_id) return null;
  try {
    const factura = await leerFactura(config, cobro.btcpay_tienda_id, cobro.btcpay_factura_id);
    if (factura.estado !== 'Settled') return null;
  } catch (error) {
    console.error(error);
    return null;
  }

  const { data, error } = await bd().rpc('media_confirmar_btcpay', { p_factura_id: cobro.btcpay_factura_id });
  if (error) throw error;
  const pagada = (Array.isArray(data) ? data[0] : data) as Cobro;
  await registrarEvento({
    sesion: lector,
    nombre: 'pago',
    ruta: `/historias/${pagada.slug}/`,
    objeto: pagada.slug,
    valorUsdCentavos: pagada.precio_usd_centavos,
  });
  return pagada;
}

export async function GET(context: APIContext) {
  const id = context.params.id ?? '';
  const lector = cookieLector(context);
  if (!UUID.test(id) || !lector) {
    return Response.json({ error: 'No encontramos esa factura.' }, { status: 404, headers: sinGuardar });
  }
  if (!hayBase()) {
    return Response.json({ error: 'Los pagos no están disponibles en este momento.' }, { status: 503, headers: sinGuardar });
  }

  try {
    // An overdue invoice must read vencida, so the database closes it first.
    await vencerCobros();
    let cobro = await cobroDe(id, lector);
    if (!cobro) {
      return Response.json({ error: 'No encontramos esa factura.' }, { status: 404, headers: sinGuardar });
    }
    // A pending BTCPay invoice is checked at BTCPay, the only authority on payment.
    if (cobro.estado === 'pendiente' && cobro.proveedor === 'btcpay') {
      cobro = (await confirmarEnBtcpay(cobro, lector)) ?? cobro;
    }
    const cuerpo: Record<string, unknown> = { ...vistaCobro(cobro, configBtcpay()) };
    if (cobro.estado === 'pagada') cuerpo.token = tokenDeAcceso(cobro.slug).token;
    if (cobro.estado === 'fallida') cuerpo.motivo = cobro.motivo;
    return Response.json(cuerpo, { headers: sinGuardar });
  } catch (error) {
    return respuestaError(error);
  }
}
