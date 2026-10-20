// BTCPay Server webhook. BTCPay calls it when an invoice changes; a valid signature only means "look again".
// The body is never proof of payment: the invoice is read again at BTCPay, and only Settled counts.
import type { APIContext } from 'astro';
import { bd, hayBase, leerError } from '../../../lib/servidor/bd';
import { ErrorBtcpay, firmaValida, leerAviso, leerFactura } from '../../../lib/servidor/btcpay';
import { respuestaError, sinGuardar } from '../../../lib/servidor/cobros';
import { configBtcpay, secretoWebhook, tiendaBtcpay } from '../../../lib/servidor/pagos-btcpay';

export const prerender = false;

const CABECERA_FIRMA = 'BTCPay-Sig';

export async function POST(context: APIContext) {
  // The signature covers the raw bytes, so read the text before anything parses it.
  const cuerpo = await context.request.text();
  if (!firmaValida(cuerpo, context.request.headers.get(CABECERA_FIRMA), secretoWebhook())) {
    return Response.json({ error: 'Firma inválida.' }, { status: 401, headers: sinGuardar });
  }

  const aviso = leerAviso(cuerpo);
  if (!aviso) {
    return Response.json({ error: 'Aviso inválido.' }, { status: 400, headers: sinGuardar });
  }
  // Another store (another product) or another kind of event: nothing to do, and BTCPay need not retry.
  const tienda = tiendaBtcpay();
  if (aviso.storeId !== tienda || aviso.tipo !== 'InvoiceSettled') {
    return Response.json({ ignorado: true }, { headers: sinGuardar });
  }

  const config = configBtcpay();
  if (!config || !hayBase()) {
    // Not ready to record anything: BTCPay retries later.
    return Response.json({ error: 'Los pagos no están disponibles en este momento.' }, { status: 503, headers: sinGuardar });
  }

  // The body only says which invoice to look at. BTCPay answers whether it is paid.
  try {
    const factura = await leerFactura(config, aviso.storeId, aviso.facturaId);
    if (factura.estado !== 'Settled') {
      return Response.json({ ignorado: true }, { headers: sinGuardar });
    }
  } catch (error) {
    if (error instanceof ErrorBtcpay && error.estado === 404) {
      // Not an invoice of this store: nothing to record.
      return Response.json({ ignorado: true }, { headers: sinGuardar });
    }
    // BTCPay could not be read: answer 502 so BTCPay sends the webhook again.
    console.error(error);
    return Response.json({ error: 'BTCPay no respondió.' }, { status: 502, headers: sinGuardar });
  }

  try {
    const { error } = await bd().rpc('media_confirmar_btcpay', { p_factura_id: aviso.facturaId });
    if (error) {
      // An invoice that is not a Cacao Media invoice is not an error: nothing to record.
      if (leerError(error).codigo === 'NO_ENCONTRADA') {
        return Response.json({ ignorado: true }, { headers: sinGuardar });
      }
      return respuestaError(error);
    }
  } catch (error) {
    return respuestaError(error);
  }
  return Response.json({ confirmada: true }, { headers: sinGuardar });
}
