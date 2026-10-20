import { test } from "node:test";
import assert from "node:assert/strict";
import { createAlmacenDtesSupabase, type RegistroDte } from "./dtes.ts";

// The documents table through PostgREST: the reservation is one rpc, the completion writes only a reserved row.

const CODIGO = "9A1B2C3D-0000-4000-8000-000000000003";
const TICKET = "TK-20261013-0002";

function falso(respuestas: { cuerpo: unknown; status?: number }[]) {
  const llamadas: { url: string; metodo: string; cuerpo: unknown }[] = [];
  const f = (async (entrada: string | URL | Request, init?: RequestInit) => {
    llamadas.push({ url: String(entrada), metodo: init?.method ?? "GET", cuerpo: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = respuestas.shift() ?? { cuerpo: null };
    return new Response(r.cuerpo === undefined ? "" : JSON.stringify(r.cuerpo), { status: r.status ?? 200 });
  }) as typeof fetch;
  return { fetch: f, llamadas };
}

const CONFIG = { url: "https://proyecto.test", clave: "clave-prueba" };

test("reservar calls the reservation function with the ticket, the serie, the type and the code, and returns the number", async () => {
  const { fetch, llamadas } = falso([{ cuerpo: 7 }]);
  const almacen = createAlmacenDtesSupabase({ ...CONFIG, fetch });
  const n = await almacen.reservar({ ticketId: TICKET, serie: "01-M001P001", tipoDte: "01", codigoGeneracion: CODIGO });
  assert.equal(n, 7);
  assert.equal(llamadas[0]?.url, "https://proyecto.test/rest/v1/rpc/ledger_reservar_dte");
  assert.deepEqual(llamadas[0]?.cuerpo, { p_ticket: TICKET, p_serie: "01-M001P001", p_tipo: "01", p_codigo: CODIGO });
});

test("a ticket that already has a row gets null from reservar: no number is returned", async () => {
  const { fetch } = falso([{ cuerpo: null }]);
  const almacen = createAlmacenDtesSupabase({ ...CONFIG, fetch });
  assert.equal(await almacen.reservar({ ticketId: TICKET, serie: "01-M001P001", tipoDte: "01", codigoGeneracion: CODIGO }), null);
});

test("a reservation answer that is not a positive whole number is refused", async () => {
  const { fetch } = falso([{ cuerpo: 0 }]);
  const almacen = createAlmacenDtesSupabase({ ...CONFIG, fetch });
  await assert.rejects(almacen.reservar({ ticketId: TICKET, serie: "01-M001P001", tipoDte: "01", codigoGeneracion: CODIGO }), /correlativo inválido/);
});

test("completar writes only the reserved row of that code, and says true when it did", async () => {
  const { fetch, llamadas } = falso([{ cuerpo: [{ codigo_generacion: CODIGO }] }]);
  const almacen = createAlmacenDtesSupabase({ ...CONFIG, fetch });
  const registro: RegistroDte = {
    codigoGeneracion: CODIGO,
    ticketId: TICKET,
    tipoDte: "01",
    numeroControl: "DTE-01-M001P001-000000000000007",
    ambiente: "00",
    estado: "aceptado",
    sello: "SIMULADO-0000",
    motivo: null,
    documento: { identificacion: {} },
    creado: "2026-10-13T13:40:00.000Z",
    correlativo: 7,
  };
  assert.equal(await almacen.completar(registro), true);
  const url = new URL(llamadas[0]?.url ?? "");
  assert.equal(url.searchParams.get("codigo_generacion"), `eq.${CODIGO}`);
  assert.equal(url.searchParams.get("estado"), "eq.reservado");
  assert.equal(llamadas[0]?.metodo, "PATCH");
});

test("completar says false when the row is no longer reserved: nothing was written", async () => {
  const { fetch } = falso([{ cuerpo: [] }]);
  const almacen = createAlmacenDtesSupabase({ ...CONFIG, fetch });
  const registro: RegistroDte = {
    codigoGeneracion: CODIGO,
    ticketId: TICKET,
    tipoDte: "01",
    numeroControl: "DTE-01-M001P001-000000000000007",
    ambiente: "00",
    estado: "rechazado",
    sello: null,
    motivo: "x",
    documento: {},
    creado: "2026-10-13T13:40:00.000Z",
    correlativo: 7,
  };
  assert.equal(await almacen.completar(registro), false);
});

test("a control number already in use is reported in plain words", async () => {
  const { fetch } = falso([{ cuerpo: { message: "duplicate key" }, status: 409 }]);
  const almacen = createAlmacenDtesSupabase({ ...CONFIG, fetch });
  const registro: RegistroDte = {
    codigoGeneracion: CODIGO,
    ticketId: TICKET,
    tipoDte: "01",
    numeroControl: "DTE-01-M001P001-000000000000007",
    ambiente: "00",
    estado: "aceptado",
    sello: "SIMULADO-0000",
    motivo: null,
    documento: {},
    creado: "2026-10-13T13:40:00.000Z",
    correlativo: 7,
  };
  await assert.rejects(almacen.completar(registro), /ya está en otro documento/);
});
