import { describe, expect, it } from 'vitest';
import { firmaValida, leerAviso, type ConfigBtcpay } from './btcpay-api';
import { crearProveedorBtcpay } from './btcpay';

const STORE = 'Tienda1234567';
const FACTURA = 'Factura123456';
const T0 = Date.parse('2026-10-20T12:00:00Z');

type Llamada = { url: string; metodo: string; cuerpo: unknown };

// A fake BTCPay: `ruta` answers each request, and every call is recorded.
function fakeBtcpay(ruta: (url: URL, metodo: string) => Response | Promise<Response>) {
  const llamadas: Llamada[] = [];
  const fetchFalso = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = String(entrada);
    const cuerpo = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    llamadas.push({ url, metodo: init?.method ?? 'GET', cuerpo });
    return ruta(new URL(url), init?.method ?? 'GET');
  }) as unknown as typeof fetch;
  const config: ConfigBtcpay = { url: 'https://btcpay.ejemplo.com', clave: 'clave-de-prueba', fetch: fetchFalso };
  return { config, llamadas };
}

function json(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });
}

function factura(estado: string, extra: Record<string, unknown> = {}) {
  return {
    id: FACTURA,
    storeId: STORE,
    status: estado,
    amount: '3500',
    expirationTime: Math.floor(T0 / 1000) + 900,
    metadata: { producto: 'market', orderId: 'orden-1' },
    ...extra,
  };
}

// The invoice read answers the invoice itself, then its payment methods (BTC-LN with a bolt11).
function rutaFactura(estado: string, metodos: unknown[] = [{ paymentMethodId: 'BTC-LN', destination: 'lnbc35u1pexample', payments: [] }]) {
  return (url: URL) => {
    if (url.pathname.endsWith('/payment-methods')) return json(metodos);
    return json(factura(estado));
  };
}

describe('crearProveedorBtcpay: crearCobro', () => {
  it('creates a Lightning invoice in the store and returns the referencia with the store and invoice ids', async () => {
    const red = fakeBtcpay((url, metodo) => {
      if (metodo === 'POST') return json(factura('New'));
      return json([{ paymentMethodId: 'BTC-LN', destination: 'lnbc35u1pexample', payments: [] }]);
    });
    const proveedor = crearProveedorBtcpay(red.config, STORE);

    const cobro = await proveedor.crearCobro({
      sats: 3500,
      memo: 'Orden 42',
      expiraEnSeg: 600,
      metadatos: { orderId: 'orden-42', itemDesc: 'Orden 42 · Tienda', usdCentavos: 350, cotizacionUsdBtc: 100000 },
    });

    expect(cobro.referencia).toBe(`${STORE}:${FACTURA}`);
    expect(cobro.bolt11).toBe('lnbc35u1pexample');
    expect(cobro.destino).toBeNull();
    expect(cobro.verificarUrl).toBeNull();
    expect(cobro.expiraEn).toEqual(new Date(factura('New').expirationTime * 1000));

    const creacion = red.llamadas.find((l) => l.metodo === 'POST');
    expect(creacion?.url).toBe(`https://btcpay.ejemplo.com/api/v1/stores/${STORE}/invoices`);
    expect(creacion?.cuerpo).toMatchObject({
      amount: '3500',
      currency: 'SATS',
      checkout: { expirationMinutes: 10, paymentMethods: ['BTC-LN'], defaultPaymentMethod: 'BTC-LN' },
      metadata: {
        producto: 'market',
        orderId: 'orden-42',
        itemDesc: 'Orden 42 · Tienda',
        usdCentavos: 350,
        cotizacionUsdBtc: 100000,
      },
    });
  });

  it('rounds the minutes up and falls back to the memo when no metadata is given', async () => {
    const red = fakeBtcpay((url, metodo) => (metodo === 'POST' ? json(factura('New')) : json([])));
    const proveedor = crearProveedorBtcpay(red.config, STORE);

    await proveedor.crearCobro({ sats: 500, memo: 'CacaoMarket orden 7', expiraEnSeg: 601 });

    const creacion = red.llamadas.find((l) => l.metodo === 'POST');
    expect(creacion?.cuerpo).toMatchObject({
      checkout: { expirationMinutes: 11 },
      metadata: { producto: 'market', orderId: 'CacaoMarket orden 7', itemDesc: 'CacaoMarket orden 7', usdCentavos: 0 },
    });
  });
});

describe('crearProveedorBtcpay: consultarCobro', () => {
  const cobro = { referencia: `${STORE}:${FACTURA}`, verificarUrl: null, expiraEn: new Date(T0 + 600_000) };

  it.each([
    ['Settled', 'pagado'],
    ['Expired', 'expirado'],
    ['Invalid', 'expirado'],
    ['New', 'pendiente'],
    ['Processing', 'pendiente'],
  ] as const)('maps BTCPay %s to %s', async (estado, esperado) => {
    const red = fakeBtcpay(rutaFactura(estado));
    const proveedor = crearProveedorBtcpay(red.config, STORE);
    expect(await proveedor.consultarCobro(cobro)).toBe(esperado);
  });

  it('reads the invoice from its own store', async () => {
    const red = fakeBtcpay(rutaFactura('Settled'));
    await crearProveedorBtcpay(red.config, STORE).consultarCobro(cobro);
    expect(red.llamadas[0].url).toBe(`https://btcpay.ejemplo.com/api/v1/stores/${STORE}/invoices/${FACTURA}`);
  });

  it('counts a BTCPay error as not paid yet', async () => {
    const red = fakeBtcpay(() => json({ error: 'caído' }, 500));
    expect(await crearProveedorBtcpay(red.config, STORE).consultarCobro(cobro)).toBe('pendiente');
  });

  it('counts an unknown invoice as not paid yet', async () => {
    const red = fakeBtcpay(() => json({ error: 'no existe' }, 404));
    expect(await crearProveedorBtcpay(red.config, STORE).consultarCobro(cobro)).toBe('pendiente');
  });

  it('answers pendiente without a referencia, and never calls BTCPay', async () => {
    const red = fakeBtcpay(rutaFactura('Settled'));
    const proveedor = crearProveedorBtcpay(red.config, STORE);
    expect(await proveedor.consultarCobro({ ...cobro, referencia: null })).toBe('pendiente');
    expect(await proveedor.consultarCobro({ ...cobro, referencia: 'sin-separador' })).toBe('pendiente');
    expect(red.llamadas).toHaveLength(0);
  });
});

describe('firmaValida', () => {
  // HMAC-SHA256 of this exact body with the secret "secreto-de-prueba", computed once with Node's crypto.
  const CUERPO = '{"type":"InvoiceSettled","invoiceId":"AbCdEfGh1234","storeId":"Tienda1234567"}';
  const HMAC = 'c0e9100ab593262e0d2d83f8db149f5441f12d563f7eb17d17d3ce97a89b7809';

  it('accepts the sha256 HMAC of the raw body with the secret', () => {
    expect(firmaValida(CUERPO, `sha256=${HMAC}`, 'secreto-de-prueba')).toBe(true);
  });

  it('rejects a body changed after signing', () => {
    expect(firmaValida(CUERPO + ' ', `sha256=${HMAC}`, 'secreto-de-prueba')).toBe(false);
  });

  it('rejects a wrong secret, a missing header, a missing secret and a header without the prefix', () => {
    expect(firmaValida(CUERPO, `sha256=${HMAC}`, 'otro-secreto')).toBe(false);
    expect(firmaValida(CUERPO, null, 'secreto-de-prueba')).toBe(false);
    expect(firmaValida(CUERPO, `sha256=${HMAC}`, '')).toBe(false);
    expect(firmaValida(CUERPO, HMAC, 'secreto-de-prueba')).toBe(false);
  });
});

describe('leerAviso', () => {
  it('reads the type, invoice and store of a valid body', () => {
    expect(leerAviso('{"type":"InvoiceSettled","invoiceId":"AbCdEfGh1234","storeId":"Tienda1234567"}')).toEqual({
      tipo: 'InvoiceSettled',
      facturaId: 'AbCdEfGh1234',
      storeId: 'Tienda1234567',
    });
  });

  it('returns null for a body that is not JSON or lacks the fields', () => {
    expect(leerAviso('no es json')).toBeNull();
    expect(leerAviso('{"type":"InvoiceSettled"}')).toBeNull();
    expect(leerAviso('{"type":"InvoiceSettled","invoiceId":"corto","storeId":"Tienda1234567"}')).toBeNull();
  });
});
