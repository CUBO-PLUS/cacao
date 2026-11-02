import { createPublicKey } from "node:crypto";
import { ErrorLedger } from "../errores.ts";

// Client for the transmission flow of the SVFE test service: authenticate (POST /auth/login), then send the signed
// document (POST /dte/recepcion) with the token. The service is the community mock svfe-mock-api, not the Ministry.
// Its seal is labelled as coming from the test mock everywhere it is shown.
//
// Configuration comes from the environment (see configuracionHaciendaDeEntorno). Without it nothing here runs.

export interface ConfigHacienda {
  // Base address of the service, for example http://127.0.0.1:3100 (no trailing slash).
  url: string;
  // NIT and password of the emisor registered in the service.
  nit: string;
  clave: string;
  // Private key (PKCS#8 PEM) that signs the document. The service verifies against the matching public key.
  clavePrivadaFirma: string;
  // Time allowed for each request. Past it, the transmission is treated as a missing answer (contingencia).
  timeoutMs: number;
}

export const TIMEOUT_HACIENDA_POR_DEFECTO_MS = 15_000;

type Entorno = Record<string, string | undefined>;

// Null when any required variable is missing: the caller then keeps the local simulator, exactly as before.
export function configuracionHaciendaDeEntorno(entorno: Entorno = process.env): ConfigHacienda | null {
  const url = (entorno.LEDGER_HACIENDA_URL ?? "").trim().replace(/\/+$/, "");
  const nit = (entorno.LEDGER_HACIENDA_NIT ?? "").trim();
  const clave = (entorno.LEDGER_HACIENDA_CLAVE ?? "").trim();
  // Keys in an environment variable usually arrive with literal \n sequences: restore the line breaks.
  const clavePrivadaFirma = (entorno.LEDGER_HACIENDA_CLAVE_FIRMA ?? "").trim().replace(/\\n/g, "\n");
  if (url === "" || nit === "" || clave === "" || clavePrivadaFirma === "") return null;
  const timeoutTexto = (entorno.LEDGER_HACIENDA_TIMEOUT_MS ?? "").trim();
  const timeoutMs = timeoutTexto === "" ? TIMEOUT_HACIENDA_POR_DEFECTO_MS : Number(timeoutTexto);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new ErrorLedger("LEDGER_HACIENDA_TIMEOUT_MS debe ser un entero de milisegundos mayor que cero.");
  }
  return { url, nit, clave, clavePrivadaFirma, timeoutMs };
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

// The answer of the service to one document. "sin-respuesta" covers a timeout or a dropped connection: the document
// did not get a verdict, so the caller puts it in contingencia and does not treat it as refused.
export type RespuestaTransmision =
  | { estado: "aceptado"; sello: string; momento: string }
  | { estado: "rechazado"; observaciones: string[]; momento: string }
  | { estado: "sin-respuesta"; motivo: string; momento: string };

// Thrown inside the client when the request got no answer. Turned into "sin-respuesta" by transmitir().
class SinRespuesta extends Error {}

type Token = { valor: string; expiraMs: number };

// Tokens last a day in the mock. Renewed a few minutes early so a request never leaves with an expired one.
const MARGEN_TOKEN_MS = 5 * 60_000;

export class ClienteHacienda {
  private readonly config: ConfigHacienda;
  private readonly fetchImpl: FetchLike;
  private readonly ahora: () => Date;
  private token: Token | null = null;

  constructor(config: ConfigHacienda, fetchImpl: FetchLike = fetch, ahora: () => Date = () => new Date()) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.ahora = ahora;
  }

  // One request with the configured timeout. Abort and network failures become SinRespuesta.
  private async pedir(ruta: string, init: RequestInit): Promise<{ estado: number; cuerpo: any }> {
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), this.config.timeoutMs);
    let respuesta: Response;
    try {
      respuesta = await this.fetchImpl(this.config.url + ruta, { ...init, signal: control.signal });
    } catch (error: any) {
      const motivo = error?.name === "AbortError" ? `sin respuesta en ${this.config.timeoutMs} ms` : String(error?.message ?? error);
      throw new SinRespuesta(motivo);
    } finally {
      clearTimeout(reloj);
    }
    const texto = await respuesta.text();
    let cuerpo: any = null;
    try {
      cuerpo = texto ? JSON.parse(texto) : null;
    } catch {
      cuerpo = texto;
    }
    return { estado: respuesta.status, cuerpo };
  }

  // POST /auth/login. The service limits logins, so the token is kept and reused until it nears its expiry.
  async autenticar(): Promise<string> {
    const ahoraMs = this.ahora().getTime();
    if (this.token !== null && this.token.expiraMs - MARGEN_TOKEN_MS > ahoraMs) return this.token.valor;
    const { estado, cuerpo } = await this.pedir("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ nit: this.config.nit, password: this.config.clave }),
    });
    const token = cuerpo?.data?.token;
    if (estado !== 200 || cuerpo?.estado !== "EXITOSO" || typeof token !== "string") {
      const mensaje = typeof cuerpo?.mensaje === "string" ? cuerpo.mensaje : "sin detalle";
      throw new ErrorLedger(`La autenticación en el servicio de prueba falló (HTTP ${estado}): ${mensaje}.`);
    }
    const expiraMs = Date.parse(String(cuerpo.data.expiresAt ?? ""));
    this.token = { valor: token, expiraMs: Number.isFinite(expiraMs) ? expiraMs : ahoraMs + 60 * 60_000 };
    return token;
  }

  // POST /dte/recepcion with the envelope of section 2.11. The document travels only as the compact JWS.
  async transmitir(documento: { identificacion: Record<string, unknown> }, jws: string, ahora: Date): Promise<RespuestaTransmision> {
    const identificacion = documento.identificacion;
    const sobre = {
      ambiente: String(identificacion.ambiente ?? "00"),
      idEnvio: 1,
      version: Number(identificacion.version),
      tipoDte: String(identificacion.tipoDte),
      documento: jws,
      codigoGeneracion: String(identificacion.codigoGeneracion),
    };
    try {
      const token = await this.autenticar();
      const { estado, cuerpo } = await this.pedir("/dte/recepcion", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(sobre),
      });
      return interpretarRecepcion(estado, cuerpo, ahora);
    } catch (error) {
      if (error instanceof SinRespuesta) {
        return { estado: "sin-respuesta", motivo: error.message, momento: ahora.toISOString() };
      }
      throw error;
    }
  }

  // POST /emisor/clave-publica. This exists in the mock only: the Ministry registers certificates out of band.
  async registrarClavePublica(clavePublicaPem: string): Promise<void> {
    const token = await this.autenticar();
    const { estado, cuerpo } = await this.pedir("/emisor/clave-publica", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ clavePublica: clavePublicaPem }),
    });
    if (estado !== 200) {
      const mensaje = typeof cuerpo?.mensaje === "string" ? cuerpo.mensaje : "sin detalle";
      throw new ErrorLedger(`El servicio de prueba no aceptó la clave pública (HTTP ${estado}): ${mensaje}.`);
    }
  }
}

// Maps the status and body of /dte/recepcion. PROCESADO carries the seal; RECHAZADO carries the observations.
export function interpretarRecepcion(estado: number, cuerpo: any, ahora: Date): RespuestaTransmision {
  const momento = ahora.toISOString();
  if (estado === 401) {
    throw new ErrorLedger("El servicio de prueba rechazó el token de autenticación (HTTP 401).");
  }
  if (cuerpo?.estado === "PROCESADO" && typeof cuerpo.selloRecibido === "string") {
    return {
      estado: "aceptado",
      sello: cuerpo.selloRecibido,
      momento: typeof cuerpo.fechaHoraRecepcion === "string" ? cuerpo.fechaHoraRecepcion : momento,
    };
  }
  if (cuerpo?.estado === "RECHAZADO" && Array.isArray(cuerpo.errores)) {
    const observaciones = cuerpo.errores.map(
      (e: any) => `${String(e?.campo ?? "root")}: ${String(e?.descripcion ?? e?.codigo ?? "error de validación")}`,
    );
    return { estado: "rechazado", observaciones, momento };
  }
  const mensaje = typeof cuerpo?.mensaje === "string" ? cuerpo.mensaje : "respuesta no reconocida";
  throw new ErrorLedger(`El servicio de prueba respondió HTTP ${estado}: ${mensaje}.`);
}

// The clients are kept per configuration, so the token is reused across documents in the same process.
const clientes = new Map<string, ClienteHacienda>();

export function clienteDeConfig(config: ConfigHacienda): ClienteHacienda {
  const clave = `${config.url}|${config.nit}|${config.clave}`;
  let cliente = clientes.get(clave);
  if (cliente === undefined) {
    cliente = new ClienteHacienda(config);
    clientes.set(clave, cliente);
  }
  return cliente;
}

// Registers the public half of the signing key in the mock. Mock only: the real Ministry has no such endpoint.
export async function registrarClaveDePrueba(config: ConfigHacienda, cliente: ClienteHacienda = clienteDeConfig(config)): Promise<string> {
  const publica = createPublicKey(config.clavePrivadaFirma).export({ type: "spki", format: "pem" }).toString();
  await cliente.registrarClavePublica(publica);
  return publica;
}
