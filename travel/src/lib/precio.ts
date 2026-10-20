// BTC/USD price from two public sources. Refuses to guess when they disagree.

export type OpcionesPrecio = {
  fetch?: typeof fetch;
  ahora?: () => number;
  env?: Record<string, string | undefined>;
};

const URL_COINBASE = 'https://api.coinbase.com/v2/prices/BTC-USD/spot';
const URL_KRAKEN = 'https://api.kraken.com/0/public/Ticker?pair=XBTUSD';
const TIMEOUT_MS = 4000;
const VIGENCIA_MS = 60_000;
// Maximum allowed gap between sources, relative to the lower price.
const TOLERANCIA_PORCENTAJE = 2;

let cache: { valor: number; tomadoEn: number } | null = null;

export function olvidarCotizacion(): void {
  cache = null;
}

function aNumero(valor: unknown): number | null {
  if (typeof valor !== 'number' && typeof valor !== 'string') return null;
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function extraerCoinbase(json: unknown): number | null {
  const data = (json as { data?: { amount?: unknown } } | null)?.data;
  return aNumero(data?.amount);
}

function extraerKraken(json: unknown): number | null {
  const datos = json as { error?: unknown; result?: { XXBTZUSD?: { c?: unknown[] } } } | null;
  if (!datos || (Array.isArray(datos.error) && datos.error.length > 0)) return null;
  return aNumero(datos.result?.XXBTZUSD?.c?.[0]);
}

// One source: returns its price, or null on any failure, timeout included.
async function consultarFuente(
  url: string,
  f: typeof fetch,
  extraer: (json: unknown) => number | null,
): Promise<number | null> {
  const controlador = new AbortController();
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const plazo = new Promise<never>((_, rechazar) => {
    temporizador = setTimeout(() => {
      controlador.abort();
      rechazar(new Error('TIEMPO_AGOTADO'));
    }, TIMEOUT_MS);
  });
  const proceso = async (): Promise<number | null> => {
    const res = await f(url, { signal: controlador.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    return extraer(await res.json());
  };
  try {
    return await Promise.race([proceso(), plazo]);
  } catch {
    return null;
  } finally {
    clearTimeout(temporizador);
  }
}

export async function cotizacionUsdBtc(opciones: OpcionesPrecio = {}): Promise<number> {
  const env = opciones.env ?? process.env;
  // Fixed price for tests and offline work. A value that is not a positive number is ignored.
  const fijo = Number(env.PRECIO_FIJO_USD_BTC);
  if (Number.isFinite(fijo) && fijo > 0) return fijo;

  const ahora = opciones.ahora ?? (() => Date.now());
  if (cache !== null && ahora() - cache.tomadoEn < VIGENCIA_MS) return cache.valor;

  const f: typeof fetch = opciones.fetch ?? ((entrada, init) => fetch(entrada, init));
  const [coinbase, kraken] = await Promise.all([
    consultarFuente(URL_COINBASE, f, extraerCoinbase),
    consultarFuente(URL_KRAKEN, f, extraerKraken),
  ]);

  const valores = [coinbase, kraken].filter((v): v is number => v !== null);
  if (valores.length === 0) {
    throw new Error('SIN_PRECIO: No se pudo consultar el precio de bitcoin. No se crean órdenes nuevas.');
  }

  let valor: number;
  if (valores.length === 1) {
    valor = valores[0];
  } else {
    const bajo = Math.min(...valores);
    const alto = Math.max(...valores);
    // Multiplied out to avoid float error at the exact limit.
    if ((alto - bajo) * 100 > bajo * TOLERANCIA_PORCENTAJE) {
      throw new Error(
        `PRECIO_DISCREPANTE: Las fuentes de precio no coinciden (${bajo} y ${alto} USD por BTC). No se crean órdenes.`,
      );
    }
    valor = Math.round(((valores[0] + valores[1]) / 2) * 100) / 100;
  }

  cache = { valor, tomadoEn: ahora() };
  return valor;
}
