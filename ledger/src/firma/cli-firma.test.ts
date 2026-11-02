import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { raizLedger } from "../datos.ts";
import { verificarJwsLocal } from "./firma-local.ts";

const CLI = join(raizLedger(), "src", "cli.ts");
const PEM = join(raizLedger(), "fixtures/comercio-prueba/clave-privada.pem");
const JWS = "eyJhbGciOiJSUzI1NiJ9.eyJ0eXAiOiJKV1QifQ.cli-prueba";

function ledgerAsync(datos: string, args: string[], extra: Record<string, string> = {}): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [CLI, ...args, "--datos", datos], {
      cwd: raizLedger(),
      env: {
        ...process.env,
        LEDGER_AHORA: "2026-10-12T18:00:00Z",
        LEDGER_SEMILLA: "pruebas",
        LEDGER_CLAVE_MAESTRA: "0123456789abcdef0123456789abcdef",
        ...extra,
      },
    });
    let out = "";
    let err = "";
    proc.stdout.on("data", (c) => {
      out += c;
    });
    proc.stderr.on("data", (c) => {
      err += c;
    });
    proc.on("close", (code) => resolve({ code, out, err }));
  });
}

function idDe(texto: string): string {
  const id = /TK-\d{8}-[0-9A-F]{4}/.exec(texto)?.[0];
  assert.ok(id);
  return id;
}

test("dte firmar uses a fake firmador; transmitir --simulado still works without it", async () => {
  const fake = await new Promise<{ url: string; close: () => void }>((resolve, reject) => {
    const srv = createServer((req, res) => {
      if (req.method === "POST") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ body: JWS }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") reject(new Error("no port"));
      else resolve({ url: `http://127.0.0.1:${addr.port}/firma/firmardocumento/`, close: () => srv.close() });
    });
  });

  const datos = mkdtempSync(join(tmpdir(), "ledger-firma-"));
  try {
    assert.equal(
      (
        await ledgerAsync(datos, [
          "comercio",
          "registrar",
          "principal",
          "--nit",
          "06141901010013",
          "--password-pri",
          "password-123456",
          "--clave-privada",
          PEM,
        ])
      ).code,
      0,
    );
    const nuevo = await ledgerAsync(datos, ["ticket", "nuevo", "--desde", "fixtures/ticket-consumidor.json"]);
    const id = idDe(nuevo.out);
    await ledgerAsync(datos, ["pagar", id, "--efectivo"]);
    await ledgerAsync(datos, ["dte", "construir", id]);
    const f = await ledgerAsync(datos, ["dte", "firmar", id, "--firmador-url", fake.url]);
    assert.equal(f.code, 0, f.err);
    assert.match(f.out, /Documento firmado/);
    const ver = await ledgerAsync(datos, ["ticket", "ver", id]);
    assert.match(ver.out, /Firma JWS:/);
    const t = await ledgerAsync(datos, ["dte", "transmitir", id, "--simulado"]);
    assert.equal(t.code, 0, t.err);
    assert.match(t.out, /SIMULADO-/);
  } finally {
    fake.close();
    rmSync(datos, { recursive: true, force: true });
  }
});

test("dte firmar without a firmador URL signs with the local test key", async () => {
  const datos = mkdtempSync(join(tmpdir(), "ledger-firma-local-"));
  try {
    assert.equal(
      (
        await ledgerAsync(datos, [
          "comercio",
          "registrar",
          "principal",
          "--nit",
          "06141901010013",
          "--password-pri",
          "password-123456",
          "--clave-privada",
          PEM,
        ])
      ).code,
      0,
    );
    const nuevo = await ledgerAsync(datos, ["ticket", "nuevo", "--desde", "fixtures/ticket-consumidor.json"]);
    const id = idDe(nuevo.out);
    await ledgerAsync(datos, ["pagar", id, "--efectivo"]);
    await ledgerAsync(datos, ["dte", "construir", id]);
    const f = await ledgerAsync(datos, ["dte", "firmar", id], { LEDGER_FIRMADOR_URL: "" });
    assert.equal(f.code, 0, f.err);
    assert.match(f.out, /clave de prueba local/);
    const ver = await ledgerAsync(datos, ["ticket", "ver", id]);
    assert.match(ver.out, /clave de prueba, no válida ante Hacienda/);
    // The stored JWS verifies with the test public key kept next to it.
    const publica = readFileSync(join(datos, "firma-prueba", "clave-publica.pem"), "utf8");
    const archivo = readdirSync(join(datos, "dte", "firmas"))[0];
    assert.ok(archivo);
    const { jws } = JSON.parse(readFileSync(join(datos, "dte", "firmas", archivo), "utf8")) as { jws: string };
    const dte = verificarJwsLocal(jws, publica) as { identificacion: { tipoDte: string } };
    assert.equal(dte.identificacion.tipoDte, "01");
  } finally {
    rmSync(datos, { recursive: true, force: true });
  }
});
