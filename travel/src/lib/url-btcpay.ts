// The public address of BTCPay, read from Supabase at run time (rpc url_btcpay). Server only.
// The watcher on the PC (infra/btcpay/vigia.ps1) keeps that row current, so a tunnel change needs no redeploy.
// When Supabase cannot answer, or has no address, the BTCPAY_URL variable is the fallback.
// Travel reads with the anon key: url_btcpay is granted to anon, and the address is public anyway.

export type OpcionesUrlBtcpay = {
  /** Replaced in tests. */
  fetch?: typeof fetch;
  /** Replaced in tests. Epoch milliseconds. */
  ahora?: () => number;
  /** Replaced in tests. Defaults to process.env. */
  env?: Record<string, string | undefined>;
};

/** How long a fresh answer from Supabase is kept. */
const VIGENCIA_MS = 30_000;
/** How long a failed call is kept, so a slow Supabase is not asked on every request. */
const VIGENCIA_FALLO_MS = 10_000;
const ESPERA_MS = 3_000;

let cache: { url: string | null; hasta: number } | null = null;

/** Forgets the cached answer. Tests use it; the product never needs it. */
export function olvidarUrlBtcpay(): void {
  cache = null;
}

/** The address from Supabase when it answers with an https origin, otherwise the BTCPAY_URL variable, otherwise null. */
export async function urlBtcpay(opciones: OpcionesUrlBtcpay = {}): Promise<string | null> {
  const env = opciones.env ?? process.env;
  const ahora = (opciones.ahora ?? Date.now)();
  if (!cache || cache.hasta <= ahora) {
    cache = await consultarSupabase(env, opciones.fetch ?? fetch, ahora);
  }
  if (cache.url) return cache.url;
  const deEntorno = (env.BTCPAY_URL ?? '').trim();
  return deEntorno || null;
}

async function consultarSupabase(
  env: Record<string, string | undefined>,
  f: typeof fetch,
  ahora: number,
): Promise<{ url: string | null; hasta: number }> {
  const base = (env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  const clave = (env.SUPABASE_ANON_KEY ?? '').trim();
  // Without Supabase there is nothing to ask: the fallback applies and nothing is cached.
  if (!base || !clave) return { url: null, hasta: 0 };

  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), ESPERA_MS);
  try {
    const r = await f(`${base}/rest/v1/rpc/url_btcpay`, {
      method: 'POST',
      headers: { apikey: clave, authorization: `Bearer ${clave}`, 'content-type': 'application/json' },
      body: '{}',
      signal: control.signal,
    });
    if (!r.ok) throw new Error(`Supabase respondió ${r.status} a url_btcpay.`);
    const respuesta: unknown = await r.json();
    // A scalar function answers a JSON string, or null when the row is missing.
    const valor = typeof respuesta === 'string' ? respuesta.trim().replace(/\/+$/, '') : '';
    const url = /^https:\/\/[^/\s]+$/.test(valor) ? valor : null;
    return { url, hasta: ahora + VIGENCIA_MS };
  } catch (error) {
    // Never log the key: only the reason of the failure.
    console.error('No se pudo leer la dirección de BTCPay en Supabase; se usa BTCPAY_URL.', error instanceof Error ? error.message : '');
    return { url: null, hasta: ahora + VIGENCIA_FALLO_MS };
  } finally {
    clearTimeout(reloj);
  }
}
