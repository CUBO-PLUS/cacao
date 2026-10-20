import { ErrorLedger } from "../errores.ts";

// A lease in the database (ledger_candados, migration 20261021000005): one caller at a time runs a sync.
// PostgREST runs every rpc in its own transaction, so the lease is a row with an expiry, not a session lock.
// The lease also ends by itself after `segundos`, so a run that stops cannot block the next one for long.

export type ConfigCandado = {
  // Base address of the project, without a trailing slash needed.
  url: string;
  // Service role key. Never sent to the browser.
  clave: string;
  // Replaced in tests.
  fetch?: typeof fetch;
};

async function rpc(config: ConfigCandado, funcion: string, cuerpo: Record<string, unknown>): Promise<Response> {
  const base = `${config.url.replace(/\/+$/, "")}/rest/v1`;
  const f = config.fetch ?? fetch;
  try {
    return await f(`${base}/rpc/${funcion}`, {
      method: "POST",
      headers: {
        apikey: config.clave,
        authorization: `Bearer ${config.clave}`,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(cuerpo),
      cache: "no-store",
    });
  } catch {
    throw new ErrorLedger("No se pudo conectar con la base de datos para tomar el candado.");
  }
}

// True when the caller got the lease. False when another caller holds it and it has not expired.
export async function tomarCandado(config: ConfigCandado, nombre: string, dueno: string, segundos: number): Promise<boolean> {
  const r = await rpc(config, "ledger_tomar_candado", { p_nombre: nombre, p_dueno: dueno, p_segundos: segundos });
  if (!r.ok) throw new ErrorLedger(`No se pudo tomar el candado ${nombre} (HTTP ${r.status}).`);
  const libre = (await r.json()) as unknown;
  return libre === true;
}

// Releases the lease only when this caller still holds it. Returns false otherwise (it expired or was taken).
export async function soltarCandado(config: ConfigCandado, nombre: string, dueno: string): Promise<boolean> {
  const r = await rpc(config, "ledger_soltar_candado", { p_nombre: nombre, p_dueno: dueno });
  if (!r.ok) throw new ErrorLedger(`No se pudo soltar el candado ${nombre} (HTTP ${r.status}).`);
  return ((await r.json()) as unknown) === true;
}
