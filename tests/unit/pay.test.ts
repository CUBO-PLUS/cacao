// Unit tests for the CacaoPay client: the switch, the notice signature, replays, repeated notices and the request shape.
// Fake fetch and clock; no network. Run with `npm run test:unit`.
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  avisoPayValido,
  AvisosVistos,
  claveDeReintento,
  claveIdempotencia,
  cobroUtilizable,
  configDesdeEntornoPay,
  crearCobroPay,
  ErrorPay,
  facturaIdDePay,
  leerAvisoPay,
  leerCobroPay,
  payEnPausa,
  payIdDeFactura,
  procesarAvisoPay,
  type ConfigPay,
} from '../../src/lib/servidor/pay.ts';

const SECRETO = 'secreto-de-prueba-avisos';
const ID = '6f1c2a1e-0b7d-4a55-9e0e-3c2d8f7a9b10';
const AVISO = '0b7d4a55-1111-4222-8333-444455556666';
const AHORA = 1_800_000_000_000;

/** The notice signature as CacaoPay sends it: t=<seconds>,v1=<hex of HMAC("<t>.<body>")>. */
function firmaDe(cuerpo: string, t: number, secreto = SECRETO): string {
  const v1 = createHmac('sha256', secreto).update(`${t}.${cuerpo}`, 'utf8').digest('hex');
  return `t=${t},v1=${v1}`;
}

const CUERPO = JSON.stringify({ aviso: AVISO, tipo: 'cobro.estado', id: ID, estado: 'pagado' });
const T = Math.floor(AHORA / 1000);

test('configDesdeEntornoPay needs both the URL and the API key, and trims the URL', () => {
  assert.deepEqual(
    configDesdeEntornoPay({ CACAO_PAY_URL: 'http://127.0.0.1:4324/', CACAO_PAY_API_KEY: ' cp_clave ', CACAO_PAY_AVISO_SECRET: 's' }),
    { url: 'http://127.0.0.1:4324', clave: 'cp_clave', avisoSecreto: 's' },
  );
  assert.equal(configDesdeEntornoPay({ CACAO_PAY_URL: 'https://pay.example', CACAO_PAY_API_KEY: 'cp_clave' })?.avisoSecreto, null);
});

test('the switch stays off unless both values are set', () => {
  assert.equal(configDesdeEntornoPay({}), null);
  assert.equal(configDesdeEntornoPay({ CACAO_PAY_URL: '', CACAO_PAY_API_KEY: 'cp_clave' }), null);
  assert.equal(configDesdeEntornoPay({ CACAO_PAY_URL: 'https://pay.example', CACAO_PAY_API_KEY: '  ' }), null);
  assert.equal(configDesdeEntornoPay({ CACAO_PAY_URL: 'pay.example', CACAO_PAY_API_KEY: 'cp_clave' }), null);
  assert.equal(configDesdeEntornoPay({ CACAO_PAY_URL: 'https://pay.example/ruta', CACAO_PAY_API_KEY: 'cp_clave' }), null);
});

test('avisoPayValido accepts the signature of the raw body inside the five-minute window', () => {
  assert.equal(avisoPayValido(firmaDe(CUERPO, T), CUERPO, SECRETO, AHORA), true);
  assert.equal(avisoPayValido(firmaDe(CUERPO, T - 299), CUERPO, SECRETO, AHORA), true);
});

test('avisoPayValido refuses a wrong secret, a changed body, a missing header and an empty secret', () => {
  assert.equal(avisoPayValido(firmaDe(CUERPO, T, 'otro'), CUERPO, SECRETO, AHORA), false);
  assert.equal(avisoPayValido(firmaDe(CUERPO, T), CUERPO + ' ', SECRETO, AHORA), false);
  assert.equal(avisoPayValido(null, CUERPO, SECRETO, AHORA), false);
  assert.equal(avisoPayValido(firmaDe(CUERPO, T), CUERPO, '', AHORA), false);
  assert.equal(avisoPayValido('t=abc,v1=00', CUERPO, SECRETO, AHORA), false);
});

test('avisoPayValido rejects an old or a far-future timestamp', () => {
  assert.equal(avisoPayValido(firmaDe(CUERPO, T - 301), CUERPO, SECRETO, AHORA), false);
  assert.equal(avisoPayValido(firmaDe(CUERPO, T + 301), CUERPO, SECRETO, AHORA), false);
});

test('leerAvisoPay reads the notice and refuses malformed bodies', () => {
  assert.deepEqual(leerAvisoPay(CUERPO), { aviso: AVISO, tipo: 'cobro.estado', id: ID, estado: 'pagado' });
  assert.equal(leerAvisoPay('no es json'), null);
  assert.equal(leerAvisoPay(JSON.stringify({ aviso: AVISO, tipo: 'cobro.estado', id: 'corto', estado: 'pagado' })), null);
});

test('AvisosVistos remembers an id for a day and never holds more than its cap', () => {
  let t = 0;
  const vistos = new AvisosVistos(() => t);
  assert.equal(vistos.ya(AVISO), false);
  vistos.marcar(AVISO);
  assert.equal(vistos.ya(AVISO), true);
  t += 24 * 60 * 60 * 1000 + 1;
  assert.equal(vistos.ya(AVISO), false);
});

/** A local invoice and a CacaoPay read that the notice tests can change. */
function escenario(opciones: { local?: { id: string; estado: string } | null; pay?: string | Error }) {
  const llamadas = { leer: 0, pagar: 0 };
  const avisos = new AvisosVistos();
  const deps = {
    avisos,
    cobroLocal: async () => (opciones.local === undefined ? { id: 'cobro-local', estado: 'pendiente' } : opciones.local),
    leerPay: async () => {
      llamadas.leer++;
      if (opciones.pay instanceof Error) throw opciones.pay;
      return { estado: opciones.pay ?? 'pagado' };
    },
    pagar: async () => {
      llamadas.pagar++;
      return 'pagado' as const;
    },
  };
  return { deps, llamadas };
}

const DATOS = { aviso: AVISO, tipo: 'cobro.estado', id: ID, estado: 'pagado' };

test('a paid notice reads the charge again and opens access once', async () => {
  const { deps, llamadas } = escenario({});
  assert.equal(await procesarAvisoPay(AVISO, DATOS, deps), 'pagado');
  assert.deepEqual(llamadas, { leer: 1, pagar: 1 });
});

test('a repeated notice id is ignored without another read or another opening', async () => {
  const { deps, llamadas } = escenario({});
  await procesarAvisoPay(AVISO, DATOS, deps);
  assert.equal(await procesarAvisoPay(AVISO, DATOS, deps), 'repetido');
  assert.deepEqual(llamadas, { leer: 1, pagar: 1 });
});

test('a notice for an invoice whose state is already final changes nothing', async () => {
  for (const estado of ['pagada', 'vencida', 'fallida']) {
    const { deps, llamadas } = escenario({ local: { id: 'cobro-local', estado } });
    assert.equal(await procesarAvisoPay(AVISO, DATOS, deps), 'ignorado');
    assert.deepEqual(llamadas, { leer: 0, pagar: 0 });
  }
});

test('a notice for an unknown invoice, another event, or a charge not yet paid changes nothing', async () => {
  const sinLocal = escenario({ local: null });
  assert.equal(await procesarAvisoPay(AVISO, DATOS, sinLocal.deps), 'ignorado');
  const otroEvento = escenario({});
  assert.equal(await procesarAvisoPay(AVISO, { ...DATOS, tipo: 'cobro.creado' }, otroEvento.deps), 'ignorado');
  assert.equal(otroEvento.llamadas.leer, 0);
  const pendiente = escenario({ pay: 'pendiente' });
  assert.equal(await procesarAvisoPay(AVISO, DATOS, pendiente.deps), 'sin-cambio');
  assert.equal(pendiente.llamadas.pagar, 0);
});

test('a failed read leaves the notice open, so the retry is handled', async () => {
  const caida = escenario({ pay: new ErrorPay('CacaoPay no respondió.', 0) });
  await assert.rejects(procesarAvisoPay(AVISO, DATOS, caida.deps), ErrorPay);
  const reintento = escenario({});
  assert.equal(await procesarAvisoPay(AVISO, DATOS, { ...reintento.deps, avisos: caida.deps.avisos }), 'pagado');
});

/** A fake CacaoPay that records each request and answers with the given status and body. */
function fingidoPay(estado: number, cuerpo: unknown) {
  const llamadas: { url: string; metodo: string; cabeceras: Record<string, string>; cuerpo: Record<string, unknown> | undefined }[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    llamadas.push({
      url: String(url),
      metodo: init?.method ?? 'GET',
      cabeceras: (init?.headers ?? {}) as Record<string, string>,
      cuerpo: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined,
    });
    return new Response(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo), { status: estado });
  }) as typeof fetch;
  return { f, llamadas };
}

const COBRO_PAY = {
  id: ID,
  estado: 'pendiente',
  factura: 'lnbcrt3000n1pabc',
  sats: 120,
  usd_centavos: 9,
  expira_en: new Date(AHORA + 300_000).toISOString(),
  pago_tardio: false,
};

const ENTRADA = {
  clave: 'media-clave-de-prueba',
  sats: 120,
  descripcion: 'Historia: La Barra de Santiago',
  referencia: 'la-barra-de-santiago:lector',
  venceEnSegundos: 300,
  avisoUrl: 'http://localhost:4321/api/pagos/pay',
};

test('crearCobroPay sends the key, the bearer token and the fields of the charge, without a product', async () => {
  const { f, llamadas } = fingidoPay(201, COBRO_PAY);
  const config: ConfigPay = { url: 'http://127.0.0.1:4324', clave: 'cp_clave', avisoSecreto: SECRETO, fetch: f };
  const cobro = await crearCobroPay(config, ENTRADA);
  assert.equal(cobro.factura, 'lnbcrt3000n1pabc');
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].url, 'http://127.0.0.1:4324/api/v1/cobros/');
  assert.equal(llamadas[0].metodo, 'POST');
  assert.equal(llamadas[0].cabeceras['Idempotency-Key'], 'media-clave-de-prueba');
  assert.equal(llamadas[0].cabeceras.authorization, 'Bearer cp_clave');
  assert.deepEqual(llamadas[0].cuerpo, {
    monto: 120,
    moneda: 'SATS',
    descripcion: 'Historia: La Barra de Santiago',
    referencia: 'la-barra-de-santiago:lector',
    vence_en_segundos: 300,
    aviso_url: 'http://localhost:4321/api/pagos/pay',
  });
});

test('a refused charge is an ErrorPay that carries the code and not the key', async () => {
  const { f } = fingidoPay(409, { error: { codigo: 'IDEMPOTENCIA_EN_CURSO', mensaje: 'Repetir.' } });
  const config: ConfigPay = { url: 'http://127.0.0.1:4324', clave: 'cp_clave_secreta', avisoSecreto: null, fetch: f };
  await assert.rejects(crearCobroPay(config, ENTRADA), (error: unknown) => {
    assert.ok(error instanceof ErrorPay);
    assert.equal(error.estado, 409);
    assert.match(error.message, /IDEMPOTENCIA_EN_CURSO/);
    assert.doesNotMatch(error.message, /cp_clave_secreta/);
    return true;
  });
});

test('an unreachable or failing CacaoPay counts as paused, and a refused charge does not', async () => {
  const caida: typeof fetch = async () => {
    throw new TypeError('red caída');
  };
  await assert.rejects(crearCobroPay({ url: 'http://127.0.0.1:9', clave: 'k', avisoSecreto: null, fetch: caida }, ENTRADA), (e: unknown) => {
    assert.equal(payEnPausa(e), true);
    return true;
  });
  const { f } = fingidoPay(503, { error: { codigo: 'NO_DISPONIBLE' } });
  await assert.rejects(crearCobroPay({ url: 'http://127.0.0.1:4324', clave: 'k', avisoSecreto: null, fetch: f }, ENTRADA), (e: unknown) => {
    assert.equal(payEnPausa(e), true);
    return true;
  });
  const rechazada = new ErrorPay('CacaoPay respondió 400', 400);
  assert.equal(payEnPausa(rechazada), false);
  assert.equal(payEnPausa(new Error('otra cosa')), false);
});

test('a charge answer without an id, a status or an invoice is refused', async () => {
  const { f } = fingidoPay(201, { id: ID });
  await assert.rejects(crearCobroPay({ url: 'http://127.0.0.1:4324', clave: 'k', avisoSecreto: null, fetch: f }, ENTRADA), ErrorPay);
});

test('leerCobroPay reads the charge with its id and the trailing slash', async () => {
  const { f, llamadas } = fingidoPay(200, COBRO_PAY);
  const cobro = await leerCobroPay({ url: 'http://127.0.0.1:4324', clave: 'cp_clave', avisoSecreto: null, fetch: f }, ID);
  assert.equal(cobro.estado, 'pendiente');
  assert.equal(llamadas[0].url, `http://127.0.0.1:4324/api/v1/cobros/${ID}/`);
  assert.equal(llamadas[0].metodo, 'GET');
});

test('the Idempotency-Key is the same for a retry and changes with the newest row', () => {
  const lector = '11111111-2222-4333-8444-555555555555';
  const primera = claveIdempotencia(lector, 'la-barra-de-santiago', null);
  assert.equal(claveIdempotencia(lector, 'la-barra-de-santiago', null), primera);
  assert.notEqual(claveIdempotencia(lector, 'la-barra-de-santiago', ID), primera);
  assert.notEqual(claveIdempotencia(lector, 'otra-historia', null), primera);
  assert.match(primera, /^[A-Za-z0-9_-]{8,128}$/);
  const reintento = claveDeReintento(primera, ID);
  assert.notEqual(reintento, primera);
  assert.equal(claveDeReintento(primera, ID), reintento);
});

test('a stored invoice id maps to the CacaoPay charge and back, and BTCPay ids do not map', () => {
  const guardado = facturaIdDePay(ID);
  assert.equal(guardado, 'pay6f1c2a1e0b7d4a559e0e3c2d8f7a9b10');
  assert.equal(payIdDeFactura(guardado), ID);
  assert.equal(payIdDeFactura('Inv0000000001'), null);
  assert.equal(payIdDeFactura(null), null);
  assert.equal(facturaIdDePay('no-es-un-id'), null);
});

test('a pending invoice is usable only with time left to pay it', () => {
  assert.equal(cobroUtilizable({ estado: 'pendiente', expira_en: new Date(AHORA + 300_000).toISOString() }, AHORA), true);
  assert.equal(cobroUtilizable({ estado: 'pendiente', expira_en: new Date(AHORA + 30_000).toISOString() }, AHORA), false);
  assert.equal(cobroUtilizable({ estado: 'pagado', expira_en: new Date(AHORA + 300_000).toISOString() }, AHORA), false);
});
