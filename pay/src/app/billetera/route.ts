import { connection } from 'next/server';

import { MENSAJE_PAUSA, urlBtcpay } from '@/servidor/url-btcpay';

// A fixed address for the demo's test wallet, for QR codes on slides and printed material. The wallet lives on the
// BTCPay stack behind a tunnel whose address changes; this route reads the current one (url-btcpay.ts) and sends the
// visitor there. A ?factura= is passed along, so a link can open the wallet with an invoice already loaded.
export async function GET(peticion: Request): Promise<Response> {
  await connection();
  const base = await urlBtcpay();
  if (!base) {
    return new Response(
      `<!doctype html><html lang="es-SV"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Billetera de prueba</title><body style="font-family:system-ui,sans-serif;background:#f5ede3;color:#2a1912;padding:24px"><h1>Billetera de prueba</h1><p>${MENSAJE_PAUSA}</p></body></html>`,
      { status: 503, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
    );
  }
  const destino = new URL(`${base}/billetera`);
  const factura = new URL(peticion.url).searchParams.get('factura');
  if (factura && /^ln[a-z0-9]{10,2000}$/i.test(factura)) destino.searchParams.set('factura', factura);
  return new Response(null, { status: 307, headers: { location: destino.toString(), 'cache-control': 'no-store' } });
}
