// BTCPay Server client for the Cacao products. The same file is copied into each product, so keep the copies equal.
// Source of truth: infra/btcpay/btcpay.ts. Only Node's own modules: it runs in Next, Astro and the Ledger CLI.
//
// A payment counts only when BTCPay says the invoice is Settled. A webhook only says "look again": its body is
// never trusted, even with a valid signature.

import { createHmac, timingSafeEqual } from 'node:crypto';

export type ConfigBtcpay = {
  /** Public base address of BTCPay, without a trailing slash. */
  url: string;
  /** Greenfield API key. Each product gets one limited to its own stores. */
  clave: string;
  /** Replaced in tests. */
  fetch?: typeof fetch;
  /** Milliseconds before a call gives up. */
  esperaMs?: number;
};

export type EstadoFactura = 'New' | 'Processing' | 'Settled' | 'Expired' | 'Invalid';

/** What every Cacao product writes in the invoice metadata. CacaoLedger reads it to build the ticket. */
export type MetadatosCacao = {
  producto: 'media' | 'travel' | 'market' | 'pay';
  /** The product's own id for what is being paid. */
  orderId: string;
  /** One line that describes the sale, shown in the receipt and the ticket. */
  itemDesc: string;
  /** Price in US cents, VAT included, at the rate used. */
  usdCentavos: number;
  /** USD per BTC used to turn dollars into sats. */
  cotizacionUsdBtc: number;
  [clave: string]: string | number | boolean | null;
};

export type Factura = {
  id: string;
  storeId: string;
  estado: EstadoFactura;
  sats: number;
  /** BOLT11 Lightning invoice. Null when the store has no Lightning. */
  bolt11: string | null;
  /** Payment hash of the Lightning payment, once paid. */
  paymentHash: string | null;
  expiraEn: Date;
  metadata: Record<string, unknown>;
};

export class ErrorBtcpay extends Error {
  readonly estado: number;
  constructor(mensaje: string, estado: number) {
    super(mensaje);
    this.estado = estado;
  }
}

/** Reads the configuration from the environment. Null when BTCPay is not set up, so the caller can say so. */
export function configDesdeEntorno(entorno: Record<string, string | undefined>): ConfigBtcpay | null {
  const url = (entorno.BTCPAY_URL ?? '').trim().replace(/\/+$/, '');
  const clave = (entorno.BTCPAY_API_KEY ?? '').trim();
  if (!/^https?:\/\/[^/\s]+$/.test(url) || !clave) return null;
  return { url, clave };
}

const ID = /^[A-Za-z0-9]{10,64}$/;

async function llamar(config: ConfigBtcpay, metodo: string, ruta: string, cuerpo?: unknown): Promise<unknown> {
  const f = config.fetch ?? fetch;
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), config.esperaMs ?? 8000);
  try {
    const r = await f(config.url + ruta, {
      method: metodo,
      headers: { 'content-type': 'application/json', authorization: `token ${config.clave}` },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      signal: control.signal,
    });
    const texto = await r.text();
    if (!r.ok) throw new ErrorBtcpay(`BTCPay respondió ${r.status} en ${metodo} ${ruta.split('?')[0]}`, r.status);
    return texto ? JSON.parse(texto) : null;
  } catch (e) {
    if (e instanceof ErrorBtcpay) throw e;
    throw new ErrorBtcpay('BTCPay no respondió.', 0);
  } finally {
    clearTimeout(reloj);
  }
}

type FacturaApi = { id: string; storeId: string; status: EstadoFactura; amount: string; expirationTime: number; metadata?: Record<string, unknown> };
type MetodoApi = { paymentMethodId: string; destination?: string; payments?: { id?: string; status?: string }[] };

async function completar(config: ConfigBtcpay, f: FacturaApi): Promise<Factura> {
  const metodos = (await llamar(config, 'GET', `/api/v1/stores/${f.storeId}/invoices/${f.id}/payment-methods`)) as MetodoApi[];
  const ln = metodos.find((m) => m.paymentMethodId === 'BTC-LN');
  const pagado = ln?.payments?.find((p) => p.status === 'Settled');
  return {
    id: f.id,
    storeId: f.storeId,
    estado: f.status,
    sats: Number(f.amount),
    bolt11: ln?.destination ?? null,
    paymentHash: pagado?.id ?? null,
    expiraEn: new Date(f.expirationTime * 1000),
    metadata: f.metadata ?? {},
  };
}

/** Creates a Lightning invoice for an exact amount of sats. */
export async function crearFactura(
  config: ConfigBtcpay,
  entrada: { storeId: string; sats: number; minutos: number; metadata: MetadatosCacao },
): Promise<Factura> {
  if (!ID.test(entrada.storeId)) throw new ErrorBtcpay('Tienda inválida.', 400);
  if (!Number.isInteger(entrada.sats) || entrada.sats < 1) throw new ErrorBtcpay('Monto inválido.', 400);
  const f = (await llamar(config, 'POST', `/api/v1/stores/${entrada.storeId}/invoices`, {
    amount: String(entrada.sats),
    currency: 'SATS',
    metadata: entrada.metadata,
    checkout: {
      expirationMinutes: entrada.minutos,
      paymentMethods: ['BTC-LN'],
      defaultPaymentMethod: 'BTC-LN',
      speedPolicy: 'HighSpeed',
    },
  })) as FacturaApi;
  return completar(config, f);
}

/** Reads an invoice. Throws ErrorBtcpay with estado 404 when it does not exist in that store. */
export async function leerFactura(config: ConfigBtcpay, storeId: string, facturaId: string): Promise<Factura> {
  if (!ID.test(storeId) || !ID.test(facturaId)) throw new ErrorBtcpay('Factura inválida.', 400);
  const f = (await llamar(config, 'GET', `/api/v1/stores/${storeId}/invoices/${facturaId}`)) as FacturaApi;
  return completar(config, f);
}

/** Lists the settled invoices of a store, newest first. Used by CacaoLedger. */
export async function facturasPagadas(config: ConfigBtcpay, storeId: string, desde?: Date): Promise<Factura[]> {
  if (!ID.test(storeId)) throw new ErrorBtcpay('Tienda inválida.', 400);
  const q = new URLSearchParams({ status: 'Settled', take: '200' });
  if (desde) q.set('startDate', String(Math.floor(desde.getTime() / 1000)));
  const lista = (await llamar(config, 'GET', `/api/v1/stores/${storeId}/invoices?${q}`)) as FacturaApi[];
  const salida: Factura[] = [];
  for (const f of lista) salida.push(await completar(config, f));
  return salida;
}

/** Checks the BTCPay-Sig header: "sha256=" + hex HMAC-SHA256 of the raw body with the webhook secret. */
export function firmaValida(cuerpoCrudo: string, cabecera: string | null, secreto: string): boolean {
  if (!cabecera || !secreto) return false;
  const esperada = 'sha256=' + createHmac('sha256', secreto).update(cuerpoCrudo, 'utf8').digest('hex');
  const a = Buffer.from(cabecera.trim());
  const b = Buffer.from(esperada);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Reads the fields Cacao uses from a webhook body that already passed firmaValida. */
export function leerAviso(cuerpoCrudo: string): { tipo: string; facturaId: string; storeId: string } | null {
  try {
    const j = JSON.parse(cuerpoCrudo) as { type?: unknown; invoiceId?: unknown; storeId?: unknown };
    if (typeof j.type !== 'string' || typeof j.invoiceId !== 'string' || typeof j.storeId !== 'string') return null;
    if (!ID.test(j.invoiceId) || !ID.test(j.storeId)) return null;
    return { tipo: j.type, facturaId: j.invoiceId, storeId: j.storeId };
  } catch {
    return null;
  }
}

/** Link to the regtest test wallet, which pays the invoice for whoever is trying the demo. */
export function enlaceBilleteraDePrueba(config: ConfigBtcpay, bolt11: string): string | null {
  if (!/^lnbcrt[0-9a-z]+$/.test(bolt11)) return null;
  return `${config.url}/billetera?factura=${encodeURIComponent(bolt11)}`;
}
