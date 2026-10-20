import 'server-only';

// Paying a Lightning invoice from the store's wallet, through the BTCPay Pay API. Used to pay the
// recipient of a Cacao Pay transfer. Kept apart from btcpay.ts, which must stay identical to its copy in
// infra/btcpay/. A payment counts as made only when BTCPay says Complete; a Pending answer is looked up
// again later with consultarPago.

import { ErrorBtcpay, type ConfigBtcpay } from './btcpay';

export type ResultadoPago = {
  estado: 'pagado' | 'pendiente' | 'fallido';
  /** Payment hash of the Lightning payment, when BTCPay gave one. */
  hash: string | null;
  /** Sentence for the recipient when the payment failed. */
  motivo: string | null;
};

const ID = /^[A-Za-z0-9]{10,64}$/;
const HASH = /^[0-9a-fA-F]{64}$/;

const MOTIVO_GENERICO = 'No pudimos pagar la factura. Pedí otra factura y probá de nuevo.';
const MOTIVOS: Record<string, string> = {
  'could-not-find-route':
    'No encontramos una ruta Lightning para pagar esa factura. Probá de nuevo más tarde o pedí otra factura.',
};

// One call to BTCPay. Only a network failure or a timeout throws here; the status is for the caller.
async function pedir(
  config: ConfigBtcpay,
  metodo: 'GET' | 'POST',
  ruta: string,
  cuerpo?: unknown,
): Promise<{ status: number; cuerpo: unknown }> {
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
    let json: unknown = null;
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {
      json = null;
    }
    return { status: r.status, cuerpo: json };
  } catch {
    throw new ErrorBtcpay('BTCPay no respondió.', 0);
  } finally {
    clearTimeout(reloj);
  }
}

function motivoDe(cuerpo: unknown): string {
  const codigo = (cuerpo as { code?: unknown } | null)?.code;
  return (typeof codigo === 'string' && MOTIVOS[codigo]) || MOTIVO_GENERICO;
}

// A 200 answer: Complete, Pending or Failed. Anything else is not something to act on.
function interpretar(cuerpo: unknown): ResultadoPago {
  const j = (cuerpo ?? {}) as { paymentHash?: unknown; status?: unknown };
  const hash = typeof j.paymentHash === 'string' && HASH.test(j.paymentHash) ? j.paymentHash.toLowerCase() : null;
  if (j.status === 'Complete') {
    if (!hash) throw new ErrorBtcpay('BTCPay no devolvió el hash del pago.', 200);
    return { estado: 'pagado', hash, motivo: null };
  }
  if (j.status === 'Pending') return { estado: 'pendiente', hash, motivo: null };
  if (j.status === 'Failed') return { estado: 'fallido', hash, motivo: MOTIVO_GENERICO };
  throw new ErrorBtcpay('BTCPay devolvió un estado que no conocemos.', 200);
}

/**
 * Pays a BOLT11 invoice from the store's wallet. A refusal (400 or 422, with a code) means no money
 * left, so it is a failed payment. Any other unexpected answer throws: the payment may or may not have
 * left, and the caller must not treat it as failed.
 */
export async function pagarFactura(config: ConfigBtcpay, storeId: string, bolt11: string): Promise<ResultadoPago> {
  if (!ID.test(storeId)) throw new ErrorBtcpay('Tienda inválida.', 400);
  const r = await pedir(config, 'POST', `/api/v1/stores/${storeId}/lightning/BTC/invoices/pay`, { BOLT11: bolt11 });
  if (r.status === 400 || r.status === 422) return { estado: 'fallido', hash: null, motivo: motivoDe(r.cuerpo) };
  if (r.status !== 200) throw new ErrorBtcpay(`BTCPay respondió ${r.status} al pagar la factura.`, r.status);
  return interpretar(r.cuerpo);
}

/** Looks up a payment by its hash. Null when BTCPay has no such payment. */
export async function consultarPago(config: ConfigBtcpay, storeId: string, hash: string): Promise<ResultadoPago | null> {
  if (!ID.test(storeId) || !HASH.test(hash)) throw new ErrorBtcpay('Pago inválido.', 400);
  const r = await pedir(config, 'GET', `/api/v1/stores/${storeId}/lightning/BTC/payments/${hash}`);
  if (r.status === 404) return null;
  if (r.status !== 200) throw new ErrorBtcpay(`BTCPay respondió ${r.status} al consultar el pago.`, r.status);
  return interpretar(r.cuerpo);
}
