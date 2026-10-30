import { describe, expect, it, vi } from 'vitest';

import { crearUrlBtcpay } from './url-btcpay';

// Supabase is faked: the resolver is tested through its cache, its fallback and its validation.
const SUPABASE = { NEXT_PUBLIC_SUPABASE_URL: 'https://proyecto.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'clave-de-prueba' };

function reloj() {
  let ms = 1_000_000;
  return { ahora: () => ms, avanzar: (cuanto: number) => (ms += cuanto) };
}

function respuesta(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status: estado });
}

describe('urlBtcpay', () => {
  it('reads the address from Supabase and caches it for 30 seconds', async () => {
    const f = vi.fn(async () => respuesta('https://nueva.trycloudflare.com/'));
    const t = reloj();
    const urlBtcpay = crearUrlBtcpay({ entorno: () => ({ ...SUPABASE }), fetch: f, ahora: t.ahora });

    expect(await urlBtcpay()).toBe('https://nueva.trycloudflare.com');
    expect(await urlBtcpay()).toBe('https://nueva.trycloudflare.com');
    expect(f).toHaveBeenCalledTimes(1);

    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://proyecto.supabase.test/rest/v1/rpc/url_btcpay');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{}');
    expect(init.headers).toEqual({
      apikey: 'clave-de-prueba',
      authorization: 'Bearer clave-de-prueba',
      'content-type': 'application/json',
    });

    t.avanzar(30_000);
    expect(await urlBtcpay()).toBe('https://nueva.trycloudflare.com');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('falls back to BTCPAY_URL when Supabase fails, and remembers the failure for 10 seconds', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const t = reloj();
    const urlBtcpay = crearUrlBtcpay({
      entorno: () => ({ ...SUPABASE, BTCPAY_URL: 'https://respaldo.example.test/' }),
      fetch: f,
      ahora: t.ahora,
    });

    expect(await urlBtcpay()).toBe('https://respaldo.example.test');
    expect(await urlBtcpay()).toBe('https://respaldo.example.test');
    expect(f).toHaveBeenCalledTimes(1);

    t.avanzar(10_000);
    expect(await urlBtcpay()).toBe('https://respaldo.example.test');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('falls back when Supabase answers with an error status', async () => {
    const f = vi.fn(async () => respuesta({ message: 'permission denied' }, 401));
    const urlBtcpay = crearUrlBtcpay({
      entorno: () => ({ ...SUPABASE, BTCPAY_URL: 'https://respaldo.example.test' }),
      fetch: f,
    });
    expect(await urlBtcpay()).toBe('https://respaldo.example.test');
  });

  it('rejects a value that is not an http(s) origin and uses the environment', async () => {
    const f = vi.fn(async () => respuesta('https://btcpay.test/ruta-no-permitida'));
    const urlBtcpay = crearUrlBtcpay({
      entorno: () => ({ ...SUPABASE, BTCPAY_URL: 'https://respaldo.example.test' }),
      fetch: f,
    });
    expect(await urlBtcpay()).toBe('https://respaldo.example.test');
  });

  it('rejects a value that is not a string and uses the environment', async () => {
    const f = vi.fn(async () => respuesta({ url: 'https://btcpay.test' }));
    const urlBtcpay = crearUrlBtcpay({
      entorno: () => ({ ...SUPABASE, BTCPAY_URL: 'https://respaldo.example.test' }),
      fetch: f,
    });
    expect(await urlBtcpay()).toBe('https://respaldo.example.test');
  });

  it('returns null when Supabase has no address and the environment has none either', async () => {
    const f = vi.fn(async () => respuesta(null));
    const urlBtcpay = crearUrlBtcpay({ entorno: () => ({ ...SUPABASE, BTCPAY_URL: '' }), fetch: f });
    expect(await urlBtcpay()).toBeNull();
  });

  it('uses the environment without asking Supabase when Supabase is not configured', async () => {
    const f = vi.fn(async () => respuesta('https://nueva.trycloudflare.com'));
    const urlBtcpay = crearUrlBtcpay({ entorno: () => ({ BTCPAY_URL: 'https://respaldo.example.test' }), fetch: f });
    expect(await urlBtcpay()).toBe('https://respaldo.example.test');
    expect(f).not.toHaveBeenCalled();
  });

  it('reads the environment on each call, so a changed fallback is seen at once', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    let env: Record<string, string | undefined> = { ...SUPABASE, BTCPAY_URL: 'https://uno.example.test' };
    const urlBtcpay = crearUrlBtcpay({ entorno: () => env, fetch: f });
    expect(await urlBtcpay()).toBe('https://uno.example.test');
    env = { ...SUPABASE, BTCPAY_URL: 'https://dos.example.test' };
    expect(await urlBtcpay()).toBe('https://dos.example.test');
  });
});
