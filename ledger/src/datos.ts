import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ErrorLedger } from "./errores.ts";

// Data lives in plain JSON files. Default: ledger/datos/ (git-ignored).
// Override with --datos <dir> or the LEDGER_DATOS environment variable.
// Same folder as new URL("..", import.meta.url), written as a path so the Next build does not treat it as an asset.
const RAIZ_LEDGER = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function dirDatos(opcion?: string): string {
  // The web app never calls this; the comment only keeps the Next build from tracing the whole project.
  return resolve(/*turbopackIgnore: true*/ opcion ?? process.env.LEDGER_DATOS ?? join(RAIZ_LEDGER, "datos"));
}

export function raizLedger(): string {
  return RAIZ_LEDGER;
}

// Write to a temporary file and rename, so a crash never leaves half a file.
export function escribirJson(ruta: string, valor: unknown): void {
  mkdirSync(dirname(ruta), { recursive: true });
  const tmp = `${ruta}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(valor, null, 2)}\n`, "utf8");
  renameSync(tmp, ruta);
}

export function leerJson(ruta: string): unknown {
  let texto: string;
  try {
    texto = readFileSync(ruta, "utf8");
  } catch {
    throw new ErrorLedger(`No se puede leer el archivo "${ruta}".`);
  }
  try {
    return JSON.parse(texto) as unknown;
  } catch {
    throw new ErrorLedger(`El archivo "${ruta}" no es JSON válido.`);
  }
}
