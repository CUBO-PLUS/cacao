import { test } from "node:test";
import assert from "node:assert/strict";
import { entradaConsumidor } from "../ayudas-prueba.ts";
import type { AlmacenTickets, FiltrosTickets } from "../almacen/tipos.ts";
import { pagoEfectivo } from "../pagos/efectivo.ts";
import { adjuntarDte, aceptarDte, crearTicket, registrarPago, rechazarDte, type Ticket } from "../ticket.ts";
import { informeDelDia } from "./informe.ts";

const DIA = "2026-10-13";
const CIERRE = new Date("2026-10-13T20:00:00.000Z"); // 14:00 in El Salvador

const DTE = (n: number) => ({
  tipoDte: "01" as const,
  codigoGeneracion: `5A1C0E7B-3D4F-4A8E-9B2C-7F6E5D4C3B${String(n).padStart(2, "0")}`,
  numeroControl: `DTE-01-M001P001-${String(n).padStart(15, "0")}`,
  ambiente: "00" as const,
  archivo: `ledger_dtes/${n}`,
});

function pagado(id: string, creado: Date, cobro: Date): Ticket {
  return registrarPago(crearTicket(entradaConsumidor(), creado, id), pagoEfectivo(452, cobro), cobro);
}

// A store with the same filters the Supabase reader applies: state, creation window, and a row limit.
function almacenFalso(tickets: Ticket[]): AlmacenTickets {
  return {
    async guardar() {},
    async porId(id) {
      return tickets.find((t) => t.id === id) ?? null;
    },
    async porOrigen() {
      return null;
    },
    async porHash() {
      return null;
    },
    async listar(f?: FiltrosTickets) {
      return tickets
        .filter((t) => f?.estado === undefined || t.estado === f.estado)
        .filter((t) => f?.desde === undefined || new Date(t.creado) >= f.desde)
        .filter((t) => f?.hasta === undefined || new Date(t.creado) < f.hasta)
        .slice(0, f?.limite ?? 50);
    },
  };
}

test("a sale paid three days ago and still without a document is an orphan in today's close", async () => {
  const viejo = pagado("TK-20261010-0001", new Date("2026-10-10T15:00:00Z"), new Date("2026-10-10T15:01:00Z"));
  const informe = await informeDelDia(almacenFalso([viejo]), DIA, CIERRE);
  assert.deepEqual(
    informe.grupos.huerfanos.map((f) => f.ticket),
    ["TK-20261010-0001"],
    "money received and no valid document stays in the close until it is resolved",
  );
  assert.equal(informe.todosConSello, false);
});

test("a sale paid 70 days ago, outside the 60-day window, is still read because it is orphaned", async () => {
  const muyViejo = pagado("TK-20260801-0002", new Date("2026-08-01T15:00:00Z"), new Date("2026-08-01T15:01:00Z"));
  const informe = await informeDelDia(almacenFalso([muyViejo]), DIA, CIERRE);
  assert.equal(informe.grupos.huerfanos.length, 1);
});

test("a ticket rejected today is counted once, with its 24-hour fuse, even though two queries return it", async () => {
  const creado = new Date("2026-10-13T15:00:00Z");
  const rechazo = new Date(CIERRE.getTime() - 2 * 3_600_000);
  const t = rechazarDte(adjuntarDte(pagado("TK-20261013-0003", creado, new Date("2026-10-13T15:01:00Z")), DTE(3), creado), ["resumen.totalIva: no cuadra"], rechazo);
  const informe = await informeDelDia(almacenFalso([t]), DIA, CIERRE);
  assert.equal(informe.grupos.plazo.length, 1);
  assert.equal(informe.grupos.plazo[0]?.minutosRestantes, 22 * 60);
});

test("an emitted ticket of today counts as emitted with its simulated seal", async () => {
  const creado = new Date("2026-10-13T15:00:00Z");
  const cobro = new Date("2026-10-13T15:01:00Z");
  const emitido = aceptarDte(
    adjuntarDte(pagado("TK-20261013-0004", creado, cobro), DTE(4), cobro),
    { valor: "SIMULADO-0123456789ABCDEF0123456789ABCDEF04", momento: "2026-10-13T15:02:00.000Z", simulado: true },
    new Date("2026-10-13T15:02:00Z"),
  );
  const informe = await informeDelDia(almacenFalso([emitido]), DIA, CIERRE);
  assert.deepEqual(informe.grupos.emitidos.map((f) => f.ticket), ["TK-20261013-0004"]);
  assert.equal(informe.grupos.huerfanos.length, 0);
  assert.equal(informe.respuesta, "¿Todos los cobros de hoy tienen su sello? Sí.");
});

test("an open ticket created on another day is not in today's close", async () => {
  const otroDia = crearTicket(entradaConsumidor(), new Date("2026-10-11T16:00:00Z"), "TK-20261011-0005");
  const hoy = crearTicket(entradaConsumidor(), new Date("2026-10-13T16:00:00Z"), "TK-20261013-0006");
  const informe = await informeDelDia(almacenFalso([otroDia, hoy]), DIA, CIERRE);
  assert.deepEqual(informe.grupos.abiertos.map((f) => f.ticket), ["TK-20261013-0006"]);
});
