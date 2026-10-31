// Client of the CacaoPay payments API (pay/docs/api.md, section 7). Server only: the key is read from the server
// environment and never leaves this process. Used when CACAO_PAY_URL and CACAO_PAY_API_KEY are both set (see ./reserva.ts).
// Only Node's own modules: the same code runs in Astro's server build.

export type ConfigPay = {
  /** Public base address of CacaoPay, without a trailing slash. */
  url: string;
  /** The Bearer key of this product's client. */
  clave: string;
  /** Replaced in tests. */
  fetch?: typeof fetch;
  /** Milliseconds before a call gives up. */
  esperaMs?: number;
};

/** A charge as the CacaoPay API answers it (vistaCobro in pay/src/servidor/api-cobros.ts). */
export type CobroPay = {
  id: string;
  estado: 'pendiente' | 'pagado' | 'vencido' | 'cancelado';
  factura: string | null;
  sats: number;
  usd_centavos: number;
  expira_en: string | null;
  enlace_pago: string | null;
  pago_tardio: boolean;
  /** What the product stored with the charge, as it sent it. Null when it sent none. */
  datos: Record<string, unknown> | null;
};

/** A call that CacaoPay did not complete. estado is the HTTP status, or 0 when CacaoPay did not answer. */
export class ErrorPay extends Error {
  readonly estado: number;
  readonly codigo: string | null;
  constructor(mensaje: string, estado: number, codigo: string | null) {
    super(mensaje);
    this.estado = estado;
    this.codigo = codigo;
  }
}

/** Reads the configuration from the environment. Null unless both the address and the key are set. */
export function configPay(entorno: Record<string, string | undefined>): ConfigPay | null {
  const url = (entorno.CACAO_PAY_URL ?? '').trim().replace(/\/+$/, '');
  const clave = (entorno.CACAO_PAY_API_KEY ?? '').trim();
  if (!/^https?:\/\/[^/\s]+$/.test(url) || !clave) return null;
  return { url, clave };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function llamar(
  config: ConfigPay,
  metodo: string,
  ruta: string,
  cuerpo?: unknown,
  cabeceras: Record<string, string> = {},
): Promise<unknown> {
  const f = config.fetch ?? fetch;
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), config.esperaMs ?? 8000);
  try {
    const r = await f(config.url + ruta, {
      method: metodo,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.clave}`, ...cabeceras },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      signal: control.signal,
    });
    const texto = await r.text();
    if (!r.ok) {
      let codigo: string | null = null;
      try {
        codigo = (JSON.parse(texto) as { error?: { codigo?: string } }).error?.codigo ?? null;
      } catch {}
      throw new ErrorPay(`CacaoPay respondió ${r.status} en ${metodo} ${ruta}`, r.status, codigo);
    }
    return texto ? JSON.parse(texto) : null;
  } catch (e) {
    if (e instanceof ErrorPay) throw e;
    throw new ErrorPay('CacaoPay no respondió.', 0, null);
  } finally {
    clearTimeout(reloj);
  }
}

/**
 * Creates a charge in sats. The Idempotency-Key makes a repeat return the same charge and never a second invoice.
 * The datos are stored by CacaoPay and given back to this product only; the price is what the server computed.
 */
export async function crearCobroPay(
  config: ConfigPay,
  entrada: { clave: string; sats: number; descripcion: string; referencia: string; minutos: number; datos: Record<string, unknown> },
): Promise<CobroPay> {
  return (await llamar(
    config,
    'POST',
    '/api/v1/cobros/',
    {
      monto: entrada.sats,
      moneda: 'SATS',
      descripcion: entrada.descripcion,
      referencia: entrada.referencia,
      vence_en_segundos: entrada.minutos * 60,
      datos: entrada.datos,
    },
    { 'idempotency-key': entrada.clave },
  )) as CobroPay;
}

/** Reads a charge. CacaoPay asks BTCPay for its state while the charge is not paid. Malformed ids count as unknown. */
export async function leerCobroPay(config: ConfigPay, id: string): Promise<CobroPay> {
  if (!UUID.test(id)) throw new ErrorPay('Cobro no encontrado.', 404, 'NO_ENCONTRADA');
  return (await llamar(config, 'GET', `/api/v1/cobros/${id}/`)) as CobroPay;
}
