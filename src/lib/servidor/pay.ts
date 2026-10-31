// CacaoPay payments API for Cacao Media, version 1 (see pay/docs/api.md, section 7). Server only.
// The key and the notice secret stay here: they never reach a page script.
// Only Node's own modules and fetch, so the unit tests load this file under plain Node.
//
// A charge counts as paid only when CacaoPay says it is "pagado": CacaoPay has read BTCPay for that. A notice only
// says "look again", so its body is never trusted, even with a valid signature.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export type ConfigPay = {
  /** Public base address of CacaoPay, without a trailing slash. */
  url: string;
  /** API key of this product's client. Sent as a Bearer token. */
  clave: string;
  /** Secret that signs the notices (Cacao-Firma). Null when not set: every notice is then refused. */
  avisoSecreto: string | null;
  /** Replaced in tests. */
  fetch?: typeof fetch;
  /** Milliseconds before a call gives up. */
  esperaMs?: number;
};

/** What CacaoPay says about one charge, as this product reads it. */
export type CobroPay = {
  id: string;
  estado: string;
  factura: string;
  sats: number;
  usd_centavos: number;
  expira_en: string;
  pago_tardio: boolean;
};

export type EntradaCobroPay = {
  /** Idempotency-Key: the same key gives the same invoice. */
  clave: string;
  sats: number;
  descripcion: string;
  referencia: string;
  venceEnSegundos: number;
  avisoUrl: string;
};

export type AvisoPay = { aviso: string; tipo: string; id: string; estado: string };

export class ErrorPay extends Error {
  readonly estado: number;
  constructor(mensaje: string, estado: number) {
    super(mensaje);
    this.estado = estado;
  }
}

const ESPERA_MS = 10_000;
/** A notice is refused when its timestamp is further than this from now (seconds). The same window CacaoPay uses. */
const TOLERANCIA_AVISO_S = 300;
/** A pending invoice must still have this much time left to be shown and paid. */
const MARGEN_MS = 60_000;
const ID_CON_GUIONES = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Reads the connection from the environment. Null unless both the URL and the API key are set: then charges stay on BTCPay. */
export function configDesdeEntornoPay(entorno: Record<string, string | undefined>): ConfigPay | null {
  const url = (entorno.CACAO_PAY_URL ?? '').trim().replace(/\/+$/, '');
  const clave = (entorno.CACAO_PAY_API_KEY ?? '').trim();
  if (!/^https?:\/\/[^/\s]+$/.test(url) || !clave) return null;
  const avisoSecreto = (entorno.CACAO_PAY_AVISO_SECRET ?? '').trim() || null;
  return { url, clave, avisoSecreto };
}

function variable(nombre: string): string | undefined {
  // Astro exposes .env values through import.meta.env; a deployed function has them in process.env.
  const deAstro = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
  return deAstro[nombre] ?? process.env[nombre];
}

/** The CacaoPay connection, or null. Null means: charge through BTCPay, as before. */
export function configPay(): ConfigPay | null {
  return configDesdeEntornoPay({
    CACAO_PAY_URL: variable('CACAO_PAY_URL'),
    CACAO_PAY_API_KEY: variable('CACAO_PAY_API_KEY'),
    CACAO_PAY_AVISO_SECRET: variable('CACAO_PAY_AVISO_SECRET'),
  });
}

/** True when CacaoPay did not answer (status 0) or failed on its side (5xx). The reader is then asked to wait. */
export function payEnPausa(error: unknown): boolean {
  return error instanceof ErrorPay && (error.estado === 0 || error.estado >= 500);
}

async function llamarPay(config: ConfigPay, metodo: string, ruta: string, cabeceras: Record<string, string>, cuerpo?: unknown): Promise<unknown> {
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
      let codigo = '';
      try {
        codigo = String((JSON.parse(texto) as { error?: { codigo?: unknown } }).error?.codigo ?? '');
      } catch {
        codigo = '';
      }
      throw new ErrorPay(`CacaoPay respondió ${r.status}${codigo ? ` (${codigo})` : ''} en ${metodo} ${ruta}`, r.status);
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
    throw new ErrorPay('CacaoPay devolvió un cobro incompleto.', 502);
  }
  return c as CobroPay;
}

/** Makes the invoice. The same Idempotency-Key answers with the invoice made before, never a second one. */
export async function crearCobroPay(config: ConfigPay, entrada: EntradaCobroPay): Promise<CobroPay> {
  const cuerpo = {
    monto: entrada.sats,
    moneda: 'SATS',
    descripcion: entrada.descripcion,
    referencia: entrada.referencia,
    vence_en_segundos: entrada.venceEnSegundos,
    aviso_url: entrada.avisoUrl,
  };
  const r = await llamarPay(config, 'POST', '/api/v1/cobros/', { 'Idempotency-Key': entrada.clave }, cuerpo);
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
 * The Idempotency-Key of a reader's invoice for one story. It is derived from the newest cobro row of that reader and
 * story (null when there is none). A retry after a failure finds the same row, so it asks for the same invoice.
 */
export function claveIdempotencia(lector: string, slug: string, ultimoCobro: string | null): string {
  return `media-${sha256(`${lector}|${slug}|${ultimoCobro ?? 'primero'}`)}`;
}

/** The key for one more try, when CacaoPay answers with an invoice that can no longer be paid. */
export function claveDeReintento(clave: string, cobroPay: string): string {
  return `media-${sha256(`${clave}|${cobroPay}`)}`;
}

/** True when the invoice is pending and has enough time left to be shown and paid. */
export function cobroUtilizable(cobro: Pick<CobroPay, 'estado' | 'expira_en'>, ahora: number = Date.now()): boolean {
  return cobro.estado === 'pendiente' && Date.parse(cobro.expira_en) - ahora > MARGEN_MS;
}

/** The id stored in media_cobros.btcpay_factura_id for a CacaoPay charge: "pay" and the id without dashes. */
export function facturaIdDePay(id: string): string | null {
  return ID_CON_GUIONES.test(id) ? `pay${id.replace(/-/g, '')}` : null;
}

/** The CacaoPay charge id behind a stored invoice id, or null when the invoice was made by BTCPay directly. */
export function payIdDeFactura(facturaId: string | null): string | null {
  const m = /^pay([0-9a-f]{32})$/.exec(facturaId ?? '');
  if (!m) return null;
  const h = m[1];
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
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
 * Notice ids this process has already answered. CacaoPay repeats a notice when its answer is lost, and a repeat
 * is then ignored here. It lives in memory: the database check on the invoice state is the guarantee that holds
 * across processes.
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
  /** The local invoice of this CacaoPay charge, or null when this site has none. */
  cobroLocal(payId: string): Promise<T | null>;
  /** The charge as CacaoPay reads it now. A throw leaves the notice open, so CacaoPay sends it again. */
  leerPay(payId: string): Promise<{ estado: string }>;
  /** Opens access for the local invoice. Answers 'sin-cambio' when the database refuses it (for example, past its deadline). */
  pagar(cobro: T): Promise<'pagado' | 'sin-cambio'>;
}

/**
 * Handles a notice whose signature already checked out. The notice is only a hint: the charge is read again at
 * CacaoPay, and only a "pagado" answer opens access. A repeated id, a notice for another event, or a local invoice
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
