// Unit tests for the BTCPay address read from Supabase: cache, failures and fallback. Fake fetch and clock.
// Run with `npm run test:unit`.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { olvidarUrlBtcpay, urlBtcpay } from '../../src/lib/servidor/url-btcpay.ts';

const ENV = {
  SUPABASE_URL: 'https://proyecto.supabase.co/',
  SUPABASE_SERVICE_ROLE_KEY: 'clave-de-prueba',
  BTCPAY_URL: 'https://respaldo.trycloudflare.com',
};

/** A fake fetch that answers with the given body, or throws when `falla` is set. Counts the calls. */
function fingidoFetch(respuesta: { cuerpo?: unknown; estado?: number; falla?: boolean }) {
  const llamadas: { url: string; cabeceras: Record<string, string> }[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const cabeceras = (init?.headers ?? {}) as Record<string, string>;
    llamadas.push({ url: String(url), cabeceras });
    if (respuesta.falla) throw new TypeError('red caída');
    return new Response(JSON.stringify(respuesta.cuerpo ?? null), { status: respuesta.estado ?? 200 });
  }) as typeof fetch;
  return { f, llamadas };
}

/** A clock that the test moves by hand. */
function reloj(inicio = 1_000_000) {
  let t = inicio;
  return { ahora: () => t, avanzar: (ms: number) => (t += ms) };
}

beforeEach(() => olvidarUrlBtcpay());

test('reads the address from rpc url_btcpay with the service key and the origin only', async () => {
  const { f, llamadas } = fingidoFetch({ cuerpo: 'https://vigia-ok.trycloudflare.com' });
  const url = await urlBtcpay({ fetch: f, env: ENV, ahora: reloj().ahora });
  assert.equal(url, 'https://vigia-ok.trycloudflare.com');
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].url, 'https://proyecto.supabase.co/rest/v1/rpc/url_btcpay');
  assert.equal(llamadas[0].cabeceras.apikey, 'clave-de-prueba');
  assert.equal(llamadas[0].cabeceras.authorization, 'Bearer clave-de-prueba');
});

test('keeps a fresh answer for 30 seconds and asks again after that', async () => {
  const { f, llamadas } = fingidoFetch({ cuerpo: 'https://uno.trycloudflare.com' });
  const t = reloj();
  await urlBtcpay({ fetch: f, env: ENV, ahora: t.ahora });
  t.avanzar(29_000);
  await urlBtcpay({ fetch: f, env: ENV, ahora: t.ahora });
  assert.equal(llamadas.length, 1);
  t.avanzar(2_000);
  await urlBtcpay({ fetch: f, env: ENV, ahora: t.ahora });
  assert.equal(llamadas.length, 2);
});

test('falls back to BTCPAY_URL when Supabase has no row', async () => {
  const { f } = fingidoFetch({ cuerpo: null });
  assert.equal(await urlBtcpay({ fetch: f, env: ENV, ahora: reloj().ahora }), 'https://respaldo.trycloudflare.com');
});

test('falls back to BTCPAY_URL when Supabase answers an error or a value that is not an https origin', async () => {
  const error = fingidoFetch({ estado: 500, cuerpo: { message: 'caído' } });
  assert.equal(await urlBtcpay({ fetch: error.f, env: ENV, ahora: reloj().ahora }), 'https://respaldo.trycloudflare.com');

  olvidarUrlBtcpay();
  const invalido = fingidoFetch({ cuerpo: 'http://sin-tls.example.com' });
  assert.equal(await urlBtcpay({ fetch: invalido.f, env: ENV, ahora: reloj().ahora }), 'https://respaldo.trycloudflare.com');

  olvidarUrlBtcpay();
  const ruta = fingidoFetch({ cuerpo: 'https://ejemplo.com/ruta' });
  assert.equal(await urlBtcpay({ fetch: ruta.f, env: ENV, ahora: reloj().ahora }), 'https://respaldo.trycloudflare.com');
});

test('a failed call falls back at once and is not repeated for 10 seconds', async () => {
  const { f, llamadas } = fingidoFetch({ falla: true });
  const t = reloj();
  assert.equal(await urlBtcpay({ fetch: f, env: ENV, ahora: t.ahora }), 'https://respaldo.trycloudflare.com');
  t.avanzar(9_000);
  assert.equal(await urlBtcpay({ fetch: f, env: ENV, ahora: t.ahora }), 'https://respaldo.trycloudflare.com');
  assert.equal(llamadas.length, 1);
  t.avanzar(2_000);
  await urlBtcpay({ fetch: f, env: ENV, ahora: t.ahora });
  assert.equal(llamadas.length, 2);
});

test('without Supabase configured nothing is asked and BTCPAY_URL is used', async () => {
  const { f, llamadas } = fingidoFetch({ cuerpo: 'https://no-debe-usarse.trycloudflare.com' });
  const sinBase = { BTCPAY_URL: ENV.BTCPAY_URL };
  assert.equal(await urlBtcpay({ fetch: f, env: sinBase, ahora: reloj().ahora }), 'https://respaldo.trycloudflare.com');
  assert.equal(llamadas.length, 0);
});

test('returns null when neither Supabase nor BTCPAY_URL has an address', async () => {
  const { f } = fingidoFetch({ cuerpo: null });
  assert.equal(await urlBtcpay({ fetch: f, env: { SUPABASE_URL: ENV.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: ENV.SUPABASE_SERVICE_ROLE_KEY }, ahora: reloj().ahora }), null);
});
