import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { entradaConsumidor } from "../ayudas-prueba.ts";
import { ErrorLedger } from "../errores.ts";
import { pagoEfectivo } from "../pagos/efectivo.ts";
import type { Pago } from "../pagos/tipos.ts";
import { crearTicket, registrarPago, totalDeTicket, type OrigenTicket, type Ticket } from "../ticket.ts";
import { almacenArchivos } from "./archivos.ts";
import { limiteDe, LIMITE_DEFECTO, LIMITE_MAXIMO, textoDeBusqueda } from "./tipos.ts";

function conDatos(fn: (datos: string) => Promise<void>): Promise<void> {
  const datos = mkdtempSync(join(tmpdir(), "ledger-almacen-"));
  return fn(datos).finally(() => rmSync(datos, { recursive: true, force: true }));
}

// The 16 hex digits of the id, padded to 64: a distinct, valid payment hash per ticket.
function hashDe(id: string): string {
  return id.slice(-4).padStart(64, "0");
}

// A paid consumer ticket. Cash by default; lightning when asked, with its own hash.
function pagado(id: string, momento: Date, opciones: { lightning?: boolean; origen?: OrigenTicket; descripcion?: string } = {}): Ticket {
  const entrada = entradaConsumidor();
  if (opciones.descripcion) entrada.lineas[0] = { ...entrada.lineas[0]!, descripcion: opciones.descripcion };
  const abierto = crearTicket(entrada, momento, id);
  const total = totalDeTicket(abierto).totalCentavos;
  const pago: Pago = opciones.lightning
    ? {
        rail: "lightning",
        montoCentavos: total,
        momento: momento.toISOString(),
        sats: 1000,
        tasaUsdPorBtc: "36940.18",
        tasaFuente: "prueba",
        paymentHash: hashDe(id),
        idTransaccion: `t-${id}`,
      }
    : pagoEfectivo(total, momento);
  const t = registrarPago(abierto, pago, momento);
  return opciones.origen ? { ...t, origen: opciones.origen } : t;
}

const AHORA = new Date("2026-10-15T18:00:00.000Z");

test("a saved ticket comes back whole by id, origin and payment hash", () =>
  conDatos(async (datos) => {
    const almacen = almacenArchivos(datos);
    const t = pagado("TK-20261015-0001", AHORA, { lightning: true, origen: { plataforma: "btcpay", producto: "media", numero: "Inv1" } });
    await almacen.guardar(t);
    assert.deepEqual(await almacen.porId("TK-20261015-0001"), t);
    assert.deepEqual(await almacen.porOrigen("btcpay", "Inv1"), t);
    assert.deepEqual(await almacen.porHash(hashDe("TK-20261015-0001")), t);
    assert.equal(await almacen.porOrigen("btcpay", "otra"), null);
    assert.equal(await almacen.porHash("f".repeat(64)), null);
    assert.equal(await almacen.porId("TK-20261015-9999"), null);
    assert.equal(await almacen.porId("no-es-id"), null);
  }));

test("a second ticket with the same origin or payment hash is refused as DUPLICADO and nothing is written", () =>
  conDatos(async (datos) => {
    const almacen = almacenArchivos(datos);
    const origen: OrigenTicket = { plataforma: "btcpay", producto: "pay", numero: "InvX" };
    await almacen.guardar(pagado("TK-20261015-0001", AHORA, { lightning: true, origen }));
    await assert.rejects(
      almacen.guardar(pagado("TK-20261015-0002", AHORA, { origen })),
      (e: unknown) => e instanceof ErrorLedger && e.message === "DUPLICADO: el origen btcpay InvX ya está en el ticket TK-20261015-0001.",
    );
    // Same payment hash as ticket 0001, different id and no origin.
    const otroPago = pagado("TK-20261015-0003", AHORA, { lightning: true });
    const mismoHash = { ...otroPago, pago: { ...otroPago.pago!, paymentHash: hashDe("TK-20261015-0001") } } as Ticket;
    await assert.rejects(
      almacen.guardar(mismoHash),
      (e: unknown) => e instanceof ErrorLedger && e.message === "DUPLICADO: el pago ya cubre el ticket TK-20261015-0001.",
    );
    assert.equal(await almacen.porId("TK-20261015-0002"), null);
    assert.equal(await almacen.porId("TK-20261015-0003"), null);
  }));

test("saving the same ticket id again replaces it", () =>
  conDatos(async (datos) => {
    const almacen = almacenArchivos(datos);
    const t = pagado("TK-20261015-0001", AHORA, { lightning: true });
    await almacen.guardar(t);
    await almacen.guardar(pagado("TK-20261015-0001", AHORA, { lightning: true, descripcion: "Otra descripción" }));
    assert.equal((await almacen.porId("TK-20261015-0001"))?.lineas[0]?.descripcion, "Otra descripción");
    assert.equal((await almacen.listar()).length, 1);
  }));

test("listar returns newest first and filters by time, product, state and text", () =>
  conDatos(async (datos) => {
    const almacen = almacenArchivos(datos);
    await almacen.guardar(pagado("TK-20261013-0001", new Date("2026-10-13T15:00:00Z"), { descripcion: "Pupusas de loroco" }));
    await almacen.guardar(pagado("TK-20261014-0002", new Date("2026-10-14T15:00:00Z"), { origen: { plataforma: "cacaomarket", numero: "1042" } }));
    await almacen.guardar(pagado("TK-20261015-0003", new Date("2026-10-15T15:00:00Z"), { lightning: true, origen: { plataforma: "btcpay", producto: "travel", numero: "Inv3" } }));
    await almacen.guardar({ ...crearTicket(entradaConsumidor(), AHORA, "TK-20261015-0004") });

    const todos = await almacen.listar();
    assert.deepEqual(todos.map((t) => t.id), ["TK-20261015-0004", "TK-20261015-0003", "TK-20261014-0002", "TK-20261013-0001"]);

    const desde = await almacen.listar({ desde: new Date("2026-10-14T00:00:00Z") });
    assert.deepEqual(desde.map((t) => t.id), ["TK-20261015-0004", "TK-20261015-0003", "TK-20261014-0002"]);
    const hasta = await almacen.listar({ hasta: new Date("2026-10-14T15:00:00Z") });
    assert.deepEqual(hasta.map((t) => t.id), ["TK-20261013-0001"]);

    assert.deepEqual((await almacen.listar({ producto: "travel" })).map((t) => t.id), ["TK-20261015-0003"]);
    assert.deepEqual((await almacen.listar({ producto: "market" })).map((t) => t.id), ["TK-20261014-0002"]);
    assert.deepEqual((await almacen.listar({ estado: "abierto" })).map((t) => t.id), ["TK-20261015-0004"]);
    assert.deepEqual((await almacen.listar({ texto: "PUPUSAS" })).map((t) => t.id), ["TK-20261013-0001"]);
    assert.deepEqual((await almacen.listar({ texto: "inv3" })).map((t) => t.id), ["TK-20261015-0003"]);
    assert.deepEqual((await almacen.listar({ texto: "1042" })).map((t) => t.id), ["TK-20261014-0002"]);
  }));

test("keyset paging with despues returns every ticket once, page by page", () =>
  conDatos(async (datos) => {
    const almacen = almacenArchivos(datos);
    for (let i = 1; i <= 5; i++) {
      await almacen.guardar(pagado(`TK-20261015-000${i}`, new Date(Date.UTC(2026, 9, 15, 12, i)), { lightning: false }));
    }
    const vistos: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      const pagina = await almacen.listar({ limite: 2, despues: cursor });
      if (pagina.length === 0) break;
      vistos.push(...pagina.map((t) => t.id));
      cursor = pagina[pagina.length - 1]!.creado;
    }
    assert.deepEqual(vistos, ["TK-20261015-0005", "TK-20261015-0004", "TK-20261015-0003", "TK-20261015-0002", "TK-20261015-0001"]);
  }));

test("the default page is 50 rows and the page size stops at 500", () => {
  assert.equal(limiteDe(undefined), LIMITE_DEFECTO);
  assert.equal(LIMITE_DEFECTO, 50);
  assert.equal(limiteDe({ limite: 9000 }), LIMITE_MAXIMO);
  assert.equal(limiteDe({ limite: 10 }), 10);
  assert.throws(() => limiteDe({ limite: 0 }), ErrorLedger);
});

test("the text search drops characters that mean something in a pattern", () => {
  assert.equal(textoDeBusqueda("  a*b%c_d(e) "), "a b c d e");
  assert.equal(textoDeBusqueda(undefined), "");
});
