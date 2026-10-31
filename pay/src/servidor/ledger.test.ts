import { describe, expect, it } from 'vitest';

import { configLedger, cuerpoVentaLedger, enviarVentaLedger, type VentaLedger } from './ledger';

const VENTA: VentaLedger = {
  cobroId: '11111111-2222-4333-8444-555555555555',
  negocioId: '6f1c2a3e-1b2c-4d5e-8f90-123456789abc',
  descripcion: 'Café de altura',
  usdCentavos: 452,
  sats: 4000,
  tasa: '100000.00',
  facturaId: 'INV123ABC',
  hash: 'a'.repeat(64),
};
const CLAVE = 'cl_0123456789abcdefghijklmnopqrstuv';
const AVISO = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

describe('configLedger', () => {
  it('reads the address and the key, and is null when either is missing', () => {
    expect(configLedger({ LEDGER_API_URL: 'https://cuentas.example/', LEDGER_API_KEY: CLAVE })).toEqual({
      url: 'https://cuentas.example',
      clave: CLAVE,
    });
    expect(configLedger({ LEDGER_API_URL: 'https://cuentas.example' })).toBeNull();
    expect(configLedger({ LEDGER_API_KEY: CLAVE })).toBeNull();
  });
});

describe('cuerpoVentaLedger', () => {
  it('sends a business sale with its invoice, its hash and a unique reference', () => {
    const cuerpo = JSON.parse(cuerpoVentaLedger(VENTA));
    expect(cuerpo).toEqual({
      referencia: `pay-${VENTA.cobroId}`,
      producto: 'negocios',
      negocio_id: VENTA.negocioId,
      descripcion: 'Café de altura',
      monto_usd_centavos: 452,
      medio: 'lightning',
      pago: { sats: 4000, tasa: '100000.00', factura_id: 'INV123ABC', hash: 'a'.repeat(64) },
    });
  });
});

describe('enviarVentaLedger', () => {
  const config = { url: 'https://cuentas.example', clave: CLAVE };

  it('posts with the key and the notice id as Idempotency-Key, and resolves on 201', async () => {
    let pedido: { url: string; init: RequestInit } | null = null;
    const falso = (async (url: string, init: RequestInit) => {
      pedido = { url, init };
      return new Response('{}', { status: 201 });
    }) as typeof fetch;
    await enviarVentaLedger(config, AVISO, VENTA, { fetch: falso });
    expect(pedido).not.toBeNull();
    const enviado = pedido as unknown as { url: string; init: RequestInit };
    expect(enviado.url).toBe('https://cuentas.example/api/v1/ventas');
    const cabeceras = enviado.init.headers as Record<string, string>;
    expect(cabeceras.authorization).toBe(`Bearer ${CLAVE}`);
    expect(cabeceras['idempotency-key']).toBe(AVISO);
  });

  it('throws with the status only when Ledger does not answer 2xx, and never with the key', async () => {
    const falso = (async () => new Response('{"error":"x"}', { status: 503 })) as typeof fetch;
    const error = await enviarVentaLedger(config, AVISO, VENTA, { fetch: falso }).then(
      () => null,
      (e: Error) => e,
    );
    expect(error?.message).toBe('CacaoLedger respondió 503.');
    expect(error?.message).not.toContain(CLAVE);
  });

  it('throws when the connection fails', async () => {
    const falso = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    await expect(enviarVentaLedger(config, AVISO, VENTA, { fetch: falso })).rejects.toThrow('CacaoLedger no respondió.');
  });
});
