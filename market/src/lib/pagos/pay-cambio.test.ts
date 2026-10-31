// The switch between BTCPay directly and CacaoPay for a business's charges (proveedorPara in ./index.ts).
import { beforeEach, describe, expect, it } from 'vitest';
import type { ConfigBtcpay } from './btcpay-api';
import { olvidarFalsos } from './falso';
import { proveedorPara } from './index';
import type { ConfigPay } from './pay-api';

beforeEach(() => {
  olvidarFalsos();
});

const TIENDA = 'Tienda1234567';
const FACTURA = 'Factura123456';
const PAY_ID = '6f1c2a1e-0b7d-4a55-9e0e-3c2d8f7a9b10';
const T0 = Date.parse('2026-10-30T12:00:00Z');
const NEGOCIO = { tipoProveedorPago: 'btcpay' as const, lightningAddress: null, btcpayTiendaId: TIENDA };
const ENTRADA = {
  sats: 3500,
  memo: 'CacaoMarket orden 42',
  expiraEnSeg: 600,
  metadatos: { orderId: 'orden-uuid', itemDesc: 'Orden 42 · Cafetal', usdCentavos: 350, cotizacionUsdBtc: 10000 },
  referencia: '42',
  clave: 'market-clave-de-prueba',
};

function json(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });
}

// One fake network for both servers: every call is recorded as "METHOD host/path".
function red(estadoPay = 'pendiente') {
  const llamadas: string[] = [];
  const f = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(entrada));
    const metodo = init?.method ?? 'GET';
    llamadas.push(`${metodo} ${url.host}${url.pathname}`);
    if (url.host === 'pay.ejemplo.com') {
      return json({
        id: PAY_ID,
        estado: estadoPay,
        factura: 'lnbcrt250n1pexample',
        sats: 3500,
        usd_centavos: 350,
        expira_en: new Date(T0 + 600_000).toISOString(),
        pago_tardio: false,
      }, metodo === 'POST' ? 201 : 200);
    }
    if (url.pathname.endsWith('/payment-methods')) {
      return json([{ paymentMethodId: 'BTC-LN', destination: 'lnbcrt250n1pexample', payments: [] }]);
    }
    const factura = {
      id: FACTURA,
      storeId: TIENDA,
      status: 'Settled',
      amount: '3500',
      expirationTime: Math.floor(T0 / 1000) + 900,
      metadata: {},
    };
    return json(factura, metodo === 'POST' ? 200 : 200);
  }) as unknown as typeof fetch;
  const btcpay: ConfigBtcpay = { url: 'https://btcpay.ejemplo.com', clave: 'clave-btc', fetch: f };
  const pay: ConfigPay = { url: 'https://pay.ejemplo.com', clave: 'cp_clave', avisoSecreto: null, avisoUrl: null, fetch: f };
  return { llamadas, btcpay, pay };
}

describe('proveedorPara with CacaoPay configured', () => {
  it('makes new charges through CacaoPay, and never asks BTCPay to make the invoice', async () => {
    const r = red();
    const cobro = await proveedorPara(NEGOCIO, { btcpay: r.btcpay, pay: r.pay }).crearCobro(ENTRADA);

    expect(cobro.referencia).toBe(`pay:${PAY_ID}`);
    expect(r.llamadas).toEqual(['POST pay.ejemplo.com/api/v1/cobros/']);
  });

  it('reads a CacaoPay charge through CacaoPay', async () => {
    const r = red('pagado');
    const estado = await proveedorPara(NEGOCIO, { btcpay: r.btcpay, pay: r.pay }).consultarCobro({
      referencia: `pay:${PAY_ID}`,
      verificarUrl: null,
      expiraEn: new Date(T0 + 600_000),
    });
    expect(estado).toBe('pagado');
    expect(r.llamadas).toEqual([`GET pay.ejemplo.com/api/v1/cobros/${PAY_ID}/`]);
  });

  it('reads an order in flight from before the switch through the direct BTCPay adapter', async () => {
    const r = red();
    const estado = await proveedorPara(NEGOCIO, { btcpay: r.btcpay, pay: r.pay }).consultarCobro({
      referencia: `${TIENDA}:${FACTURA}`,
      verificarUrl: null,
      expiraEn: new Date(T0 + 600_000),
    });
    expect(estado).toBe('pagado');
    expect(r.llamadas.some((l) => l.startsWith('GET btcpay.ejemplo.com/'))).toBe(true);
    expect(r.llamadas.some((l) => l.includes(' pay.ejemplo.com/'))).toBe(false);
  });
});

describe('proveedorPara without CacaoPay configured', () => {
  it('makes new charges directly at BTCPay, as before', async () => {
    const r = red();
    const cobro = await proveedorPara(NEGOCIO, { btcpay: r.btcpay, pay: null }).crearCobro(ENTRADA);

    expect(cobro.referencia).toBe(`${TIENDA}:${FACTURA}`);
    expect(r.llamadas[0]).toBe(`POST btcpay.ejemplo.com/api/v1/stores/${TIENDA}/invoices`);
    expect(r.llamadas.some((l) => l.includes(' pay.ejemplo.com/'))).toBe(false);
  });

  it('reads an order in flight from before the switch through BTCPay', async () => {
    const r = red();
    const estado = await proveedorPara(NEGOCIO, { btcpay: r.btcpay }).consultarCobro({
      referencia: `${TIENDA}:${FACTURA}`,
      verificarUrl: null,
      expiraEn: new Date(T0 + 600_000),
    });
    expect(estado).toBe('pagado');
  });

  it('answers pendiente for a CacaoPay charge it cannot read, without a call', async () => {
    const r = red();
    const estado = await proveedorPara(NEGOCIO, { btcpay: r.btcpay, pay: null }).consultarCobro({
      referencia: `pay:${PAY_ID}`,
      verificarUrl: null,
      expiraEn: new Date(T0 + 600_000),
    });
    expect(estado).toBe('pendiente');
    expect(r.llamadas).toHaveLength(0);
  });

  it('still needs the store of the business and the BTCPay configuration', () => {
    expect(() => proveedorPara({ ...NEGOCIO, btcpayTiendaId: null }, { btcpay: null, pay: null })).toThrow(/^NO_DISPONIBLE:/);
  });
});
