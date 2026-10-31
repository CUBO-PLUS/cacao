import { describe, expect, it } from 'vitest';
import { crearProveedorPay } from './pay';
import { ErrorPay, type ConfigPay } from './pay-api';

const PAY_ID = '6f1c2a1e-0b7d-4a55-9e0e-3c2d8f7a9b10';
const TIENDA = 'Tienda1234567';
const T0 = Date.parse('2026-10-30T12:00:00Z');

type Llamada = { url: string; metodo: string; cabeceras: Record<string, string>; cuerpo: unknown };

function fakePay(ruta: (url: URL, metodo: string) => Response | Promise<Response>) {
  const llamadas: Llamada[] = [];
  const fetchFalso = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const cabeceras = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    llamadas.push({
      url: String(entrada),
      metodo: init?.method ?? 'GET',
      cabeceras,
      cuerpo: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    return ruta(new URL(String(entrada)), init?.method ?? 'GET');
  }) as unknown as typeof fetch;
  const config: ConfigPay = {
    url: 'https://pay.ejemplo.com',
    clave: 'cp_clave-de-prueba',
    avisoSecreto: null,
    avisoUrl: null,
    fetch: fetchFalso,
  };
  return { config, llamadas };
}

function json(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });
}

function cobro(extra: Record<string, unknown> = {}) {
  return {
    id: PAY_ID,
    estado: 'pendiente',
    factura: 'lnbcrt250n1pexample',
    sats: 3500,
    usd_centavos: 350,
    expira_en: new Date(T0 + 600_000).toISOString(),
    pago_tardio: false,
    ...extra,
  };
}

const ENTRADA = {
  sats: 3500,
  memo: 'CacaoMarket orden 42',
  expiraEnSeg: 600,
  metadatos: { orderId: 'orden-uuid', itemDesc: 'Orden 42 · Cafetal', usdCentavos: 350, cotizacionUsdBtc: 10000 },
  referencia: '42',
  clave: 'market-clave-de-prueba',
};

describe('crearProveedorPay: crearCobro', () => {
  it('makes the charge with the order number as referencia and the order line as descripcion', async () => {
    const red = fakePay(() => json(cobro(), 201));
    const cobroCreado = await crearProveedorPay(red.config, TIENDA).crearCobro(ENTRADA);

    expect(cobroCreado).toEqual({
      referencia: `pay:${PAY_ID}`,
      bolt11: 'lnbcrt250n1pexample',
      destino: null,
      verificarUrl: null,
      expiraEn: new Date(T0 + 600_000),
    });
    expect(red.llamadas[0].cabeceras['idempotency-key']).toBe('market-clave-de-prueba');
    expect(red.llamadas[0].cuerpo).toMatchObject({
      monto: 3500,
      moneda: 'SATS',
      descripcion: 'Orden 42 · Cafetal',
      referencia: '42',
      vence_en_segundos: 600,
      tienda: TIENDA,
    });
  });

  it('falls back to the order id, then the memo, when no referencia is given', async () => {
    const red = fakePay(() => json(cobro(), 201));
    const proveedor = crearProveedorPay(red.config, TIENDA);
    await proveedor.crearCobro({ ...ENTRADA, referencia: undefined });
    expect(red.llamadas[0].cuerpo).toMatchObject({ referencia: 'orden-uuid' });
    await proveedor.crearCobro({ ...ENTRADA, referencia: undefined, metadatos: undefined });
    expect(red.llamadas[1].cuerpo).toMatchObject({ referencia: 'CacaoMarket orden 42', descripcion: 'CacaoMarket orden 42' });
  });

  it('refuses to charge without the idempotency key of the attempt', async () => {
    const red = fakePay(() => json(cobro(), 201));
    await expect(crearProveedorPay(red.config, TIENDA).crearCobro({ ...ENTRADA, clave: undefined })).rejects.toThrow(
      /idempotencia/,
    );
    expect(red.llamadas).toHaveLength(0);
  });

  it('refuses an answer for another amount of sats', async () => {
    const red = fakePay(() => json(cobro({ sats: 3499 }), 201));
    await expect(crearProveedorPay(red.config, TIENDA).crearCobro(ENTRADA)).rejects.toMatchObject({ estado: 502, codigo: 'MONTO' });
  });

  it('refuses a charge that is not pending', async () => {
    const red = fakePay(() => json(cobro({ estado: 'pagado' }), 200));
    await expect(crearProveedorPay(red.config, TIENDA).crearCobro(ENTRADA)).rejects.toMatchObject({ codigo: 'ESTADO' });
  });

  it('names the store and the fix when CacaoPay does not allow it', async () => {
    const red = fakePay(() => json({ error: { codigo: 'NO_PERMITIDO', mensaje: 'no' } }, 403));
    let error: ErrorPay | null = null;
    try {
      await crearProveedorPay(red.config, TIENDA).crearCobro(ENTRADA);
    } catch (e) {
      error = e as ErrorPay;
    }
    expect(error).toBeInstanceOf(ErrorPay);
    expect(error?.estado).toBe(403);
    expect(error?.codigo).toBe("NO_PERMITIDO");
    expect(error?.message).toContain(TIENDA);
    expect(error?.message).toContain("tiendas-btcpay.mjs");
  });
});

describe('crearProveedorPay: consultarCobro', () => {
  const cobroLocal = { referencia: `pay:${PAY_ID}`, verificarUrl: null, expiraEn: new Date(T0 + 600_000) };

  it.each([
    ['pagado', 'pagado'],
    ['vencido', 'expirado'],
    ['cancelado', 'expirado'],
    ['pendiente', 'pendiente'],
  ] as const)('maps CacaoPay %s to %s', async (estado, esperado) => {
    const red = fakePay(() => json(cobro({ estado })));
    expect(await crearProveedorPay(red.config, TIENDA).consultarCobro(cobroLocal)).toBe(esperado);
    expect(red.llamadas[0].url).toBe(`https://pay.ejemplo.com/api/v1/cobros/${PAY_ID}/`);
  });

  it('counts a CacaoPay error as not paid yet', async () => {
    const red = fakePay(() => json({ error: { codigo: 'ERROR' } }, 500));
    expect(await crearProveedorPay(red.config, TIENDA).consultarCobro(cobroLocal)).toBe('pendiente');
  });

  it('answers pendiente for a BTCPay referencia, and never calls CacaoPay for it', async () => {
    const red = fakePay(() => json(cobro({ estado: 'pagado' })));
    const proveedor = crearProveedorPay(red.config, TIENDA);
    expect(await proveedor.consultarCobro({ ...cobroLocal, referencia: 'Tienda1234567:Factura123456' })).toBe('pendiente');
    expect(await proveedor.consultarCobro({ ...cobroLocal, referencia: null })).toBe('pendiente');
    expect(red.llamadas).toHaveLength(0);
  });
});
