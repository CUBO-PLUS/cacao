// The public address of BTCPay is read from Supabase (public.url_btcpay), so a new tunnel address takes effect
// without a redeploy. LEDGER_BTCPAY_URL is the fallback when Supabase cannot answer or answers nothing usable.
// Only the Supabase answer is cached (30 seconds for an answer, 10 seconds for a failure); the fallback is read
// from the environment on each call. The key stays in the environment.

const ESPERA_MS = 3000;
const CACHE_RESPUESTA_MS = 30_000;
const CACHE_FALLO_MS = 10_000;
const FORMATO = /^https?:\/\/[^/\s]+$/;

type Entorno = Record<string, string | undefined>;

export type OpcionesUrlBtcpay = {
  // Read on each call. Replaced in tests.
  entorno?: () => Entorno;
  // Replaced in tests.
  fetch?: typeof fetch;
  // Milliseconds since the epoch. Replaced in tests.
  ahora?: () => number;
};

// What Supabase said: an address already checked, null for "no address", or a failure (fallo).
type Lectura = { valor: string | null; fallo: boolean };

function normalizar(valor: string | undefined): string | null {
  const limpio = (valor ?? "").trim().replace(/\/+$/, "");
  return FORMATO.test(limpio) ? limpio : null;
}

// Never throws: any problem with the answer is a failure, and the caller falls back to the environment.
async function leerDeSupabase(entorno: Entorno, f: typeof fetch): Promise<Lectura> {
  const url = (entorno.SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const clave = (entorno.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (url === "" || clave === "") return { valor: null, fallo: true };

  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), ESPERA_MS);
  try {
    const r = await f(`${url}/rest/v1/rpc/url_btcpay`, {
      method: "POST",
      headers: { apikey: clave, authorization: `Bearer ${clave}`, "content-type": "application/json" },
      body: "{}",
      cache: "no-store",
      signal: control.signal,
    });
    if (!r.ok) return { valor: null, fallo: true };
    const dato = (await r.json()) as unknown;
    if (dato === null) return { valor: null, fallo: false };
    const valido = typeof dato === "string" ? normalizar(dato) : null;
    // A value that is not an http(s) origin is refused, and the environment is used instead.
    return valido === null ? { valor: null, fallo: true } : { valor: valido, fallo: false };
  } catch {
    return { valor: null, fallo: true };
  } finally {
    clearTimeout(reloj);
  }
}

// Builds the resolver with its own cache. The server uses urlBtcpay; tests build their own.
export function crearUrlBtcpay(opciones: OpcionesUrlBtcpay = {}): () => Promise<string | null> {
  const entorno = opciones.entorno ?? (() => process.env);
  const ahora = opciones.ahora ?? Date.now;
  let cache: { lectura: Lectura; hasta: number } | null = null;

  return async () => {
    const env = entorno();
    if (cache === null || ahora() >= cache.hasta) {
      const lectura = await leerDeSupabase(env, opciones.fetch ?? fetch);
      cache = { lectura, hasta: ahora() + (lectura.fallo ? CACHE_FALLO_MS : CACHE_RESPUESTA_MS) };
    }
    return cache.lectura.valor ?? normalizar(env.LEDGER_BTCPAY_URL);
  };
}

// The public BTCPay address, without a trailing slash. Null when neither Supabase nor LEDGER_BTCPAY_URL has one.
export const urlBtcpay = crearUrlBtcpay();
