import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cerrarInterrumpidas,
  leerEstadoSincronizacion,
  lineaSincronizacion,
  MENSAJE_INTERRUMPIDA,
  MENSAJE_PUBLICO_ERROR,
  sincronizarSiHaceFalta,
  type LecturaSincronizacion,
} from "./sincronizacion.ts";
import type { ConfigSincronizacion } from "../sincronizar.ts";

// The database is faked: the code only asks for the rows and reads the answer.

const SB = { url: "https://proyecto.test", clave: "clave-prueba" };
const AHORA = new Date("2026-10-15T18:00:00.000Z");
const BTC = { url: "https://btcpay.test" } as unknown as ConfigSincronizacion;

type Llamada = { url: string; metodo: string; cuerpo: Record<string, unknown> };

function bdFalsa(respuesta: unknown, status = 200): { fetch: typeof fetch; llamadas: Llamada[] } {
  const llamadas: Llamada[] = [];
  const f = (async (entrada: string | URL | Request, init?: RequestInit) => {
    llamadas.push({
      url: String(entrada),
      metodo: init?.method ?? "GET",
      cuerpo: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return new Response(JSON.stringify(respuesta), { status });
  }) as typeof fetch;
  return { fetch: f, llamadas };
}

// Answers the two reads of the state: the newest good run (error is.null) and the newest row of any kind.
function bdLectura(ultimo: unknown[], ultimaOk: unknown[]): { fetch: typeof fetch; llamadas: Llamada[] } {
  const llamadas: Llamada[] = [];
  const f = (async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = String(entrada);
    llamadas.push({ url, metodo: init?.method ?? "GET", cuerpo: {} });
    return new Response(JSON.stringify(url.includes("error=is.null") ? ultimaOk : ultimo), { status: 200 });
  }) as typeof fetch;
  return { fetch: f, llamadas };
}

const hace = (segundos: number) => new Date(AHORA.getTime() - segundos * 1000).toISOString();

test("an open run older than the lease is closed with its end time and the interrupted message", async () => {
  const { fetch, llamadas } = bdFalsa([{ id: 7 }]);
  const cerrados = await cerrarInterrumpidas(SB, fetch, AHORA);

  assert.equal(cerrados, 1);
  const llamada = llamadas[0];
  assert.equal(llamada?.metodo, "PATCH");
  const url = new URL(llamada?.url ?? "");
  assert.equal(url.pathname, "/rest/v1/ledger_sincronizaciones");
  assert.equal(url.searchParams.get("termino"), "is.null");
  // 120 seconds before the clock: the lease length.
  assert.equal(url.searchParams.get("empezo"), "lt.2026-10-15T17:58:00.000Z");
  assert.deepEqual(llamada?.cuerpo, { termino: AHORA.toISOString(), error: MENSAJE_INTERRUMPIDA });
  assert.equal(MENSAJE_INTERRUMPIDA, "Interrumpida por el límite de tiempo");
});

test("a failed close is logged and counted as none, so the run that follows is not stopped", async (t) => {
  t.mock.method(console, "error", () => {});
  const { fetch } = bdFalsa({ message: "x" }, 500);
  assert.equal(await cerrarInterrumpidas(SB, fetch, AHORA), 0);
});

test("the visitor reads only the calm line, even when the last run failed", () => {
  const lectura: LecturaSincronizacion = {
    ultima: new Date(AHORA.getTime() - 5 * 60_000),
    error: MENSAJE_PUBLICO_ERROR,
    detalle: "BTCPay respondió 500",
    enCurso: false,
    debeCorrer: false,
  };
  const linea = lineaSincronizacion(lectura, AHORA, false);
  assert.equal(linea, "Actualizado hace 5 min");
  assert.doesNotMatch(linea, /falló|Motivo|BTCPay respondió/);
});

test("with no good run yet, the visitor sees a calm line without an error", () => {
  const lectura: LecturaSincronizacion = { ultima: null, error: null, detalle: null, enCurso: false, debeCorrer: true };
  assert.equal(lineaSincronizacion(lectura, AHORA, false), "Todavía no se actualizó con BTCPay.");
});

test("the owner reads the cause in plain words when the last run failed, with the last good run", () => {
  const lectura: LecturaSincronizacion = {
    ultima: new Date(AHORA.getTime() - 3 * 3_600_000),
    error: MENSAJE_PUBLICO_ERROR,
    detalle: "Falta la configuración de BTCPay en el servidor.",
    enCurso: false,
    debeCorrer: false,
  };
  assert.equal(
    lineaSincronizacion(lectura, AHORA, true),
    "La última sincronización con BTCPay falló. Motivo: Falta la configuración de BTCPay en el servidor. Último éxito hace 3 h.",
  );
});

test("the owner sees a normal run as the calm line too", () => {
  const lectura: LecturaSincronizacion = { ultima: new Date(AHORA.getTime() - 90_000), error: null, detalle: null, enCurso: false, debeCorrer: false };
  assert.equal(lineaSincronizacion(lectura, AHORA, true), "Actualizado hace 1 min");
});

test("reading the state never calls BTCPay or writes, and a run is due when the last one is old", async () => {
  const { fetch, llamadas } = bdLectura([{ id: 3, empezo: hace(600), termino: hace(590), error: null }], [{ termino: hace(590), error: null }]);
  const lectura = await leerEstadoSincronizacion({ ahora: AHORA, supabase: SB, btcpay: BTC, fetch });
  assert.equal(lectura.debeCorrer, true);
  assert.equal(lectura.error, null);
  assert.equal(lectura.enCurso, false);
  assert.ok(llamadas.every((l) => l.metodo === "GET" && l.url.includes("/rest/v1/ledger_sincronizaciones")));
});

test("a failed last run shows its error to the owner's line and is still read only", async () => {
  const { fetch, llamadas } = bdLectura(
    [{ id: 4, empezo: hace(900), termino: hace(890), error: "HTTP 500 de BTCPay" }],
    [{ termino: hace(3600), error: null }],
  );
  const lectura = await leerEstadoSincronizacion({ ahora: AHORA, supabase: SB, btcpay: BTC, fetch });
  assert.equal(lectura.error, MENSAJE_PUBLICO_ERROR);
  assert.equal(lectura.detalle, "HTTP 500 de BTCPay");
  assert.equal(lectura.debeCorrer, true);
  assert.equal(lectura.ultima?.toISOString(), hace(3600));
  assert.ok(llamadas.every((l) => l.metodo === "GET"));
});

test("a run that started inside the lease window is in progress, not due", async () => {
  const { fetch } = bdLectura([{ id: 5, empezo: hace(30), termino: null, error: null }], []);
  const lectura = await leerEstadoSincronizacion({ ahora: AHORA, supabase: SB, btcpay: BTC, fetch });
  assert.equal(lectura.enCurso, true);
  assert.equal(lectura.debeCorrer, false);
});

test("a recent run is not repeated: the sync returns the stored state and makes no write", async () => {
  const { fetch, llamadas } = bdLectura([{ id: 6, empezo: hace(10), termino: hace(5), error: null }], [{ termino: hace(5), error: null }]);
  const estado = await sincronizarSiHaceFalta({ ahora: AHORA, supabase: SB, btcpay: BTC, fetch });
  assert.equal(estado.corrio, false);
  assert.equal(estado.error, null);
  assert.ok(llamadas.every((l) => l.metodo === "GET"));
});

test("the sync reports a missing BTCPay setting to the owner's line without calling BTCPay", async () => {
  const { fetch, llamadas } = bdLectura([], []);
  const lectura = await leerEstadoSincronizacion({ ahora: AHORA, supabase: SB, btcpay: null, fetch });
  assert.equal(lectura.debeCorrer, false);
  assert.equal(lectura.detalle, "Falta la configuración de BTCPay en el servidor.");
  assert.ok(llamadas.every((l) => l.metodo === "GET"));
});
