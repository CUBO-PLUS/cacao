import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cargarOCrearClavePrueba,
  firmarDteLocal,
  generarParClavesPrueba,
  verificarJwsLocal,
} from "./firma-local.ts";

const DTE = {
  identificacion: { tipoDte: "01", codigoGeneracion: "7A1B2C3D-0000-4000-8000-000000000001" },
  resumen: { totalPagar: 1.13 },
};

test("sign then verify returns the same DTE", () => {
  const claves = generarParClavesPrueba();
  const jws = firmarDteLocal(DTE, claves.privada);
  assert.equal(jws.split(".").length, 3);
  assert.deepEqual(verificarJwsLocal(jws, claves.publica), DTE);
});

test("the JWS header declares alg RS512", () => {
  const claves = generarParClavesPrueba();
  const [cabecera = ""] = firmarDteLocal(DTE, claves.privada).split(".");
  const decodificada = JSON.parse(Buffer.from(cabecera, "base64url").toString("utf8")) as { alg: string };
  assert.equal(decodificada.alg, "RS512");
});

test("a tampered payload fails verification", () => {
  const claves = generarParClavesPrueba();
  const [cabecera = "", , firma = ""] = firmarDteLocal(DTE, claves.privada).split(".");
  const cambiado = { ...DTE, resumen: { totalPagar: 0.01 } };
  const carga = Buffer.from(JSON.stringify(cambiado), "utf8").toString("base64url");
  assert.throws(() => verificarJwsLocal(`${cabecera}.${carga}.${firma}`, claves.publica), /no coincide/);
});

test("a different public key fails verification", () => {
  const firmante = generarParClavesPrueba();
  const otra = generarParClavesPrueba();
  const jws = firmarDteLocal(DTE, firmante.privada);
  assert.throws(() => verificarJwsLocal(jws, otra.publica), /no coincide/);
});

test("the stored test key is created once and reused", () => {
  const dir = mkdtempSync(join(tmpdir(), "ledger-firma-prueba-"));
  try {
    const primera = cargarOCrearClavePrueba(join(dir, "firma-prueba"));
    const segunda = cargarOCrearClavePrueba(join(dir, "firma-prueba"));
    assert.equal(segunda.huella, primera.huella);
    assert.equal(segunda.privada, primera.privada);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
