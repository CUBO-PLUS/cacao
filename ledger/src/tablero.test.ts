import { test } from "node:test";
import assert from "node:assert/strict";
import { entradaConsumidor } from "./ayudas-prueba.ts";
import { pagoEfectivo } from "./pagos/efectivo.ts";
import type { Pago } from "./pagos/tipos.ts";
import { diaDesplazado, resumen } from "./tablero.ts";
import { crearTicket, registrarPago, totalDeTicket, type OrigenTicket, type Ticket } from "./ticket.ts";

// The clock is 15 October 2026 at 12:00 in El Salvador (UTC-6).
const AHORA = new Date("2026-10-15T18:00:00.000Z");

function hexDe(id: string): string {
  return id.replace(/\D/g, "").padStart(64, "0");
}

// A paid consumer ticket that settled at `momento`, in cash or on lightning (1000 sats each).
function pagado(id: string, momento: string, rail: "efectivo" | "lightning", origen?: OrigenTicket): Ticket {
  const abierto = crearTicket(entradaConsumidor(), new Date(momento), id);
  const total = totalDeTicket(abierto).totalCentavos;
  const pago: Pago =
    rail === "efectivo"
      ? pagoEfectivo(total, new Date(momento))
      : { rail: "lightning", montoCentavos: total, momento, sats: 1000, tasaUsdPorBtc: "36940.18", tasaFuente: "prueba", paymentHash: hexDe(id), idTransaccion: `t-${id}` };
  const t = registrarPago(abierto, pago, new Date(momento));
  return origen ? { ...t, origen } : t;
}

test("the day, week and month figures count paid sales in El Salvador days only", () => {
  const total = totalDeTicket(crearTicket(entradaConsumidor(), AHORA, "TK-20261015-0000")).totalCentavos;
  const tickets = [
    pagado("TK-20261015-0001", "2026-10-15T15:00:00.000Z", "efectivo"), // hoy
    pagado("TK-20261015-0002", "2026-10-15T15:30:00.000Z", "lightning", { plataforma: "btcpay", producto: "media", numero: "I1" }),
    pagado("TK-20261010-0003", "2026-10-10T15:00:00.000Z", "efectivo"), // dentro de la semana, no hoy
    pagado("TK-20261003-0004", "2026-10-03T15:00:00.000Z", "lightning", { plataforma: "btcpay", producto: "pay", numero: "I2" }), // dentro del mes
    pagado("TK-20260930-0005", "2026-09-30T23:30:00.000Z", "efectivo"), // mes anterior: 17:30 del 30 en El Salvador
    pagado("TK-20260916-0006", "2026-09-16T12:00:00.000Z", "efectivo"), // dentro de los 30 días
    pagado("TK-20260915-0007", "2026-09-15T12:00:00.000Z", "efectivo"), // fuera de los 30 días
  ];
  const abierto = crearTicket(entradaConsumidor(), AHORA, "TK-20261015-0008");
  const r = resumen([...tickets, abierto], AHORA);

  // Hoy: two sales on the 15th, one of them on lightning (1000 sats).
  assert.deepEqual(r.hoy, { tickets: 2, centavos: total * 2, sats: 1000 });
  // Semana (9 to 15 October): the 10th adds a cash sale; the 3rd is outside it.
  assert.deepEqual(r.semana, { tickets: 3, centavos: total * 3, sats: 1000 });
  // Mes (October): the 3rd is in, the 30th of September (17:30 in El Salvador) is out.
  assert.deepEqual(r.mes, { tickets: 4, centavos: total * 4, sats: 2000 });
  assert.deepEqual(r.porRiel, {
    lightning: { tickets: 2, centavos: total * 2, sats: 2000 },
    efectivo: { tickets: 2, centavos: total * 2, sats: 0 },
  });
  // Same price for every ticket, so the order is by name after the cents: manual (2), media, pay.
  assert.deepEqual(
    r.porProducto.map((p) => [p.producto, p.tickets]),
    [["manual", 2], ["media", 1], ["pay", 1]],
  );
});

test("porDia lists thirty El Salvador days ending today, oldest first, with zeros for quiet days", () => {
  const r = resumen([pagado("TK-20260916-0006", "2026-09-16T12:00:00.000Z", "efectivo"), pagado("TK-20261015-0001", "2026-10-15T15:00:00.000Z", "efectivo")], AHORA);
  assert.equal(r.porDia.length, 30);
  assert.equal(r.porDia[0]?.dia, "2026-09-16");
  assert.equal(r.porDia[29]?.dia, "2026-10-15");
  assert.equal(r.porDia.filter((d) => d.centavos > 0).length, 2);
  assert.equal(r.porDia[1]?.centavos, 0);
});

test("with no sales the figures are zero and the lists are empty", () => {
  const r = resumen([crearTicket(entradaConsumidor(), AHORA, "TK-20261015-0009")], AHORA);
  assert.deepEqual(r.hoy, { tickets: 0, centavos: 0, sats: 0 });
  assert.deepEqual(r.porProducto, []);
  assert.equal(r.porDia.every((d) => d.centavos === 0), true);
});

test("the day arithmetic works across month and year ends", () => {
  assert.equal(diaDesplazado("2026-03-01", -1), "2026-02-28");
  assert.equal(diaDesplazado("2026-01-01", -29), "2025-12-03");
  assert.equal(diaDesplazado("2026-10-15", 0), "2026-10-15");
});
