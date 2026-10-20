import { randomUUID, timingSafeEqual } from "node:crypto";
import { ErrorLedger } from "../errores.ts";
import { sincronizarBtcpay, type ConfigSincronizacion, type RegistroSincronizacion } from "../sincronizar.ts";
import { createAlmacenSupabase } from "../almacen/supabase.ts";
import { createAlmacenDtesSupabase } from "../almacen/dtes.ts";
import { emitirPagados, LIMITE_EMISION_POR_SYNC } from "../emitir.ts";
import { btcpayDeEntorno, supabaseDeEntorno, type ConfigSupabaseWeb } from "./configuracion.ts";
import { soltarCandado, tomarCandado } from "./candado.ts";

// Keeps the ticket store up to date with BTCPay, at most once per throttle window. The last run is read from
// ledger_sincronizaciones: a row is written when a run starts (termino null) and completed when it ends.
// At most one run at a time holds the lease "sincronizar" (ledger_candados). After the import, the run emits the
// tax documents of the tickets still pagado (src/emitir.ts). Nothing here throws to the page.

export const UMBRAL_DEFECTO_MS = 60_000;
export const LIMITE_PAGINA_MS = 6_000;
// The lease outlives a normal run; a run that stops leaves it to expire.
export const SEGUNDOS_CANDADO = 120;
const NOMBRE_CANDADO = "sincronizar";

// What every visitor reads when a run fails. The cause goes to the server log, and to the owner's tablero.
export const MENSAJE_PUBLICO_ERROR = "No se pudo sincronizar con BTCPay. Probá más tarde.";

export type EstadoSincronizacion = {
  // When the last successful run finished, or null when there is none.
  ultima: Date | null;
  // The message for any visitor when the last run failed, or null.
  error: string | null;
  // The cause in plain Spanish. Only the owner sees it; never shown on the public tablero.
  detalle: string | null;
  // New tickets from this call. 0 when the call did not run BTCPay.
  nuevas: number;
  // Documents emitted (accepted by the simulated reception) and refused in this call. 0 when it did not run.
  emitidos: number;
  rechazados: number;
  // True when this call ran BTCPay, false when the last run was recent enough or another run holds the lease.
  corrio: boolean;
  // True when another run is in progress (it holds the lease, or it started a moment ago).
  enCurso: boolean;
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

type FilaRegistro = { id: number; empezo: string; termino: string | null; error: string | null };

export function detalleDeError(e: unknown): string {
  if (e instanceof ErrorLedger) return e.message;
  return e instanceof Error ? e.message : String(e);
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

// The newest row. With soloCorrectas, the newest run that finished without an error.
async function filaDeRegistro(sb: ConfigSupabaseWeb, f: typeof fetch, soloCorrectas: boolean): Promise<FilaRegistro | null> {
  const q = new URLSearchParams({ select: "id,empezo,termino,error", order: "empezo.desc", limit: "1" });
  if (soloCorrectas) {
    q.append("error", "is.null");
    q.append("termino", "not.is.null");
  }
  const r = await f(`${sb.url}/rest/v1/ledger_sincronizaciones?${q}`, { headers: cabeceras(sb), cache: "no-store" });
  if (!r.ok) throw new ErrorLedger(`No se pudo leer el registro de sincronización (HTTP ${r.status}).`);
  const lista = (await r.json()) as FilaRegistro[];
  return lista[0] ?? null;
}

// Writes the start of a run: empezo is set, termino is not. Returns the row id that the end completes.
async function abrirRegistro(sb: ConfigSupabaseWeb, f: typeof fetch, empezo: Date): Promise<number> {
  const r = await f(`${sb.url}/rest/v1/ledger_sincronizaciones`, {
    method: "POST",
    headers: { ...cabeceras(sb), "content-type": "application/json", prefer: "return=representation" },
    body: JSON.stringify({ empezo: empezo.toISOString(), origen: "btcpay" }),
    cache: "no-store",
  });
  if (!r.ok) throw new ErrorLedger(`No se pudo abrir el registro de sincronización (HTTP ${r.status}).`);
  const filas = (await r.json()) as { id: number }[];
  const id = filas[0]?.id;
  if (typeof id !== "number") throw new ErrorLedger("La base no devolvió el registro de sincronización abierto.");
  return id;
}

// Completes the row of a run: the end time, the counts and the error, if any.
async function cerrarRegistro(sb: ConfigSupabaseWeb, f: typeof fetch, id: number, fila: RegistroSincronizacion): Promise<void> {
  const { empezo: _empezo, ...cierre } = fila;
  const r = await f(`${sb.url}/rest/v1/ledger_sincronizaciones?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...cabeceras(sb), "content-type": "application/json", prefer: "return=minimal" },
    body: JSON.stringify(cierre),
    cache: "no-store",
  });
  if (!r.ok) throw new ErrorLedger(`No se pudo cerrar el registro de sincronización (HTTP ${r.status}).`);
}

// The finish time of the last successful run, or null.
async function ultimaOk(sb: ConfigSupabaseWeb, f: typeof fetch): Promise<Date | null> {
  const fila = await filaDeRegistro(sb, f, true);
  return fila && fila.termino ? new Date(fila.termino) : null;
}

// Runs the import and the emission. The lease is released when the work ends, even if the page stopped waiting.
async function correrSincronizacion(
  sb: ConfigSupabaseWeb,
  btc: ConfigSincronizacion,
  f: typeof fetch,
  ahora: Date,
  anterior: Date | null,
  idRegistro: number,
): Promise<EstadoSincronizacion> {
  let cerrado = false;
  // The log row is completed by the sync itself; a failure to write it must not hide the result.
  const registrar = (fila: RegistroSincronizacion) => {
    cerrado = true;
    return cerrarRegistro(sb, f, idRegistro, fila).catch((e: unknown) => {
      console.error("No se pudo cerrar el registro de sincronización:", e);
    });
  };
  try {
    const almacen = createAlmacenSupabase({ url: sb.url, clave: sb.clave, fetch: f });
    const dtes = createAlmacenDtesSupabase({ url: sb.url, clave: sb.clave, fetch: f });
    const r = await sincronizarBtcpay(
      almacen,
      { ...btc, fetch: f },
      {
        ahora,
        registrar,
        emitir: (almacenTickets) => emitirPagados(almacenTickets, dtes, { ahora, limite: LIMITE_EMISION_POR_SYNC }),
      },
    );
    return { ultima: new Date(), error: null, detalle: null, nuevas: r.nuevas, emitidos: r.emitidos ?? 0, rechazados: r.rechazados ?? 0, corrio: true, enCurso: false };
  } catch (e) {
    console.error("Sincronización con BTCPay:", detalleDeError(e));
    if (!cerrado) {
      await registrar({
        empezo: ahora.toISOString(),
        termino: new Date().toISOString(),
        nuevas: 0,
        repetidas: 0,
        omitidas: 0,
        error: detalleDeError(e).slice(0, 2000),
        origen: "btcpay",
      });
    }
    return { ultima: anterior, error: MENSAJE_PUBLICO_ERROR, detalle: detalleDeError(e), nuevas: 0, emitidos: 0, rechazados: 0, corrio: true, enCurso: false };
  }
}

function sinCorrer(ultima: Date | null, error: string | null, detalle: string | null, enCurso: boolean): EstadoSincronizacion {
  return { ultima, error, detalle, nuevas: 0, emitidos: 0, rechazados: 0, corrio: false, enCurso };
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
      return sinCorrer(null, MENSAJE_PUBLICO_ERROR, "Falta la configuración de la base de datos en el servidor.", false);
    }
    anterior = await ultimaOk(sb, f);
    const ultimo = await filaDeRegistro(sb, f, false);
    if (ultimo !== null && ahora.getTime() - new Date(ultimo.empezo).getTime() < umbralMs) {
      // A run still open (no termino) that started within the lease window is in progress, not finished.
      if (ultimo.termino === null && ahora.getTime() - new Date(ultimo.empezo).getTime() < SEGUNDOS_CANDADO * 1000) {
        return sinCorrer(anterior, null, null, true);
      }
      const ultima = ultimo.termino !== null && ultimo.error === null ? new Date(ultimo.termino) : anterior;
      return sinCorrer(ultima, ultimo.error === null ? null : MENSAJE_PUBLICO_ERROR, ultimo.error, false);
    }
    const btc = opciones.btcpay === undefined ? btcpayDeEntorno() : opciones.btcpay;
    if (btc === null) {
      return sinCorrer(anterior, MENSAJE_PUBLICO_ERROR, "Falta la configuración de BTCPay en el servidor.", false);
    }

    const dueno = randomUUID();
    const tomado = await tomarCandado({ url: sb.url, clave: sb.clave, fetch: f }, NOMBRE_CANDADO, dueno, SEGUNDOS_CANDADO);
    if (!tomado) return sinCorrer(anterior, null, null, true);

    const soltar = () =>
      soltarCandado({ url: sb.url, clave: sb.clave, fetch: f }, NOMBRE_CANDADO, dueno).catch((e: unknown) => {
        console.error("No se pudo soltar el candado de sincronización:", e);
      });

    let idRegistro: number;
    try {
      idRegistro = await abrirRegistro(sb, f, ahora);
    } catch (e) {
      await soltar();
      throw e;
    }

    const trabajo = correrSincronizacion(sb, btc, f, ahora, anterior, idRegistro).finally(soltar);
    if (limiteMs === null) return await trabajo;
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    const limite = new Promise<EstadoSincronizacion>((resolver) => {
      temporizador = setTimeout(
        () =>
          resolver({
            ultima: anterior,
            error: MENSAJE_PUBLICO_ERROR,
            detalle: `BTCPay tardó más de ${Math.round(limiteMs / 1000)} segundos. Se vuelve a intentar en la próxima visita.`,
            nuevas: 0,
            emitidos: 0,
            rechazados: 0,
            corrio: true,
            enCurso: false,
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
    console.error("Sincronización con BTCPay:", detalleDeError(e));
    return sinCorrer(anterior, MENSAJE_PUBLICO_ERROR, detalleDeError(e), false);
  }
}
