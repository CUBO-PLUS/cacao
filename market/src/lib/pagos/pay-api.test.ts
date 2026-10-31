import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AvisosVistos,
  avisoPayValido,
  claveIdempotenciaMarket,
  configDesdeEntornoPay,
  crearCobroPay,
  ErrorPay,
  esReferenciaPay,
  leerAvisoPay,
  leerCobroPay,
  payEnPausa,
  payIdDeReferencia,
  procesarAvisoPay,
  referenciaDePay,
  type ConfigPay,
} from './pay-api';

const SECRETO = 'secreto-de-avisos-de-prueba';
const PAY_ID = '6f1c2a1e-0b7d-4a55-9e0e-3c2d8f7a9b10';
const ORDEN = '0b7d4a55-1111-4a55-9e0e-3c2d8f7a9b10';
const AHORA = Date.parse('2026-10-30T12:00:00Z');

type Llamada = { url: string; metodo: string; cabeceras: Record<string, string>; cuerpo: unknown };

// A fake CacaoPay: `ruta` answers each request, and every call is recorded.
function fakePay(ruta: (url: URL, metodo: string) => Response | Promise<Response>, extra: Partial<ConfigPay> = {}) {
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
    avisoSecreto: SECRETO,
    avisoUrl: 'https://market.ejemplo.com/api/pagos/pay',
    fetch: fetchFalso,
    ...extra,
  };
  return { config, llamadas };
}

function json(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });
}

function cobro(estado = 'pendiente', extra: Record<string, unknown> = {}) {
  return {
    id: PAY_ID,
    estado,
    factura: 'lnbcrt250n1pexample',
    sats: 25000,
    usd_centavos: 2500,
    expira_en: new Date(AHORA + 600_000).toISOString(),
    pago_tardio: false,
    ...extra,
  };
}

// The Cacao-Firma header of a body, signed the way CacaoPay does: HMAC of "<t>.<body>".
function firma(cuerpo: string, t: number = Math.floor(AHORA / 1000), secreto: string = SECRETO): string {
  const v1 = createHmac('sha256', secreto).update(`${t}.${cuerpo}`, 'utf8').digest('hex');
  return `t=${t},v1=${v1}`;
}

const AVISO = JSON.stringify({ aviso: '0b7d4a55-aaaa-4a55-9e0e-3c2d8f7a9b10', tipo: 'cobro.estado', id: PAY_ID, estado: 'pagado' });

describe('configDesdeEntornoPay', () => {
  it('is null unless both the address and the key are set, so charges stay on BTCPay', () => {
    expect(configDesdeEntornoPay({})).toBeNull();
    expect(configDesdeEntornoPay({ CACAO_PAY_URL: 'http://127.0.0.1:4324' })).toBeNull();
    expect(configDesdeEntornoPay({ CACAO_PAY_API_KEY: 'cp_x' })).toBeNull();
    expect(configDesdeEntornoPay({ CACAO_PAY_URL: 'no-es-url', CACAO_PAY_API_KEY: 'cp_x' })).toBeNull();
  });

  it('reads the address without a trailing slash and the optional notice settings', () => {
    expect(
      configDesdeEntornoPay({
        CACAO_PAY_URL: 'http://127.0.0.1:4324/',
        CACAO_PAY_API_KEY: ' cp_clave ',
        CACAO_PAY_AVISO_SECRET: SECRETO,
        CACAO_PAY_AVISO_URL: 'https://market.ejemplo.com/api/pagos/pay',
      }),
    ).toEqual({
      url: 'http://127.0.0.1:4324',
      clave: 'cp_clave',
      avisoSecreto: SECRETO,
      avisoUrl: 'https://market.ejemplo.com/api/pagos/pay',
    });
    expect(configDesdeEntornoPay({ CACAO_PAY_URL: 'http://127.0.0.1:4324', CACAO_PAY_API_KEY: 'cp_x' })).toEqual({
      url: 'http://127.0.0.1:4324',
      clave: 'cp_x',
      avisoSecreto: null,
      avisoUrl: null,
    });
  });
});

describe('claveIdempotenciaMarket', () => {
  it('is stable for one order and attempt, and short enough for CacaoPay', () => {
    const clave = claveIdempotenciaMarket(ORDEN, null);
    expect(claveIdempotenciaMarket(ORDEN, null)).toBe(clave);
    expect(clave).toMatch(/^market-[0-9a-f]{64}$/);
    expect(clave.length).toBeGreaterThanOrEqual(8);
    expect(clave.length).toBeLessThanOrEqual(128);
  });

  it('changes for another order, and for a new attempt after an expired one', () => {
    const primera = claveIdempotenciaMarket(ORDEN, null);
    expect(claveIdempotenciaMarket('otra-orden', null)).not.toBe(primera);
    const segunda = claveIdempotenciaMarket(ORDEN, PAY_ID);
    expect(segunda).not.toBe(primera);
    expect(claveIdempotenciaMarket(ORDEN, '11111111-2222-3333-4444-555555555555')).not.toBe(segunda);
  });
});

describe('referencias', () => {
  it('tells a CacaoPay referencia from a BTCPay one', () => {
    const pay = referenciaDePay(PAY_ID);
    expect(pay).toBe(`pay:${PAY_ID}`);
    expect(payIdDeReferencia(pay)).toBe(PAY_ID);
    expect(esReferenciaPay(pay)).toBe(true);

    // The old shape, "<storeId>:<invoiceId>", stays on the direct path.
    const directa = 'Tienda1234567:Factura123456';
    expect(esReferenciaPay(directa)).toBe(false);
    expect(payIdDeReferencia(directa)).toBeNull();
    expect(esReferenciaPay(null)).toBe(false);
    expect(payIdDeReferencia('pay:no-es-un-id')).toBeNull();
  });
});

describe('avisoPayValido', () => {
  it('accepts a notice signed with the secret and a current timestamp', () => {
    expect(avisoPayValido(firma(AVISO), AVISO, SECRETO, AHORA)).toBe(true);
  });

  it('rejects a wrong secret, a changed body, a missing header and a malformed one', () => {
    expect(avisoPayValido(firma(AVISO, undefined, 'otro-secreto'), AVISO, SECRETO, AHORA)).toBe(false);
    expect(avisoPayValido(firma(AVISO), AVISO + ' ', SECRETO, AHORA)).toBe(false);
    expect(avisoPayValido(null, AVISO, SECRETO, AHORA)).toBe(false);
    expect(avisoPayValido('t=abc,v1=zz', AVISO, SECRETO, AHORA)).toBe(false);
    expect(avisoPayValido(firma(AVISO), AVISO, '', AHORA)).toBe(false);
  });

  it('rejects an old timestamp, more than five minutes away in either direction', () => {
    const viejo = Math.floor(AHORA / 1000) - 301;
    const futuro = Math.floor(AHORA / 1000) + 301;
    expect(avisoPayValido(firma(AVISO, viejo), AVISO, SECRETO, AHORA)).toBe(false);
    expect(avisoPayValido(firma(AVISO, futuro), AVISO, SECRETO, AHORA)).toBe(false);
    expect(avisoPayValido(firma(AVISO, Math.floor(AHORA / 1000) - 299), AVISO, SECRETO, AHORA)).toBe(true);
  });
});

describe('leerAvisoPay', () => {
  it('reads the fields used from a notice', () => {
    expect(leerAvisoPay(AVISO)).toEqual({
      aviso: '0b7d4a55-aaaa-4a55-9e0e-3c2d8f7a9b10',
      tipo: 'cobro.estado',
      id: PAY_ID,
      estado: 'pagado',
    });
  });

  it('refuses a body without a valid charge id', () => {
    expect(leerAvisoPay('{"aviso":"a","tipo":"cobro.estado","id":"nope","estado":"pagado"}')).toBeNull();
    expect(leerAvisoPay('no es json')).toBeNull();
  });
});

describe('AvisosVistos', () => {
  it('remembers an answered notice for a day, then forgets it', () => {
    let ahora = AHORA;
    const vistos = new AvisosVistos(() => ahora);
    expect(vistos.ya('aviso-1')).toBe(false);
    vistos.marcar('aviso-1');
    expect(vistos.ya('aviso-1')).toBe(true);
    ahora += 25 * 60 * 60 * 1000;
    expect(vistos.ya('aviso-1')).toBe(false);
  });
});

describe('procesarAvisoPay', () => {
  const datos = { aviso: 'aviso-1', tipo: 'cobro.estado', id: PAY_ID, estado: 'pagado' };

  function deps(local: { estado: string } | null, leido: string = 'pagado', pagar: 'pagado' | 'sin-cambio' = 'pagado') {
    const llamadas = { leerPay: 0, pagar: 0 };
    const avisos = new AvisosVistos(() => AHORA);
    return {
      llamadas,
      avisos,
      deps: {
        avisos,
        cobroLocal: async () => local,
        leerPay: async () => {
          llamadas.leerPay++;
          return { estado: leido };
        },
        pagar: async () => {
          llamadas.pagar++;
          return pagar;
        },
      },
    };
  }

  it('opens the order only after CacaoPay reads the charge as paid', async () => {
    const { deps: d, llamadas } = deps({ estado: 'pendiente' });
    expect(await procesarAvisoPay('aviso-1', datos, d)).toBe('pagado');
    expect(llamadas).toEqual({ leerPay: 1, pagar: 1 });
  });

  it('does not open the order when CacaoPay still reads it as pending', async () => {
    const { deps: d, llamadas } = deps({ estado: 'pendiente' }, 'pendiente');
    expect(await procesarAvisoPay('aviso-1', datos, d)).toBe('sin-cambio');
    expect(llamadas.pagar).toBe(0);
  });

  it('answers a repeated notice without reading CacaoPay again', async () => {
    const { deps: d, llamadas, avisos } = deps({ estado: 'pendiente' });
    await procesarAvisoPay('aviso-1', datos, d);
    expect(await procesarAvisoPay('aviso-1', datos, d)).toBe('repetido');
    expect(llamadas).toEqual({ leerPay: 1, pagar: 1 });
    expect(avisos.ya('aviso-1')).toBe(true);
  });

  it('ignores a charge that is no longer pending, such as a cancelled order, and never reads it', async () => {
    for (const estado of ['cancelado', 'expirado', 'pagado']) {
      const { deps: d, llamadas } = deps({ estado });
      expect(await procesarAvisoPay(`aviso-${estado}`, datos, d)).toBe('ignorado');
      expect(llamadas).toEqual({ leerPay: 0, pagar: 0 });
    }
  });

  it('ignores a notice for a charge this site does not have, and other events', async () => {
    const { deps: sinLocal, llamadas } = deps(null);
    expect(await procesarAvisoPay('aviso-1', datos, sinLocal)).toBe('ignorado');
    const { deps: otroEvento } = deps({ estado: 'pendiente' });
    expect(await procesarAvisoPay('aviso-2', { ...datos, tipo: 'otro.evento' }, otroEvento)).toBe('ignorado');
    expect(llamadas.leerPay).toBe(0);
  });

  it('leaves the notice open when CacaoPay cannot be read, so CacaoPay sends it again', async () => {
    const avisos = new AvisosVistos(() => AHORA);
    const d = {
      avisos,
      cobroLocal: async () => ({ estado: 'pendiente' }),
      leerPay: async () => {
        throw new ErrorPay('CacaoPay no respondió.', 0);
      },
      pagar: async () => 'pagado' as const,
    };
    await expect(procesarAvisoPay('aviso-9', datos, d)).rejects.toThrow('CacaoPay no respondió.');
    expect(avisos.ya('aviso-9')).toBe(false);
  });
});

describe('crearCobroPay', () => {
  it('posts the charge with its Idempotency-Key, the store and the notice address', async () => {
    const red = fakePay(() => json(cobro(), 201));
    const respuesta = await crearCobroPay(red.config, {
      clave: 'market-clave-de-prueba',
      sats: 25000,
      descripcion: 'Orden 42 · Tienda',
      referencia: '42',
      venceEnSegundos: 600,
      tienda: 'Tienda1234567',
    });

    expect(respuesta.id).toBe(PAY_ID);
    const llamada = red.llamadas[0];
    expect(llamada.url).toBe('https://pay.ejemplo.com/api/v1/cobros/');
    expect(llamada.metodo).toBe('POST');
    expect(llamada.cabeceras.authorization).toBe('Bearer cp_clave-de-prueba');
    expect(llamada.cabeceras['idempotency-key']).toBe('market-clave-de-prueba');
    expect(llamada.cuerpo).toEqual({
      monto: 25000,
      moneda: 'SATS',
      descripcion: 'Orden 42 · Tienda',
      referencia: '42',
      vence_en_segundos: 600,
      tienda: 'Tienda1234567',
      aviso_url: 'https://market.ejemplo.com/api/pagos/pay',
    });
  });

  it('leaves out the notice address when none is configured', async () => {
    const red = fakePay(() => json(cobro(), 201), { avisoUrl: null });
    await crearCobroPay(red.config, {
      clave: 'market-x',
      sats: 1,
      descripcion: 'x',
      referencia: '1',
      venceEnSegundos: 600,
      tienda: 'Tienda1234567',
    });
    expect(red.llamadas[0].cuerpo).not.toHaveProperty('aviso_url');
  });

  it('reads the reason of a refusal without the key, and reports a store that is not allowed', async () => {
    const red = fakePay(() => json({ error: { codigo: 'NO_PERMITIDO', mensaje: 'no' } }, 403));
    const error = await crearCobroPay(red.config, {
      clave: 'market-x',
      sats: 1,
      descripcion: 'x',
      referencia: '1',
      venceEnSegundos: 600,
      tienda: 'Tienda1234567',
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorPay);
    expect((error as ErrorPay).estado).toBe(403);
    expect((error as ErrorPay).codigo).toBe('NO_PERMITIDO');
    expect((error as Error).message).not.toContain('cp_clave-de-prueba');
  });

  it('counts a network failure as status 0, which the buyer sees as a pause', async () => {
    const red = fakePay(() => {
      throw new TypeError('fetch failed');
    });
    const error = await crearCobroPay(red.config, {
      clave: 'market-x',
      sats: 1,
      descripcion: 'x',
      referencia: '1',
      venceEnSegundos: 600,
      tienda: 'Tienda1234567',
    }).catch((e: unknown) => e);
    expect((error as ErrorPay).estado).toBe(0);
    expect(payEnPausa(error)).toBe(true);
  });
});

describe('leerCobroPay', () => {
  it('reads the charge with a GET to its address', async () => {
    const red = fakePay(() => json(cobro('pagado')));
    const leido = await leerCobroPay(red.config, PAY_ID);
    expect(leido.estado).toBe('pagado');
    expect(red.llamadas[0].url).toBe(`https://pay.ejemplo.com/api/v1/cobros/${PAY_ID}/`);
    expect(red.llamadas[0].metodo).toBe('GET');
  });

  it('refuses an answer without the fields the order needs', async () => {
    const red = fakePay(() => json({ id: PAY_ID }));
    await expect(leerCobroPay(red.config, PAY_ID)).rejects.toMatchObject({ estado: 502 });
  });
});

describe('payEnPausa', () => {
  it('is true for no answer, server errors and an invoice still being made, and false for other refusals', () => {
    expect(payEnPausa(new ErrorPay('x', 0))).toBe(true);
    expect(payEnPausa(new ErrorPay('x', 503))).toBe(true);
    expect(payEnPausa(new ErrorPay('x', 409, 'IDEMPOTENCIA_EN_CURSO'))).toBe(true);
    expect(payEnPausa(new ErrorPay('x', 403, 'NO_PERMITIDO'))).toBe(false);
    expect(payEnPausa(new Error('otro'))).toBe(false);
  });
});
