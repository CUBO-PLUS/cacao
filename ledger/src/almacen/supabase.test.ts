import { test } from "node:test";
import assert from "node:assert/strict";
import { entradaConsumidor } from "../ayudas-prueba.ts";
import { ErrorLedger } from "../errores.ts";
import { crearTicket, type Ticket } from "../ticket.ts";
import { createAlmacenSupabase } from "./supabase.ts";

const URL_BASE = "https://proyecto.supabase.co/";
const CLAVE = "clave-de-servicio-de-prueba";
const TICKET: Ticket = crearTicket(entradaConsumidor(), new Date("2026-10-15T18:00:00Z"), "TK-20261015-0001");

type Llamada = { url: URL; metodo: string; cabeceras: Record<string, string>; cuerpo: unknown };

// A fake fetch: records every call and answers with what the test gives it.
function falso(responder: (llamada: Llamada) => Response | Promise<Response>): { f: typeof fetch; llamadas: Llamada[] } {
  const llamadas: Llamada[] = [];
  const f = (async (entrada: string | URL | Request, init?: RequestInit) => {
    const cabeceras = { ...(init?.headers as Record<string, string> | undefined) };
    const llamada: Llamada = {
      url: new URL(String(entrada)),
      metodo: init?.method ?? "GET",
      cabeceras,
      cuerpo: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    llamadas.push(llamada);
    return responder(llamada);
  }) as typeof fetch;
  return { f, llamadas };
}

const json = (cuerpo: unknown, status = 200): Response =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });

test("guardar calls the ledger_guardar_ticket function with the service key and the ticket as JSON", async () => {
  const { f, llamadas } = falso(() => json({ id: TICKET.id }));
  const almacen = createAlmacenSupabase({ url: URL_BASE, clave: CLAVE, fetch: f });
  await almacen.guardar(TICKET);
  assert.equal(llamadas.length, 1);
  const [l] = llamadas;
  assert.ok(l);
  assert.equal(l.url.toString(), "https://proyecto.supabase.co/rest/v1/rpc/ledger_guardar_ticket");
  assert.equal(l.metodo, "POST");
  assert.equal(l.cabeceras.apikey, CLAVE);
  assert.equal(l.cabeceras.authorization, `Bearer ${CLAVE}`);
  assert.equal(l.cabeceras["content-type"], "application/json");
  assert.deepEqual(l.cuerpo, { p_ticket: JSON.parse(JSON.stringify(TICKET)) });
});

test("a refused duplicate comes back as its DUPLICADO message, and other failures name the status", async () => {
  const mensaje = "DUPLICADO: el pago ya cubre el ticket TK-20261015-0009.";
  const dup = createAlmacenSupabase({ url: URL_BASE, clave: CLAVE, fetch: falso(() => json({ message: mensaje, code: "P0001" }, 400)).f });
  await assert.rejects(dup.guardar(TICKET), (e: unknown) => e instanceof ErrorLedger && e.message === mensaje);

  const caido = createAlmacenSupabase({ url: URL_BASE, clave: CLAVE, fetch: falso(() => json({ message: "boom" }, 500)).f });
  await assert.rejects(caido.guardar(TICKET), (e: unknown) => e instanceof ErrorLedger && /HTTP 500/.test(e.message));
});

test("a network failure becomes a readable error, not a raw fetch error", async () => {
  const roto = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  const almacen = createAlmacenSupabase({ url: URL_BASE, clave: CLAVE, fetch: roto });
  await assert.rejects(almacen.porId(TICKET.id), (e: unknown) => e instanceof ErrorLedger && /No se pudo conectar/.test(e.message));
});

test("porId reads the datos column of one row by id, and returns null when there is none", async () => {
  const { f, llamadas } = falso((l) => json(l.url.searchParams.get("id") === `eq.${TICKET.id}` ? [{ datos: TICKET }] : []));
  const almacen = createAlmacenSupabase({ url: `${URL_BASE}`, clave: CLAVE, fetch: f });
  assert.deepEqual(await almacen.porId(TICKET.id), JSON.parse(JSON.stringify(TICKET)));
  const [l] = llamadas;
  assert.ok(l);
  assert.equal(l.url.pathname, "/rest/v1/ledger_tickets");
  assert.equal(l.url.searchParams.get("select"), "datos");
  assert.equal(l.url.searchParams.get("limit"), "1");
  assert.equal(l.metodo, "GET");
  assert.equal(l.cabeceras.apikey, CLAVE);
  assert.equal(await almacen.porId("TK-20261015-9999"), null);
});

test("an id with the wrong shape is refused without calling the server", async () => {
  const { f, llamadas } = falso(() => json([]));
  const almacen = createAlmacenSupabase({ url: URL_BASE, clave: CLAVE, fetch: f });
  assert.equal(await almacen.porId("TK-2026-1"), null);
  assert.equal(llamadas.length, 0);
});

test("porOrigen and porHash filter by origin and payment hash", async () => {
  const { f, llamadas } = falso(() => json([]));
  const almacen = createAlmacenSupabase({ url: URL_BASE, clave: CLAVE, fetch: f });
  assert.equal(await almacen.porOrigen("btcpay", "Inv 1"), null);
  assert.equal(await almacen.porHash("ab".repeat(32)), null);
  const [origen, hash] = llamadas;
  assert.equal(origen?.url.searchParams.get("origen_plataforma"), "eq.btcpay");
  assert.equal(origen?.url.searchParams.get("origen_numero"), "eq.Inv 1");
  assert.equal(hash?.url.searchParams.get("payment_hash"), `eq.${"ab".repeat(32)}`);
});

test("listar builds the filters, order, limit and keyset cursor", async () => {
  const { f, llamadas } = falso(() => json([{ datos: TICKET }]));
  const almacen = createAlmacenSupabase({ url: URL_BASE, clave: CLAVE, fetch: f });
  const lista = await almacen.listar({
    desde: new Date("2026-10-01T06:00:00.000Z"),
    hasta: new Date("2026-11-01T06:00:00.000Z"),
    producto: "media",
    estado: "emitido",
    texto: "a*b(c)",
    limite: 20,
    despues: "2026-10-10T12:00:00.000Z",
  });
  assert.deepEqual(lista, [JSON.parse(JSON.stringify(TICKET))]);
  const [l] = llamadas;
  assert.ok(l);
  assert.equal(l.url.pathname, "/rest/v1/ledger_tickets");
  assert.equal(l.url.searchParams.get("select"), "datos");
  assert.equal(l.url.searchParams.get("order"), "creado_en.desc");
  assert.equal(l.url.searchParams.get("limit"), "20");
  assert.deepEqual(l.url.searchParams.getAll("creado_en"), [
    "gte.2026-10-01T06:00:00.000Z",
    "lt.2026-11-01T06:00:00.000Z",
    "lt.2026-10-10T12:00:00.000Z",
  ]);
  assert.equal(l.url.searchParams.get("producto"), "eq.media");
  assert.equal(l.url.searchParams.get("estado"), "eq.emitido");
  assert.equal(l.url.searchParams.get("buscar"), "ilike.*a b c*");
});

test("the page size defaults to 50 and stops at 500; a zero or a bad cursor is refused before any call", async () => {
  const { f, llamadas } = falso(() => json([]));
  const almacen = createAlmacenSupabase({ url: URL_BASE, clave: CLAVE, fetch: f });
  await almacen.listar();
  await almacen.listar({ limite: 9000 });
  assert.equal(llamadas[0]?.url.searchParams.get("limit"), "50");
  assert.equal(llamadas[1]?.url.searchParams.get("limit"), "500");
  await assert.rejects(almacen.listar({ limite: 0 }), ErrorLedger);
  await assert.rejects(almacen.listar({ despues: "no es fecha" }), ErrorLedger);
  assert.equal(llamadas.length, 2);
});

test("a failed read names the status", async () => {
  const almacen = createAlmacenSupabase({ url: URL_BASE, clave: CLAVE, fetch: falso(() => json({ message: "x" }, 503)).f });
  await assert.rejects(almacen.listar(), (e: unknown) => e instanceof ErrorLedger && /HTTP 503/.test(e.message));
});

test("a trailing slash in the project address does not double the path", async () => {
  const { f, llamadas } = falso(() => json([]));
  const almacen = createAlmacenSupabase({ url: "https://proyecto.supabase.co///", clave: CLAVE, fetch: f });
  await almacen.listar();
  const l = llamadas[0];
  assert.ok(l);
  assert.equal(`${l.url.origin}${l.url.pathname}`, "https://proyecto.supabase.co/rest/v1/ledger_tickets");
});
