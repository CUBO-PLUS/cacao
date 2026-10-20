import { test } from "node:test";
import assert from "node:assert/strict";
import { ErrorLedger } from "./errores.ts";
import { correlativosSupabase } from "./correlativos-supabase.ts";

test("tomarCorrelativo calls ledger_siguiente_correlativo with the serie and returns the number it gives", async () => {
  const llamadas: { url: string; cuerpo: unknown; clave: string | undefined }[] = [];
  const f = (async (entrada: string | URL | Request, init?: RequestInit) => {
    llamadas.push({
      url: String(entrada),
      cuerpo: JSON.parse(String(init?.body)),
      clave: (init?.headers as Record<string, string> | undefined)?.apikey,
    });
    return new Response("7", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const fuente = correlativosSupabase({ url: "https://proyecto.supabase.co/", clave: "clave-de-prueba", fetch: f });
  assert.equal(await fuente.tomarCorrelativo("01-M001P001"), 7);
  assert.equal(llamadas[0]?.url, "https://proyecto.supabase.co/rest/v1/rpc/ledger_siguiente_correlativo");
  assert.deepEqual(llamadas[0]?.cuerpo, { p_serie: "01-M001P001" });
  assert.equal(llamadas[0]?.clave, "clave-de-prueba");
});

test("a refused call or an invalid number is a readable error, not a silent zero", async () => {
  const caido = (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
  await assert.rejects(
    correlativosSupabase({ url: "https://proyecto.supabase.co", clave: "k", fetch: caido }).tomarCorrelativo("01-M001P001"),
    (e: unknown) => e instanceof ErrorLedger && /No se pudo tomar el correlativo de la serie 01-M001P001/.test(e.message),
  );

  const cero = (async () => new Response("0", { status: 200 })) as unknown as typeof fetch;
  await assert.rejects(
    correlativosSupabase({ url: "https://proyecto.supabase.co", clave: "k", fetch: cero }).tomarCorrelativo("01-M001P001"),
    (e: unknown) => e instanceof ErrorLedger && /correlativo inválido/.test(e.message),
  );
});
