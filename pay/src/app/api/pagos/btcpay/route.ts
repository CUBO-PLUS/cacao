import { ErrorBtcpay, configDesdeEntorno, firmaValida, leerAviso, leerFactura } from '@/servidor/btcpay';
import { confirmarPagoBtcpay } from '@/servidor/transferencias';

// BTCPay calls this when an invoice changes. The body is only a hint to look again: the invoice is
// read back from BTCPay, and only one it says is Settled moves a transfer on.
export async function POST(peticion: Request): Promise<Response> {
  const cuerpo = await peticion.text();
  const secreto = (process.env.BTCPAY_WEBHOOK_SECRET ?? '').trim();
  if (!firmaValida(cuerpo, peticion.headers.get('btcpay-sig'), secreto)) {
    return new Response('Firma inválida.', { status: 401 });
  }

  const aviso = leerAviso(cuerpo);
  if (!aviso) return new Response('Aviso inválido.', { status: 400 });

  const config = configDesdeEntorno(process.env);
  const tienda = (process.env.BTCPAY_STORE_ID ?? '').trim();
  if (!config || !tienda) return new Response('BTCPay no está configurado.', { status: 503 });

  // Another store, or another kind of event: nothing for Cacao Pay to do.
  if (aviso.storeId !== tienda || aviso.tipo !== 'InvoiceSettled') return new Response(null, { status: 200 });

  let factura;
  try {
    factura = await leerFactura(config, aviso.storeId, aviso.facturaId);
  } catch (error) {
    // An invoice BTCPay does not know is nothing to act on; a BTCPay that cannot answer is retried.
    if (error instanceof ErrorBtcpay && error.estado === 404) return new Response(null, { status: 200 });
    console.error('BTCPay al leer la factura del aviso:', error instanceof Error ? error.message : error);
    return new Response('BTCPay no respondió.', { status: 502 });
  }
  if (factura.estado !== 'Settled') return new Response(null, { status: 200 });

  const cambio = await confirmarPagoBtcpay(factura.id);
  if (cambio.ok) return new Response(null, { status: 200 });
  // Not a transfer of ours, or a transfer that can no longer move: repeating the webhook would not help.
  if (cambio.codigo === 'NO_ENCONTRADA' || cambio.codigo === 'ESTADO_INVALIDO') {
    console.error('Factura pagada sin envío que la espere:', cambio.codigo, factura.id);
    return new Response(null, { status: 200 });
  }
  return new Response('No pudimos confirmar el pago.', { status: 500 });
}
