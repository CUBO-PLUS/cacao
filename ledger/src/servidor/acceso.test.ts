import { test } from "node:test";
import assert from "node:assert/strict";
import { decidirAcceso, destinoSeguro, rutaAcceso, rutaContinuar, TEXTO_SIN_ACCESO } from "./acceso.ts";

// The guard is a pure decision: no session means sign-in, a session without es_admin means denial, an owner passes.

test("a visitor who is not signed in is sent to sign-in, with the page they asked for kept in volver", () => {
  assert.deepEqual(decidirAcceso(null, "/tickets"), { tipo: "entrar", destino: "/entrar?volver=%2Ftickets" });
  assert.deepEqual(decidirAcceso(null, "/mes/2026-10"), { tipo: "entrar", destino: "/entrar?volver=%2Fmes%2F2026-10" });
});

test("a signed-in person who is not an owner is denied, with no sign-in loop", () => {
  assert.deepEqual(decidirAcceso({ esAdmin: false }, "/tickets"), { tipo: "denegar" });
  assert.equal(TEXTO_SIN_ACCESO, "Esta cuenta no tiene acceso al libro de Grupo Cacao.");
});

test("an owner gets the page", () => {
  assert.deepEqual(decidirAcceso({ esAdmin: true }, "/tickets/TK-20261013-0002"), { tipo: "permitir" });
});

test("a volver that tries to leave the site falls back to the home page before sign-in", () => {
  assert.deepEqual(decidirAcceso(null, "https://evil.test/x"), { tipo: "entrar", destino: "/entrar" });
  assert.deepEqual(decidirAcceso(null, "//evil.test"), { tipo: "entrar", destino: "/entrar" });
});

test("destinoSeguro keeps paths of this site and refuses everything else", () => {
  assert.equal(destinoSeguro("/tickets?estado=pagado"), "/tickets?estado=pagado");
  assert.equal(destinoSeguro("/\\evil.test"), "/");
  assert.equal(destinoSeguro("/tickets\n/x"), "/");
  assert.equal(destinoSeguro("/entrar?volver=/mes"), "/");
  assert.equal(destinoSeguro(["/mes/2026-10", "/otra"]), "/mes/2026-10");
  assert.equal(destinoSeguro(undefined), "/");
});

test("sign-in and continuar routes carry the destination, and the home needs no parameter", () => {
  assert.equal(rutaAcceso("/registrarse", "/"), "/registrarse");
  assert.equal(rutaAcceso("/registrarse", "/mes"), "/registrarse?volver=%2Fmes");
  assert.equal(rutaContinuar("/"), "/continuar");
  assert.equal(rutaContinuar("/mes"), "/continuar?volver=%2Fmes");
});
