import { test } from "node:test";
import assert from "node:assert/strict";
import { esPlan, estadoDelPlan, finDeGracia, periodoDe, puedeEmitir, totalConIva } from "./planes.ts";

test("each plan is charged with 13 % IVA on top", () => {
  assert.deepEqual(totalConIva("semilla"), { neto: 900, iva: 117, total: 1017 });
  assert.deepEqual(totalConIva("cosecha"), { neto: 2400, iva: 312, total: 2712 });
  assert.deepEqual(totalConIva("despacho"), { neto: 6500, iva: 845, total: 7345 });
});

test("only the three plans are plans", () => {
  assert.equal(esPlan("semilla"), true);
  assert.equal(esPlan("gratis"), false);
  assert.equal(esPlan("toString"), false);
  assert.equal(esPlan(undefined), false);
});

test("the month is El Salvador's, not UTC's", () => {
  // 1 Dec 03:00 UTC is still 30 Nov 21:00 in El Salvador.
  assert.equal(periodoDe(new Date("2026-12-01T03:00:00Z")), "2026-11");
  assert.equal(periodoDe(new Date("2026-12-01T06:00:00Z")), "2026-12");
});

test("grace ends at the end of day 7, El Salvador time", () => {
  assert.equal(finDeGracia("2026-11").toISOString(), "2026-11-08T06:00:00.000Z");
});

test("without a plan nothing is blocked", () => {
  const e = estadoDelPlan({ plan: null, elegidoEn: null, pagadoEstePeriodo: false, ahora: new Date("2026-11-20T12:00:00Z") });
  assert.equal(e.tipo, "sin_plan");
  assert.equal(puedeEmitir(e), true);
});

test("paid this month is up to date", () => {
  const e = estadoDelPlan({ plan: "semilla", elegidoEn: new Date("2026-10-01T12:00:00Z"), pagadoEstePeriodo: true, ahora: new Date("2026-11-20T12:00:00Z") });
  assert.equal(e.tipo, "al_dia");
});

test("unpaid inside the first seven days is in grace, and may still issue", () => {
  const e = estadoDelPlan({ plan: "semilla", elegidoEn: new Date("2026-10-01T12:00:00Z"), pagadoEstePeriodo: false, ahora: new Date("2026-11-03T12:00:00Z") });
  assert.equal(e.tipo, "en_gracia");
  assert.equal(puedeEmitir(e), true);
  if (e.tipo === "en_gracia") assert.equal(e.diasRestantes, 5);
});

test("unpaid after day 7 is suspended and may not issue", () => {
  const e = estadoDelPlan({ plan: "semilla", elegidoEn: new Date("2026-10-01T12:00:00Z"), pagadoEstePeriodo: false, ahora: new Date("2026-11-08T07:00:00Z") });
  assert.equal(e.tipo, "suspendido");
  assert.equal(puedeEmitir(e), false);
});

test("a plan chosen mid-month gets its own seven days", () => {
  const elegido = new Date("2026-11-20T12:00:00Z");
  const e = estadoDelPlan({ plan: "cosecha", elegidoEn: elegido, pagadoEstePeriodo: false, ahora: new Date("2026-11-21T12:00:00Z") });
  assert.equal(e.tipo, "en_gracia");
  if (e.tipo === "en_gracia") {
    assert.equal(e.hasta.toISOString(), "2026-11-27T12:00:00.000Z");
    assert.equal(e.diasRestantes, 6);
  }
  const despues = estadoDelPlan({ plan: "cosecha", elegidoEn: elegido, pagadoEstePeriodo: false, ahora: new Date("2026-11-28T12:00:00Z") });
  assert.equal(despues.tipo, "suspendido");
});

test("a period reads as month and year", async () => {
  const { nombrePeriodo } = await import("./planes.ts");
  assert.equal(nombrePeriodo("2026-11"), "noviembre de 2026");
  assert.equal(nombrePeriodo("2027-01"), "enero de 2027");
});
