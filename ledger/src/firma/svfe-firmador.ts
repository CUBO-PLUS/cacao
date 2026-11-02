import { ErrorLedger } from "../errores.ts";

// Client for the Ministry's SVFE-API-Firmador (POST /firma/firmardocumento/).
// The real service holds the contributor's .crt on disk; this client only sends
// nit, passwordPri and dteJson. No network is required for the rest of CacaoLedger.

export const RUTA_FIRMADOR_POR_DEFECTO = "http://127.0.0.1:8113/firma/firmardocumento/";

export interface PeticionFirmaSvfe {
  nit: string;
  passwordPri: string;
  dteJson: unknown;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function urlFirmadorDesdeEntorno(): string | null {
  const url = process.env.LEDGER_FIRMADOR_URL?.trim();
  if (url) return url;
  return null;
}

export function extraerJwsDeRespuesta(cuerpo: unknown): string {
  if (typeof cuerpo === "string" && cuerpo.includes(".")) return cuerpo.trim();
  if (typeof cuerpo !== "object" || cuerpo === null) {
    throw new ErrorLedger("El firmador respondió un cuerpo que no se reconoce.");
  }
  const o = cuerpo as Record<string, unknown>;
  for (const clave of ["body", "documento", "jws", "token", "jwt"]) {
    const v = o[clave];
    if (typeof v === "string" && v.includes(".")) return v;
  }
  if (o.body && typeof o.body === "object") {
    return extraerJwsDeRespuesta(o.body);
  }
  throw new ErrorLedger("El firmador no devolvió un JWS en la respuesta.");
}

export async function firmarDocumentoSvfe(
  url: string,
  peticion: PeticionFirmaSvfe,
  fetchImpl: FetchLike = fetch,
  timeoutMs = 15_000,
): Promise<string> {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), timeoutMs);
  let respuesta: Response;
  try {
    respuesta = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        nit: peticion.nit,
        passwordPri: peticion.passwordPri,
        dteJson: peticion.dteJson,
      }),
      signal: control.signal,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ErrorLedger(
      `No se pudo contactar al firmador en ${url}. ${msg}. Podés seguir con dte transmitir --simulado sin JWS.`,
    );
  } finally {
    clearTimeout(timer);
  }
  let cuerpo: unknown;
  const texto = await respuesta.text();
  try {
    cuerpo = texto ? (JSON.parse(texto) as unknown) : null;
  } catch {
    cuerpo = texto;
  }
  if (!respuesta.ok) {
    const detalle = typeof cuerpo === "object" && cuerpo !== null ? JSON.stringify(cuerpo) : String(cuerpo);
    throw new ErrorLedger(`El firmador respondió ${respuesta.status}: ${detalle}`);
  }
  return extraerJwsDeRespuesta(cuerpo);
}
