import { timingSafeEqual } from "node:crypto";
import { ErrorLedger } from "../errores.ts";
import { sincronizarBtcpay, type ConfigSincronizacion, type RegistroSincronizacion } from "../sincronizar.ts";
import { createAlmacenSupabase } from "../almacen/supabase.ts";
import { createAlmacenDtesSupabase } from "../almacen/dtes.ts";
import { correlativosSupabase } from "../correlativos-supabase.ts";
import { emitirPagados, LIMITE_EMISION_POR_SYNC } from "../emitir.ts";
import { btcpayDeEntorno, supabaseDeEntorno, type ConfigSupabaseWeb } from "./configuracion.ts";

// Keeps the ticket store up to date with BTCPay, at most once per throttle window. The last run is read from
// ledger_sincronizaciones; every run writes one row there. After the import, the run emits the tax documents of
// the tickets still pagado (src/emitir.ts). Nothing in here throws to the page: it returns the state, with the
// error in plain words when something failed.

export const UMBRAL_DEFECTO_MS = 60_000;
export const LIMITE_PAGINA_MS = 6_000;

export type EstadoSincronizacion = {
  // When the last successful run finished, or null when there is none.
  ultima: Date | null;
  // Why the last run failed, in Spanish, or null.
  error: string | null;
  // New tickets from this call. 0 when the call did not run BTCPay.
  nuevas: number;
  // Documents emitted (accepted by the simulated reception) and refused in this call. 0 when it did not run.
  emitidos: number;
  rechazados: number;
  // True when this call ran BTCPay, false when the last run was recent enough.
  corrio: boolean;
};

export type OpcionesSincronizacion = {
  // Minimum age of the last run before BTCPay is read again. 0 always runs.
  umbralMs?: number;
  // Time allowed before the page stops waiting. null waits for the sync to finish (used by the cron route).
  limiteMs?: number | null;
  ahora?: Date;
  // Replaced in tests.
  supabase?: ConfigSupabaseWeb | null;
  btcpay?: ConfigSincronizacion | null;
  fetch?: typeof fetch;
};

type FilaRegistro = { empezo: string; termino: string | null; error: string | null };

export function mensajeDeError(e: unknown): string {
  if (e instanceof ErrorLedger) return e.message;
  return "No se pudo sincronizar con BTCPay.";
}

// Compares "Bearer <secreto>" with the header without leaking the length or the first mismatch.
export function autorizado(cabecera: string | null, secreto: string | undefined): boolean {
  if (!secreto || !cabecera) return false;
  const esperado = Buffer.from(`Bearer ${secreto}`);
  const recibido = Buffer.from(cabecera);
  if (esperado.length !== recibido.length) return false;
  return timingSafeEqual(esperado, recibido);
}

function cabeceras(sb: ConfigSupabaseWeb): Record<string, string> {
  return { apikey: sb.clave, authorization: `Bearer ${sb.clave}`, accept: "application/json" };
}

async function filaDeRegistro(sb: ConfigSupabaseWeb, f: typeof fetch, soloCorrectas: boolean): Promise<FilaRegistro | null> {
  const q = new URLSearchParams({ select: "empezo,termino,error", order: "empezo.desc", limit: "1" });
  if (soloCorrectas) q.append("error", "is.null");
  const r = await f(`${sb.url}/rest/v1/ledger_sincronizaciones?${q}`, { headers: cabeceras(sb), cache: "no-store" });
  if (!r.ok) throw new ErrorLedger(`No se pudo leer el registro de sincronización (HTTP ${r.status}).`);
  const lista = (await r.json()) as FilaRegistro[];
  return lista[0] ?? null;
}

async function insertarRegistro(sb: ConfigSupabaseWeb, f: typeof fetch, fila: RegistroSincronizacion): Promise<void> {
  const r = await f(`${sb.url}/rest/v1/ledger_sincronizaciones`, {
    method: "POST",
    headers: { ...cabeceras(sb), "content-type": "application/json", prefer: "return=minimal" },
    body: JSON.stringify(fila),
    cache: "no-store",
  });
  if (!r.ok) throw new ErrorLedger(`No se pudo guardar el registro de sincronización (HTTP ${r.status}).`);
}

// The finish time of the last successful run, or null.
async function ultimaOk(sb: ConfigSupabaseWeb, f: typeof fetch): Promise<Date | null> {
  const fila = await filaDeRegistro(sb, f, true);
  return fila ? new Date(fila.termino ?? fila.empezo) : null;
}

async function correrSincronizacion(
  sb: ConfigSupabaseWeb,
  btc: ConfigSincronizacion,
  f: typeof fetch,
  ahora: Date,
  anterior: Date | null,
): Promise<EstadoSincronizacion> {
  // The log row is written by the sync itself; a failure to write it must not hide the result.
  const registrar = (fila: RegistroSincronizacion) =>
    insertarRegistro(sb, f, fila).catch((e: unknown) => {
      console.error("No se pudo escribir el registro de sincronización:", e);
    });
  try {
    const almacen = createAlmacenSupabase({ url: sb.url, clave: sb.clave, fetch: f });
    const dtes = createAlmacenDtesSupabase({ url: sb.url, clave: sb.clave, fetch: f });
    const correlativos = correlativosSupabase({ url: sb.url, clave: sb.clave, fetch: f });
    const r = await sincronizarBtcpay(
      almacen,
      { ...btc, fetch: f },
      {
        ahora,
        registrar,
        emitir: (almacenTickets) => emitirPagados(almacenTickets, dtes, correlativos, { ahora, limite: LIMITE_EMISION_POR_SYNC }),
      },
    );
    return { ultima: new Date(), error: null, nuevas: r.nuevas, emitidos: r.emitidos ?? 0, rechazados: r.rechazados ?? 0, corrio: true };
  } catch (e) {
    return { ultima: anterior, error: mensajeDeError(e), nuevas: 0, emitidos: 0, rechazados: 0, corrio: true };
  }
}

export async function sincronizarSiHaceFalta(opciones: OpcionesSincronizacion = {}): Promise<EstadoSincronizacion> {
  const ahora = opciones.ahora ?? new Date();
  const umbralMs = opciones.umbralMs ?? UMBRAL_DEFECTO_MS;
  const limiteMs = opciones.limiteMs === undefined ? LIMITE_PAGINA_MS : opciones.limiteMs;
  const f = opciones.fetch ?? fetch;
  let anterior: Date | null = null;
  try {
    const sb = opciones.supabase === undefined ? supabaseDeEntorno() : opciones.supabase;
    if (sb === null) {
      return { ultima: null, error: "Falta la configuración de la base de datos en el servidor.", nuevas: 0, emitidos: 0, rechazados: 0, corrio: false };
    }
    anterior = await ultimaOk(sb, f);
    const ultimo = await filaDeRegistro(sb, f, false);
    if (ultimo !== null && ahora.getTime() - new Date(ultimo.empezo).getTime() < umbralMs) {
      const ultima = ultimo.error === null ? new Date(ultimo.termino ?? ultimo.empezo) : anterior;
      return { ultima, error: ultimo.error, nuevas: 0, emitidos: 0, rechazados: 0, corrio: false };
    }
    const btc = opciones.btcpay === undefined ? btcpayDeEntorno() : opciones.btcpay;
    if (btc === null) {
      return { ultima: anterior, error: "Falta la configuración de BTCPay en el servidor.", nuevas: 0, emitidos: 0, rechazados: 0, corrio: false };
    }
    const trabajo = correrSincronizacion(sb, btc, f, ahora, anterior);
    if (limiteMs === null) return await trabajo;
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    const limite = new Promise<EstadoSincronizacion>((resolver) => {
      temporizador = setTimeout(
        () =>
          resolver({
            ultima: anterior,
            error: `BTCPay tardó más de ${Math.round(limiteMs / 1000)} segundos. Se vuelve a intentar en la próxima visita.`,
            nuevas: 0,
            emitidos: 0,
            rechazados: 0,
            corrio: true,
          }),
        limiteMs,
      );
    });
    try {
      return await Promise.race([trabajo, limite]);
    } finally {
      clearTimeout(temporizador);
    }
  } catch (e) {
    return { ultima: anterior, error: mensajeDeError(e), nuevas: 0, emitidos: 0, rechazados: 0, corrio: false };
  }
}
