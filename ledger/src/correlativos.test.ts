import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { correlativosArchivo, siguienteCorrelativo } from "./correlativos.ts";

test("the file version starts at 1 and keeps the other series when it saves", async () => {
  const datos = mkdtempSync(join(tmpdir(), "ledger-correlativos-"));
  try {
    const fuente = correlativosArchivo(datos);
    assert.equal(await siguienteCorrelativo(fuente, "01-M001P001"), 1);
    await fuente.guardar("01-M001P001", 1);
    await fuente.guardar("03-M001P001", 7);
    assert.equal(await siguienteCorrelativo(fuente, "01-M001P001"), 2);
    assert.equal(await siguienteCorrelativo(fuente, "03-M001P001"), 8);
    assert.deepEqual(JSON.parse(readFileSync(join(datos, "correlativos.json"), "utf8")), { "01-M001P001": 1, "03-M001P001": 7 });
  } finally {
    rmSync(datos, { recursive: true, force: true });
  }
});

test("an existing correlativos.json is read as it was written before the seam existed", async () => {
  const datos = mkdtempSync(join(tmpdir(), "ledger-correlativos-"));
  try {
    writeFileSync(join(datos, "correlativos.json"), `${JSON.stringify({ "01-S001P001": 41 })}\n`, "utf8");
    assert.equal(await siguienteCorrelativo(correlativosArchivo(datos), "01-S001P001"), 42);
  } finally {
    rmSync(datos, { recursive: true, force: true });
  }
});
