import { test } from "node:test";
import assert from "node:assert/strict";
import { crearUrlBtcpay } from "./url-btcpay.ts";

// Supabase is faked: the resolver is tested through its cache, its fallback and its validation.

const SUPABASE = { SUPABASE_URL: "https://proyecto.supabase.test", SUPABASE_SERVICE_ROLE_KEY: "clave-prueba" };

function reloj() {
  let ms = 1_000_000;
  return { ahora: () => ms, avanzar: (cuanto: number) => (ms += cuanto) };
}

function respuesta(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status: estado });
}

test("the address from Supabase is used and cached for 30 seconds", async () => {
  const llamadas: string[] = [];
  const f = (async (entrada: string | URL | Request) => {
    llamadas.push(String(entrada));
    return respuesta("https://nueva.trycloudflare.com/");
  }) as typeof fetch;
  const t = reloj();
  const urlBtcpay = crearUrlBtcpay({ entorno: () => ({ ...SUPABASE }), fetch: f, ahora: t.ahora });

  assert.equal(await urlBtcpay(), "https://nueva.trycloudflare.com");
  assert.equal(await urlBtcpay(), "https://nueva.trycloudflare.com");
  assert.equal(llamadas.length, 1, "the second read is served from the cache");
  assert.equal(llamadas[0], "https://proyecto.supabase.test/rest/v1/rpc/url_btcpay");

  t.avanzar(30_000);
  assert.equal(await urlBtcpay(), "https://nueva.trycloudflare.com");
  assert.equal(llamadas.length, 2, "after 30 seconds Supabase is asked again");
});

test("a failed read falls back to LEDGER_BTCPAY_URL, and the failure is remembered for 10 seconds", async () => {
  let llamadas = 0;
  const f = (async () => {
    llamadas++;
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  const t = reloj();
  const urlBtcpay = crearUrlBtcpay({
    entorno: () => ({ ...SUPABASE, LEDGER_BTCPAY_URL: "https://respaldo.example.test/" }),
    fetch: f,
    ahora: t.ahora,
  });

  assert.equal(await urlBtcpay(), "https://respaldo.example.test");
  assert.equal(await urlBtcpay(), "https://respaldo.example.test");
  assert.equal(llamadas, 1);

  t.avanzar(10_000);
  assert.equal(await urlBtcpay(), "https://respaldo.example.test");
  assert.equal(llamadas, 2);
});

test("an error status from Supabase falls back to the environment", async () => {
  const f = (async () => respuesta({ message: "permission denied" }, 401)) as typeof fetch;
  const urlBtcpay = crearUrlBtcpay({
    entorno: () => ({ ...SUPABASE, LEDGER_BTCPAY_URL: "https://respaldo.example.test" }),
    fetch: f,
  });
  assert.equal(await urlBtcpay(), "https://respaldo.example.test");
});

test("a value that is not an http(s) origin is refused and the environment is used", async () => {
  const f = (async () => respuesta("https://btcpay.test/ruta-no-permitida")) as typeof fetch;
  const urlBtcpay = crearUrlBtcpay({
    entorno: () => ({ ...SUPABASE, LEDGER_BTCPAY_URL: "https://respaldo.example.test" }),
    fetch: f,
  });
  assert.equal(await urlBtcpay(), "https://respaldo.example.test");
});

test("a value that is not a string is refused and the environment is used", async () => {
  const f = (async () => respuesta({ url: "https://btcpay.test" })) as typeof fetch;
  const urlBtcpay = crearUrlBtcpay({
    entorno: () => ({ ...SUPABASE, LEDGER_BTCPAY_URL: "https://respaldo.example.test" }),
    fetch: f,
  });
  assert.equal(await urlBtcpay(), "https://respaldo.example.test");
});

test("null when Supabase has no address and the environment has none either", async () => {
  const f = (async () => respuesta(null)) as typeof fetch;
  const urlBtcpay = crearUrlBtcpay({ entorno: () => ({ ...SUPABASE, LEDGER_BTCPAY_URL: "" }), fetch: f });
  assert.equal(await urlBtcpay(), null);
});

test("without Supabase configured the environment is used and Supabase is never asked", async () => {
  let llamadas = 0;
  const f = (async () => {
    llamadas++;
    return respuesta("https://nueva.trycloudflare.com");
  }) as typeof fetch;
  const urlBtcpay = crearUrlBtcpay({ entorno: () => ({ LEDGER_BTCPAY_URL: "https://respaldo.example.test" }), fetch: f });
  assert.equal(await urlBtcpay(), "https://respaldo.example.test");
  assert.equal(llamadas, 0);
});
