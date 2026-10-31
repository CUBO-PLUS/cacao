// CacaoPay payments API for CacaoMarket, version 1 (pay/docs/api.md, section 7). Server only: the key and the
// notice secret stay in the server environment. Only Node's own modules and fetch, so the unit tests load this file
// under plain Node. Same contract as the client of Media (src/lib/servidor/pay.ts at the repo root).
//
// A charge counts as paid only when CacaoPay says "pagado": CacaoPay has read BTCPay for it. A notice only says
// "look again", so its body is never trusted, even with a valid signature.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

type Entorno = Record<string, string | undefined>;

export type ConfigPay = {
  /** Public base address of CacaoPay, without a trailing slash. */
  url: string;
  /** API key of the Market client. Sent as a Bearer token. */
  clave: string;
  /** Secret that signs the notices (Cacao-Firma). Null when not set: every notice is then refused. */
  avisoSecreto: string | null;
  /** Where CacaoPay sends its notices (https). Null: charges are made without aviso_url and the payment screen polls. */
  avisoUrl: string | null;
  /** Replaced in tests. */
  fetch?: typeof fetch;
  /** Milliseconds before a call gives up. */
  esperaMs?: number;
};

/** What CacaoPay says about one charge, as this product reads it. */
export type CobroPay = {
  id: string;
  estado: string;
  /** The Lightning invoice (BOLT11) the buyer pays. */
  factura: string;
  sats: number;
  usd_centavos: number;
  expira_en: string;
  pago_tardio: boolean;
};

export type EntradaCobroPay = {
  /** Idempotency-Key: the same key gives the same charge. */
  clave: string;
  sats: number;
  descripcion: string;
  /** The order number: CacaoPay sets BTCPay's orderId from it, and CacaoLedger matches market orders by it. */
  referencia: string;
  venceEnSegundos: number;
  /** The seller's BTCPay store. CacaoPay refuses any store that is not in the client's list. */
  tienda: string;
};

export type AvisoPay = { aviso: string; tipo: string; id: string; estado: string };

export class ErrorPay extends Error {
  readonly estado: number;
  readonly codigo: string | null;
  constructor(mensaje: string, estado: number, codigo: string | null = null) {
    super(mensaje);
    this.estado = estado;
    this.codigo = codigo;
  }
}

const ESPERA_MS = 8000;
/** A notice is refused when its timestamp is further than this from now (seconds). The window CacaoPay uses. */
const TOLERANCIA_AVISO_S = 300;
const ID_CON_GUIONES = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The referencia_externa of a CacaoPay charge: "pay:" and the charge id. */
const REFERENCIA_PAY = /^pay:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/**
 * Reads the connection from the environment. Null unless both the URL and the API key are set: then charges stay on
 * BTCPay directly, as before.
 */
export function configDesdeEntornoPay(entorno: Entorno): ConfigPay | null {
  const url = (entorno.CACAO_PAY_URL ?? '').trim().replace(/\/+$/, '');
  const clave = (entorno.CACAO_PAY_API_KEY ?? '').trim();
  if (!/^https?:\/\/[^/\s]+$/.test(url) || !clave) return null;
  const avisoSecreto = (entorno.CACAO_PAY_AVISO_SECRET ?? '').trim() || null;
  const avisoUrl = (entorno.CACAO_PAY_AVISO_URL ?? '').trim() || null;
  return { url, clave, avisoSecreto, avisoUrl };
}

/** True when CacaoPay did not answer (status 0), failed on its side (5xx) or is still making this invoice (409). */
export function payEnPausa(error: unknown): boolean {
  return error instanceof ErrorPay && (error.estado === 0 || error.estado >= 500 || error.estado === 409);
}

async function llamarPay(
  config: ConfigPay,
  metodo: string,
  ruta: string,
  cabeceras: Record<string, string>,
  cuerpo?: unknown,
): Promise<unknown> {
  const f = config.fetch ?? fetch;
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), config.esperaMs ?? ESPERA_MS);
  try {
    const r = await f(config.url + ruta, {
      method: metodo,
      headers: {
        authorization: `Bearer ${config.clave}`,
        ...(cuerpo === undefined ? {} : { 'content-type': 'application/json' }),
        ...cabeceras,
      },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      signal: control.signal,
    });
    const texto = await r.text();
    if (!r.ok) {
      // Only the error code is kept: the body may name the client, never the key.
      let codigo: string | null = null;
      try {
        codigo = String((JSON.parse(texto) as { error?: { codigo?: unknown } }).error?.codigo ?? '') || null;
      } catch {
        codigo = null;
      }
      throw new ErrorPay(`CacaoPay respondió ${r.status}${codigo ? ` (${codigo})` : ''} en ${metodo} ${ruta}`, r.status, codigo);
    }
    return texto ? JSON.parse(texto) : null;
  } catch (error) {
    if (error instanceof ErrorPay) throw error;
    throw new ErrorPay('CacaoPay no respondió.', 0);
  } finally {
    clearTimeout(reloj);
  }
}

function leerCobro(valor: unknown): CobroPay {
  const c = valor as Partial<CobroPay> | null;
  if (
    !c ||
    typeof c.id !== 'string' ||
    typeof c.estado !== 'string' ||
    typeof c.factura !== 'string' ||
    !Number.isInteger(c.sats) ||
    typeof c.expira_en !== 'string' ||
    Number.isNaN(Date.parse(c.expira_en))
  ) {
    throw new ErrorPay('CacaoPay devolvió un cobro incompleto.', 502, 'INCOMPLETO');
  }
  return c as CobroPay;
}

/** Makes the charge. The same Idempotency-Key answers with the charge made before, never a second invoice. */
export async function crearCobroPay(config: ConfigPay, entrada: EntradaCobroPay): Promise<CobroPay> {
  const cuerpo: Record<string, unknown> = {
    monto: entrada.sats,
    moneda: 'SATS',
    descripcion: entrada.descripcion,
    referencia: entrada.referencia,
    vence_en_segundos: entrada.venceEnSegundos,
    tienda: entrada.tienda,
  };
  if (config.avisoUrl) cuerpo.aviso_url = config.avisoUrl;
  const r = await llamarPay(config, 'POST', '/api/v1/cobros/', { 'Idempotency-Key': entrada.clave }, cuerpo);
  return leerCobro(r);
}

/** Cancels an unpaid charge at CacaoPay, which also invalidates its invoice. 409 when it is already paid. */
export async function cancelarCobroPay(config: ConfigPay, id: string): Promise<CobroPay> {
  const r = await llamarPay(config, 'POST', `/api/v1/cobros/${id}/cancelar/`, {});
  return leerCobro(r);
}

/** Reads a charge at CacaoPay. CacaoPay asks BTCPay while the charge is not paid. */
export async function leerCobroPay(config: ConfigPay, id: string): Promise<CobroPay> {
  const r = await llamarPay(config, 'GET', `/api/v1/cobros/${id}/`, {});
  return leerCobro(r);
}

function sha256(texto: string): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex');
}

/**
 * The Idempotency-Key of one attempt to charge an order. It is made from the order and the charge row of the attempt
 * before it (null for the first attempt). A double tap finds the same row, so it asks for the same invoice; a new
 * attempt after an expired one finds that row, so it gets a new key.
 */
export function claveIdempotenciaMarket(ordenId: string, cobroAnterior: string | null): string {
  return `market-${sha256(`${ordenId}|${cobroAnterior ?? 'primero'}`)}`;
}

/** The referencia_externa stored for a CacaoPay charge. */
export function referenciaDePay(payId: string): string {
  return `pay:${payId}`;
}

/** The CacaoPay charge id behind a stored referencia, or null when the referencia was made by BTCPay directly. */
export function payIdDeReferencia(referencia: string | null): string | null {
  const m = REFERENCIA_PAY.exec(referencia ?? '');
  return m ? m[1] : null;
}

/** True for a referencia made by CacaoPay. A BTCPay one is "<storeId>:<invoiceId>" and never matches. */
export function esReferenciaPay(referencia: string | null): boolean {
  return payIdDeReferencia(referencia) !== null;
}

/**
 * True when the notice carries a valid Cacao-Firma: "t=<seconds>,v1=<hex>", where v1 is the HMAC-SHA256 of
 * "<t>.<raw body>" with the notice secret, and t is within five minutes of now.
 */
export function avisoPayValido(cabecera: string | null, cuerpoCrudo: string, secreto: string, ahora: number = Date.now()): boolean {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(cabecera ?? '');
  if (!m || !secreto) return false;
  if (Math.abs(ahora / 1000 - Number(m[1])) > TOLERANCIA_AVISO_S) return false;
  const esperada = createHmac('sha256', secreto).update(`${m[1]}.${cuerpoCrudo}`, 'utf8').digest();
  const recibida = Buffer.from(m[2], 'hex');
  return recibida.length === esperada.length && timingSafeEqual(recibida, esperada);
}

/** The fields Cacao uses from a notice body that already passed avisoPayValido. */
export function leerAvisoPay(cuerpoCrudo: string): AvisoPay | null {
  try {
    const j = JSON.parse(cuerpoCrudo) as Record<string, unknown>;
    if (typeof j.aviso !== 'string' || typeof j.tipo !== 'string' || typeof j.id !== 'string' || typeof j.estado !== 'string') {
      return null;
    }
    if (!ID_CON_GUIONES.test(j.id)) return null;
    return { aviso: j.aviso, tipo: j.tipo, id: j.id, estado: j.estado };
  } catch {
    return null;
  }
}

const VIGENCIA_AVISO_MS = 24 * 60 * 60 * 1000;
const MAXIMO_AVISOS = 5000;

/**
 * Notice ids this process has already answered. CacaoPay repeats a notice when its answer is lost, and a repeat is
 * then ignored here. It lives in memory: the state check on the local charge is what holds across processes.
 */
export class AvisosVistos {
  private readonly vistos: Map<string, number>;
  private readonly ahora: () => number;

  constructor(ahora: () => number = Date.now) {
    this.vistos = new Map();
    this.ahora = ahora;
  }

  ya(avisoId: string): boolean {
    this.limpiar();
    return this.vistos.has(avisoId);
  }

  marcar(avisoId: string): void {
    this.vistos.set(avisoId, this.ahora());
    this.limpiar();
  }

  private limpiar(): void {
    const limite = this.ahora() - VIGENCIA_AVISO_MS;
    for (const [id, cuando] of this.vistos) {
      if (cuando < limite) this.vistos.delete(id);
    }
    while (this.vistos.size > MAXIMO_AVISOS) {
      const primero = this.vistos.keys().next().value;
      if (primero === undefined) break;
      this.vistos.delete(primero);
    }
  }
}

export type ResultadoAviso = 'repetido' | 'ignorado' | 'sin-cambio' | 'pagado';

export interface DepsAviso<T extends { estado: string }> {
  avisos: AvisosVistos;
  /** The local charge of this CacaoPay charge, or null when this site has none. */
  cobroLocal(payId: string): Promise<T | null>;
  /** The charge as CacaoPay reads it now. A throw leaves the notice open, so CacaoPay sends it again. */
  leerPay(payId: string): Promise<{ estado: string }>;
  /** Opens the order for the local charge. Answers 'sin-cambio' when the database refuses it (for example, past its deadline). */
  pagar(cobro: T): Promise<'pagado' | 'sin-cambio'>;
}

/**
 * Handles a notice whose signature already checked out. The notice is only a hint: the charge is read again at
 * CacaoPay, and only a "pagado" answer opens the order. A repeated id, a notice for another event, or a local charge
 * that is no longer pending changes nothing. An id is recorded only once it has been answered, so a failed read
 * leaves it open for the retry.
 */
export async function procesarAvisoPay<T extends { estado: string }>(
  avisoId: string,
  datos: AvisoPay,
  deps: DepsAviso<T>,
): Promise<ResultadoAviso> {
  if (deps.avisos.ya(avisoId)) return 'repetido';
  const responder = (resultado: ResultadoAviso): ResultadoAviso => {
    deps.avisos.marcar(avisoId);
    return resultado;
  };
  if (datos.tipo !== 'cobro.estado') return responder('ignorado');
  const local = await deps.cobroLocal(datos.id);
  if (!local) return responder('ignorado');
  // The state is already final (paid, expired or cancelled): nothing to read, nothing to open.
  if (local.estado !== 'pendiente') return responder('ignorado');
  const pay = await deps.leerPay(datos.id);
  if (pay.estado !== 'pagado') return responder('sin-cambio');
  return responder(await deps.pagar(local));
}
