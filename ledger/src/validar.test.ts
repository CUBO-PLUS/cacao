import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { raizLedger } from "./datos.ts";
import { AHORA, emisorPrueba, entradaConsumidor, entradaContribuyente, ticketPagadoEfectivo, ticketPagadoLightning } from "./ayudas-prueba.ts";
import { construir01, construir03, type ResultadoConstruccion } from "./dte/construir.ts";
import { validarDte, type OpcionesValidacion } from "./validar.ts";
// The generation these tests describe. Caso-specific tests name caso explicitly.
function validarDte2026(doc: unknown, extra: OpcionesValidacion = {}) {
  return validarDte(doc, { ...extra, generacion: "2026" });
}

import { pagoEfectivo } from "./pagos/efectivo.ts";
import { crearTicket, registrarPago } from "./ticket.ts";
import { Ajv } from "ajv";

type Doc = Record<string, any>;

// A fresh, valid 01 document paid by Lightning, with the rule-free code 99.
function docValido01(): Doc {
  const { ticket, pago } = ticketPagadoLightning(entradaConsumidor(), "blink-receive-lightning.json", "TK-20261013-1001");
  return clonar(construir01(ticket, pago, emisorPrueba(), { correlativo: 1, ahora: AHORA, codigoGeneracion: "5A1C0E7B-3D4F-4A8E-9B2C-7F6E5D4C3B2A", generacion: "2026" }).documento);
}

function docValido03(): Doc {
  const { ticket, pago } = ticketPagadoLightning(entradaContribuyente(), "blink-receive-lightning-ccf.json", "TK-20261013-1002");
  return clonar(construir03(ticket, pago, emisorPrueba(), { correlativo: 1, ahora: AHORA, codigoGeneracion: "9C2E4B6A-1D3F-4E5A-8B7C-0A9F8E7D6C5B", generacion: "2026" }).documento);
}

function clonar<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function rutasDe(fallos: { ruta: string }[]): string[] {
  return fallos.map((f) => f.ruta);
}

test("the official 01 v1 payment-code pattern matches the empty string in JavaScript", () => {
  // Read from the mirror copy of the v1 schema, which is where the pattern lives.
  const v1 = JSON.parse(readFileSync(join(raizLedger(), "esquemas", "espejo-herson", "DTE-FE-v1.json"), "utf8")) as Doc;
  const patron: string = v1.properties.resumen.properties.pagos.items.properties.codigo.pattern;
  assert.equal(patron, "^(0[1-9]||10||99)$");
  const re = new RegExp(patron);
  assert.equal(re.test(""), true, "empty alternations match the empty string");
  assert.equal(re.test("11"), false, "11 is not matched, so v1 refuses Bitcoin on 01");
  assert.equal(re.test("10"), true);
  assert.equal(re.test("99"), true);
  // The same subschema compiled by Ajv behaves the same way.
  const compilado = new Ajv({ strictTypes: false }).compile(v1.properties.resumen.properties.pagos.items.properties.codigo);
  assert.equal(compilado(""), true, "a naive v1 validator would pass an empty code");
  assert.equal(compilado("11"), false);
});

test("the empty code passes the official schema but fails the CacaoLedger rule", () => {
  const doc = docValido01();
  doc.resumen.pagos[0].codigo = "";
  const v = validarDte2026(doc);
  assert.equal(v.esquema.length, 0, "official 01 v2 does not pattern codigo");
  assert.ok(v.reglas.some((f) => f.ruta === "resumen.pagos[0].codigo" && /vacío/.test(f.mensaje)));
  assert.equal(v.ok, false);
});

test("a lower-case codigoGeneracion is rejected by the schema with its own message", () => {
  const doc = docValido01();
  doc.identificacion.codigoGeneracion = doc.identificacion.codigoGeneracion.toLowerCase();
  const v = validarDte2026(doc);
  assert.deepEqual(rutasDe(v.esquema), ["identificacion.codigoGeneracion"]);
  assert.equal(v.esquema[0]?.regla, "pattern");
  assert.equal(v.reglas.length, 0);
  assert.equal(v.ok, false);
});

test("a four-segment numeroControl is rejected by the schema", () => {
  const doc = docValido01();
  doc.identificacion.numeroControl = "DTE-01-M001-P001-000000000000001";
  const v = validarDte2026(doc);
  assert.ok(v.esquema.some((f) => f.ruta === "identificacion.numeroControl" && f.regla === "pattern"));
  // The string is also 32 characters, one over the 31 the schema allows.
  assert.ok(v.esquema.some((f) => f.ruta === "identificacion.numeroControl" && f.regla === "maxLength"));
  assert.equal(v.ok, false);
});

test("ambiente 01 without the confirmation flag is refused by the CacaoLedger rule", () => {
  const doc = docValido01();
  doc.identificacion.ambiente = "01";
  const sinFlag = validarDte2026(doc);
  assert.equal(sinFlag.esquema.length, 0);
  assert.deepEqual(rutasDe(sinFlag.reglas), ["identificacion.ambiente"]);
  assert.equal(sinFlag.ok, false);
  const conFlag = validarDte2026(doc, { permitirProduccion: true });
  assert.equal(conFlag.ok, true);
});

test("a non-USD currency is rejected by the schema", () => {
  const doc = docValido01();
  doc.identificacion.tipoMoneda = "EUR";
  const v = validarDte2026(doc);
  assert.deepEqual(rutasDe(v.esquema), ["identificacion.tipoMoneda"]);
  assert.equal(v.esquema[0]?.regla, "enum");
  assert.match(v.esquema[0]?.mensaje ?? "", /"USD"/);
});

test("an amount with three decimals is rejected by the schema; two decimals pass", () => {
  const doc = docValido01();
  doc.resumen.pagos[0].montoPago = 4.525;
  const v = validarDte2026(doc);
  assert.ok(v.esquema.some((f) => f.ruta === "resumen.pagos[0].montoPago" && f.regla === "multipleOf"));
  assert.equal(validarDte2026(docValido01()).ok, true);
});

test("amounts such as 0.29 pass multipleOf 0.01 (floats do not trip the check)", () => {
  const ticket = crearTicket(
    { cliente: "consumidor", lineas: [{ descripcion: "Caramelo", cantidad: 1, precioCentavos: 29 }] },
    AHORA,
    "TK-20261013-1003",
  );
  const pagado = registrarPago(ticket, pagoEfectivo(29, AHORA), AHORA);
  const r: ResultadoConstruccion = construir01(pagado, pagoEfectivo(29, AHORA), emisorPrueba(), {
    correlativo: 1,
    ahora: AHORA,
    codigoGeneracion: "1B2C3D4E-5F60-4718-892A-B3C4D5E6F708",
    generacion: "2026",
  });
  assert.equal(validarDte2026(r.documento).ok, true);
});

test("tampered totals fail the arithmetic rule even though the schema accepts them", () => {
  const doc = docValido01();
  doc.resumen.totalIva = 0.5;
  const v = validarDte2026(doc);
  assert.equal(v.esquema.length, 0);
  assert.ok(v.reglas.some((f) => f.regla === "aritmetica-iva"));
});

test("a 03 with code 11 passes; a 03 with an empty code fails the CacaoLedger rule", () => {
  assert.equal(validarDte2026(docValido03()).ok, true);
  const vacio = docValido03();
  vacio.resumen.pagos[0].codigo = "";
  assert.ok(validarDte2026(vacio).reglas.some((f) => /vacío/.test(f.mensaje)));
});

test("a document of another type is refused with a clear rule failure", () => {
  const v = validarDte2026({ identificacion: { tipoDte: "11" } });
  assert.equal(v.ok, false);
  assert.equal(v.reglas[0]?.regla, "tipo-soportado");
  assert.equal(validarDte2026("no es un objeto").ok, false);
});

test("the cash rail gives code 01 and validates for both types", () => {
  const { ticket, pago } = ticketPagadoEfectivo(entradaConsumidor(), "TK-20261013-1004");
  const r = construir01(ticket, pago, emisorPrueba(), { correlativo: 2, ahora: AHORA, codigoGeneracion: "0A1B2C3D-4E5F-4A6B-8C7D-9E0F1A2B3C4D", generacion: "2026" });
  assert.equal(r.formaPago.codigo, "01");
  assert.equal(validarDte2026(r.documento).ok, true);
});

test("the official 2026 01 schema has no pattern on the payment code: code 11 passes it, and the mirror v1 refuses it", () => {
  // Read from the copy of the Ministry's package (esquemas/ministerio-2026, sha256 in esquemas/README.md).
  const v2 = JSON.parse(readFileSync(join(raizLedger(), "esquemas", "ministerio-2026", "fe-f-v2.json"), "utf8")) as Doc;
  const codigo = v2.properties.resumen.properties.pagos.items.properties.codigo;
  assert.equal(codigo.pattern, undefined, "the 2026 schema restricts the code by length only");
  assert.equal(codigo.maxLength, 2);
  const doc = docValido01();
  assert.equal(doc.resumen.pagos[0].codigo, "11", "the 2026 generation emits Bitcoin on a 01");
  assert.equal(validarDte2026(doc).ok, true, "accepted by the official 2026 schema and the CacaoLedger rules");
  const caso = validarDte(clonar(doc), { generacion: "caso" });
  assert.equal(caso.ok, false, "the caso generation (community mirror of v1) refuses it");
  assert.ok(rutasDe(caso.esquema).includes("resumen.pagos[0].codigo"));
});
