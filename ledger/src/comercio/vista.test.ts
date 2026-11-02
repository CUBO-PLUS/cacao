import { test } from "node:test";
import assert from "node:assert/strict";
import {
  credencialesDelComercio,
  enmascararNit,
  estadoCifrado,
  etiquetaEstadoCifrado,
  hayClaveMaestra,
} from "./vista.ts";

test("the NIT shows only its last three digits", () => {
  assert.equal(enmascararNit("06141901010013"), "***********013");
  assert.ok(!enmascararNit("06141901010013").includes("0614"));
});

test("a value that is not a 14-digit NIT never leaks: it shows only asterisks", () => {
  assert.equal(enmascararNit("0614-1901"), "**************");
  assert.equal(enmascararNit(""), "**************");
  assert.doesNotMatch(enmascararNit("secreto123"), /secreto/);
});

test("encryption status: both envelope parts mean encrypted, one missing means incomplete", () => {
  assert.equal(estadoCifrado({ sobreDek: {}, material: {} }), "cifrado");
  assert.equal(estadoCifrado({ sobreDek: {} }), "incompleto");
  assert.equal(estadoCifrado({ sobreDek: null, material: {} }), "incompleto");
  assert.equal(estadoCifrado(null), "sin-registro");
  assert.equal(etiquetaEstadoCifrado("cifrado"), "Cifrado (AES-256-GCM)");
});

test("the master key flag is yes only when the variable has a value", () => {
  assert.equal(hayClaveMaestra({ LEDGER_CLAVE_MAESTRA: "abc" }), true);
  assert.equal(hayClaveMaestra({ LEDGER_CLAVE_MAESTRA: "   " }), false);
  assert.equal(hayClaveMaestra({}), false);
});

test("credentials: the firmador shows yes for an encrypted record, the others show no", () => {
  const conCifrado = credencialesDelComercio({ sobreDek: {}, material: {} });
  assert.deepEqual(
    conCifrado.map((c) => c.presente),
    [true, false, false],
  );
  const sinRegistro = credencialesDelComercio(null);
  assert.equal(sinRegistro[0]?.presente, false);
});

test("the credential rows never carry a value, only names and notes", () => {
  for (const fila of credencialesDelComercio({ sobreDek: {}, material: {} })) {
    assert.deepEqual(Object.keys(fila).sort(), ["nombre", "nota", "presente"]);
  }
});
