import 'server-only';

import { configDesdeEntorno, ErrorBtcpay, firmaValida, leerAviso, leerFactura } from '@/lib/pagos/btcpay-api';
import { confirmarPagoEnBD } from '@/servidor/pagos';
import { clienteServicio } from '@/servidor/supabase';

// BTCPay calls this for each store event. The signature only proves that BTCPay sent the body, and even
// a signed body is treated as "look again": the invoice is read back from BTCPay before anything is paid.
// A bad signature answers 401. BTCPay should retry a 5xx (and a 502 when BTCPay could not be read); every
// other answer is final, so the notice is not sent again. This route is a POST, so it is never cached.

// Outcomes the database already reached: a repeated notice, or a payment that came after the deadline.
const YA_RESUELTO = /^(ESTADO_INVALIDO|FUERA_DE_PLAZO)/;

export async function POST(peticion: Request): Promise<Response> {
  // The raw text is what was signed; parsing it first would change the bytes.
  const cuerpo = await peticion.text();
  const secreto = process.env.BTCPAY_WEBHOOK_SECRET ?? '';
  if (!firmaValida(cuerpo, peticion.headers.get('btcpay-sig'), secreto)) {
    return new Response(null, { status: 401 });
  }

  const aviso = leerAviso(cuerpo);
  if (aviso === null) return new Response(null, { status: 400 });
  // Only a settled invoice matters. Other events (new, expired, invalid, late) need no action here.
  if (aviso.tipo !== 'InvoiceSettled') return new Response(null, { status: 200 });

  const config = configDesdeEntorno(process.env);
  if (config === null) {
    console.error('btcpay webhook: falta BTCPAY_URL o BTCPAY_API_KEY');
    return new Response(null, { status: 503 });
  }

  let cobro: { orden_id: string } | null;
  try {
    const { data, error } = await clienteServicio()
      .from('cobros')
      .select('orden_id')
      .eq('proveedor', 'btcpay')
      .eq('referencia_externa', `${aviso.storeId}:${aviso.facturaId}`)
      .maybeSingle();
    if (error) throw error;
    cobro = data;
  } catch (error) {
    console.error('btcpay webhook: no se pudo leer el cobro:', error instanceof Error ? error.message : error);
    return new Response(null, { status: 500 });
  }
  // Not one of ours (another store, or a request that is gone): nothing to do.
  if (cobro === null) return new Response(null, { status: 200 });

  let factura;
  try {
    factura = await leerFactura(config, aviso.storeId, aviso.facturaId);
  } catch (error) {
    if (error instanceof ErrorBtcpay && error.estado === 404) return new Response(null, { status: 200 });
    console.error('btcpay webhook: BTCPay no respondió al leer la factura');
    return new Response(null, { status: 502 });
  }
  if (factura.estado !== 'Settled') return new Response(null, { status: 200 });

  // Same confirmation as the payment screen's poll: one function, one funnel event.
  const error = await confirmarPagoEnBD(cobro.orden_id, null, null);
  if (error && !YA_RESUELTO.test(error.message)) {
    console.error('btcpay webhook: confirmar_pago:', error.message);
    return new Response(null, { status: 500 });
  }
  if (error) console.warn('btcpay webhook:', error.message);
  return new Response(null, { status: 200 });
}
