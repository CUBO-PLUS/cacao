// Unit tests for the BTCPay client: webhook signature, webhook body, invoice calls with a fake fetch.
// Run with `npm run test:unit`. Playwright (`npm test`) covers the pages.
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  configDesdeEntorno,
  crearFactura,
  enlaceBilleteraDePrueba,
  ErrorBtcpay,
  firmaValida,
  leerAviso,
  leerFactura,
  type ConfigBtcpay,
} from '../../src/lib/servidor/btcpay.ts';

const SECRETO = 'secreto-de-prueba-webhook';
const CUERPO = JSON.stringify({ type: 'InvoiceSettled', invoiceId: 'Inv0000000001', storeId: 'Tienda00000001' });
const firma = (cuerpo: string, secreto = SECRETO) => 'sha256=' + createHmac('sha256', secreto).update(cuerpo).digest('hex');

test('firmaValida accepts the signature of the raw body', () => {
  assert.equal(firmaValida(CUERPO, firma(CUERPO), SECRETO), true);
});

test('firmaValida refuses a missing header, a wrong secret, a changed body and an empty secret', () => {
  assert.equal(firmaValida(CUERPO, null, SECRETO), false);
  assert.equal(firmaValida(CUERPO, firma(CUERPO, 'otro'), SECRETO), false);
  assert.equal(firmaValida(CUERPO + ' ', firma(CUERPO), SECRETO), false);
  assert.equal(firmaValida(CUERPO, firma(CUERPO), ''), false);
  assert.equal(firmaValida(CUERPO, 'sha256=00', SECRETO), false);
});

test('leerAviso reads the ids and refuses malformed bodies', () => {
  assert.deepEqual(leerAviso(CUERPO), {
    tipo: 'InvoiceSettled',
    facturaId: 'Inv0000000001',
    storeId: 'Tienda00000001',
  });
  assert.equal(leerAviso('no es json'), null);
  assert.equal(leerAviso(JSON.stringify({ type: 'InvoiceSettled', invoiceId: 'x', storeId: 'Tienda00000001' })), null);
});

test('configDesdeEntorno needs a URL without a trailing slash and an API key', () => {
  assert.deepEqual(configDesdeEntorno({ BTCPAY_URL: 'https://btcpay.example///', BTCPAY_API_KEY: 'k' }), {
    url: 'https://btcpay.example',
    clave: 'k',
  });
  assert.equal(configDesdeEntorno({ BTCPAY_URL: 'https://btcpay.example' }), null);
  assert.equal(configDesdeEntorno({ BTCPAY_URL: 'btcpay.example', BTCPAY_API_KEY: 'k' }), null);
});

test('enlaceBilleteraDePrueba only links regtest invoices', () => {
  const config: ConfigBtcpay = { url: 'https://btcpay.example', clave: 'k' };
  assert.equal(
    enlaceBilleteraDePrueba(config, 'lnbcrt1500n1pabc'),
    'https://btcpay.example/billetera?factura=lnbcrt1500n1pabc',
  );
  assert.equal(enlaceBilleteraDePrueba(config, 'lnbc1500n1pabc'), null);
});

/** A fake BTCPay: records each call and answers with the given invoice state. */
function fakeBtcpay(estado: string, status = 200) {
  const llamadas: { metodo: string; url: string; cuerpo: unknown; auth: string | null }[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const ruta = String(url);
    llamadas.push({
      metodo: init?.method ?? 'GET',
      url: ruta,
      cuerpo: init?.body ? JSON.parse(String(init.body)) : undefined,
      auth: (init?.headers as Record<string, string>)?.authorization ?? null,
    });
    if (status !== 200) return new Response('{}', { status });
    if (ruta.endsWith('/payment-methods')) {
      return Response.json([{ paymentMethodId: 'BTC-LN', destination: 'lnbcrt1500n1pabc', payments: [] }]);
    }
    return Response.json({
      id: 'Inv0000000001',
      storeId: 'Tienda00000001',
      status: estado,
      amount: '120',
      expirationTime: 1_900_000_000,
      metadata: { producto: 'media', orderId: 'historia:lector' },
    });
  }) as typeof fetch;
  return { f, llamadas };
}

test('crearFactura sends the amount, the Lightning-only checkout and the metadata', async () => {
  const { f, llamadas } = fakeBtcpay('New');
  const config: ConfigBtcpay = { url: 'https://btcpay.example', clave: 'clave-prueba', fetch: f };
  const factura = await crearFactura(config, {
    storeId: 'Tienda00000001',
    sats: 120,
    minutos: 5,
    metadata: { producto: 'media', orderId: 'historia:lector', itemDesc: 'Historia: X', usdCentavos: 9, cotizacionUsdBtc: 100000 },
  });
  assert.equal(factura.bolt11, 'lnbcrt1500n1pabc');
  assert.equal(factura.sats, 120);
  assert.equal(factura.estado, 'New');
  const envio = llamadas[0];
  assert.equal(envio.metodo, 'POST');
  assert.equal(envio.url, 'https://btcpay.example/api/v1/stores/Tienda00000001/invoices');
  assert.equal(envio.auth, 'token clave-prueba');
  assert.deepEqual(envio.cuerpo, {
    amount: '120',
    currency: 'SATS',
    metadata: { producto: 'media', orderId: 'historia:lector', itemDesc: 'Historia: X', usdCentavos: 9, cotizacionUsdBtc: 100000 },
    checkout: { expirationMinutes: 5, paymentMethods: ['BTC-LN'], defaultPaymentMethod: 'BTC-LN', speedPolicy: 'HighSpeed' },
  });
});

test('leerFactura reports Settled only when BTCPay says so', async () => {
  const pagada = fakeBtcpay('Settled');
  const factura = await leerFactura(
    { url: 'https://btcpay.example', clave: 'k', fetch: pagada.f },
    'Tienda00000001',
    'Inv0000000001',
  );
  assert.equal(factura.estado, 'Settled');
  assert.equal(pagada.llamadas[0].url, 'https://btcpay.example/api/v1/stores/Tienda00000001/invoices/Inv0000000001');

  const sinPagar = fakeBtcpay('New');
  assert.equal(
    (await leerFactura({ url: 'https://btcpay.example', clave: 'k', fetch: sinPagar.f }, 'Tienda00000001', 'Inv0000000001')).estado,
    'New',
  );
});

test('leerFactura turns a BTCPay refusal into ErrorBtcpay with its status', async () => {
  const caida = fakeBtcpay('New', 404);
  await assert.rejects(
    leerFactura({ url: 'https://btcpay.example', clave: 'k', fetch: caida.f }, 'Tienda00000001', 'Inv0000000001'),
    (error: unknown) => error instanceof ErrorBtcpay && error.estado === 404,
  );
});

test('a network failure is an ErrorBtcpay with status 0', async () => {
  const roto = (async () => {
    throw new TypeError('fetch failed');
  }) as typeof fetch;
  await assert.rejects(
    leerFactura({ url: 'https://btcpay.example', clave: 'k', fetch: roto }, 'Tienda00000001', 'Inv0000000001'),
    (error: unknown) => error instanceof ErrorBtcpay && error.estado === 0,
  );
});
