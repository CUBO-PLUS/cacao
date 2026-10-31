import { firmaValida, leerAviso } from '@/servidor/btcpay';
import { aplicarAvisoBtcpay } from '@/servidor/api-cobros';

// BTCPay calls this when an invoice of a payments-API store changes. The signature (BTCPay-Sig) must match the raw
// body. The body is then only a hint: the invoice is read again from BTCPay, and that state is what counts.
export async function POST(peticion: Request): Promise<Response> {
  const cuerpo = await peticion.text();
  const secreto = (process.env.PAY_BTCPAY_WEBHOOK_SECRET ?? '').trim();
  if (!firmaValida(cuerpo, peticion.headers.get('btcpay-sig'), secreto)) {
    return new Response('Firma inválida.', { status: 401 });
  }
  const aviso = leerAviso(cuerpo);
  if (!aviso) return new Response('Aviso inválido.', { status: 400 });

  try {
    const resultado = await aplicarAvisoBtcpay(aviso.facturaId, aviso.storeId);
    if (resultado === 'reintentar') return new Response('BTCPay no respondió.', { status: 502 });
    return new Response(null, { status: 200 });
  } catch (error) {
    console.error('Aviso de BTCPay:', error instanceof Error ? error.message : error);
    return new Response('No pudimos aplicar el aviso.', { status: 500 });
  }
}
