import { execFileSync } from "node:child_process";
import path from "node:path";

// The local Supabase database, read and written through its container. Only the test accounts and the test
// tickets go through here: this is the local stack, never a hosted project.
export const CONTENEDOR_DB = process.env.LEDGER_QA_DB ?? "supabase_db_market";

/** Runs one SQL statement against the local database and returns the unaligned text output. */
export function sql(consulta: string): string {
  return execFileSync("docker", ["exec", CONTENEDOR_DB, "psql", "-U", "postgres", "-At", "-F", "\t", "-c", consulta], {
    encoding: "utf8",
  }).trimEnd();
}

// Clerk development accounts. Any "+clerk_test" address accepts the code 424242 on the development instance.
export const CUENTA_DUENA = "remitente+clerk_test@example.com";
export const CUENTA_VISITANTE = "remitente-qa+clerk_test@example.com";
export const CODIGO_CLERK = "424242";

// Saved sessions. The folder is in .qa/, which git ignores.
export const ARCHIVO_SESION_DUENA = path.join(process.cwd(), ".qa", "e2e-sesiones", "duena.json");
export const ARCHIVO_SESION_VISITANTE = path.join(process.cwd(), ".qa", "e2e-sesiones", "visitante.json");

/** The mes of today in El Salvador, as "yyyy-mm". */
export function mesActual(): string {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "America/El_Salvador", year: "numeric", month: "2-digit" });
  return f.format(new Date());
}
