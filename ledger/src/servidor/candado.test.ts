import { test } from "node:test";
import assert from "node:assert/strict";
import { soltarCandado, tomarCandado } from "./candado.ts";

// The lease rpc is faked: the database decides, the code only asks and reads the answer.

type Llamada = { url: string; cuerpo: Record<string, unknown> };

function rpcFalsa(respuestas: unknown[], status = 200): { fetch: typeof fetch; llamadas: Llamada[] } {
  const llamadas: Llamada[] = [];
  const f = (async (entrada: string | URL | Request, init?: RequestInit) => {
    llamadas.push({ url: String(entrada), cuerpo: JSON.parse(String(init?.body)) as Record<string, unknown> });
    const siguiente = respuestas.shift();
    return new Response(JSON.stringify(siguiente), { status });
  }) as typeof fetch;
  return { fetch: f, llamadas };
}

const CONFIG = { url: "https://proyecto.test/", clave: "clave-prueba" };

test("the lease is taken with its name, owner and seconds, and the call says true when it was free", async () => {
  const { fetch, llamadas } = rpcFalsa([true]);
  const tomado = await tomarCandado({ ...CONFIG, fetch }, "sincronizar", "dueno-1", 120);
  assert.equal(tomado, true);
  assert.equal(llamadas[0]?.url, "https://proyecto.test/rest/v1/rpc/ledger_tomar_candado");
  assert.deepEqual(llamadas[0]?.cuerpo, { p_nombre: "sincronizar", p_dueno: "dueno-1", p_segundos: 120 });
});

test("a lease held by another run and not expired is refused: the second caller gets false", async () => {
  const { fetch } = rpcFalsa([false]);
  assert.equal(await tomarCandado({ ...CONFIG, fetch }, "sincronizar", "dueno-2", 120), false);
});

test("a database that does not answer true is never read as a lease", async () => {
  const { fetch } = rpcFalsa([null]);
  assert.equal(await tomarCandado({ ...CONFIG, fetch }, "sincronizar", "dueno-3", 120), false);
});

test("a failed lease call is an error, not a free lease", async () => {
  const { fetch } = rpcFalsa([{ message: "x" }], 500);
  await assert.rejects(tomarCandado({ ...CONFIG, fetch }, "sincronizar", "dueno-4", 120), /HTTP 500/);
});

test("the holder releases its lease; the release says false when the lease was not theirs", async () => {
  const { fetch, llamadas } = rpcFalsa([true, false]);
  assert.equal(await soltarCandado({ ...CONFIG, fetch }, "sincronizar", "dueno-1"), true);
  assert.equal(await soltarCandado({ ...CONFIG, fetch }, "sincronizar", "otro"), false);
  assert.equal(llamadas[0]?.url, "https://proyecto.test/rest/v1/rpc/ledger_soltar_candado");
  assert.deepEqual(llamadas[1]?.cuerpo, { p_nombre: "sincronizar", p_dueno: "otro" });
});
