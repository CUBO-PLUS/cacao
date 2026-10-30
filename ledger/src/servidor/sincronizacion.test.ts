import { test } from "node:test";
import assert from "node:assert/strict";
import { cerrarInterrumpidas, MENSAJE_INTERRUMPIDA } from "./sincronizacion.ts";

// The database is faked: the code only asks for the rows and reads the answer.

const SB = { url: "https://proyecto.test", clave: "clave-prueba" };
const AHORA = new Date("2026-10-15T18:00:00.000Z");

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
