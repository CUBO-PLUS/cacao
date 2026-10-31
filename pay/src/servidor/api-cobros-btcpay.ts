import 'server-only';

// The BTCPay calls of the payments API. They use the platform key (PAY_BTCPAY_PLATAFORMA_KEY), which can make and
// read invoices in the platform stores. The shared client (btcpay.ts) has no call for an order id or for marking an
// invoice Invalid, so those calls are made here. Reads reuse leerFactura from the shared client.
//
// Each charge's invoice carries the charge id as BTCPay's orderId: a retry can find an invoice that was made before
// its record was saved, so a second invoice is never made for the same charge.

import { ErrorBtcpay, leerFactura, configDesdeEntorno, type ConfigBtcpay, type Factura, type MetadatosCacao } from './btcpay';
import { urlBtcpay } from './url-btcpay';

const ESPERA_MS = 8000;
const ID = /^[A-Za-z0-9]{10,64}$/;

/** The platform configuration: the public address of BTCPay and the platform key. Null when either is missing. */
export async function configPlataforma(): Promise<ConfigBtcpay | null> {
  return configDesdeEntorno({
    BTCPAY_URL: (await urlBtcpay()) ?? undefined,
    BTCPAY_API_KEY: process.env.PAY_BTCPAY_PLATAFORMA_KEY,
  });
}

/**
 * The key of the businesses' stores (PAY_BTCPAY_TIENDAS_KEY, made by infra/btcpay/local/clave-tiendas.mjs). The
 * platform key has rights only on the demo stores, and each business has its own store, so the charges of a business
 * use this key. It can make stores and their Lightning, and make and read their invoices. Nothing else.
 */
export async function configTiendas(): Promise<ConfigBtcpay | null> {
  return configDesdeEntorno({
    BTCPAY_URL: (await urlBtcpay()) ?? undefined,
    BTCPAY_API_KEY: process.env.PAY_BTCPAY_TIENDAS_KEY,
  });
}

/** The BTCPay configuration that serves the charges of a product. */
export function configParaProducto(producto: string): Promise<ConfigBtcpay | null> {
  return producto === 'negocios' ? configTiendas() : configPlataforma();
}

// One call to BTCPay. Returns the status and the JSON body. A network failure or a timeout throws with estado 0.
async function pedir(
  config: ConfigBtcpay,
  metodo: 'GET' | 'POST',
  ruta: string,
  cuerpo?: unknown,
): Promise<{ status: number; json: unknown }> {
  const f = config.fetch ?? fetch;
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), config.esperaMs ?? ESPERA_MS);
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
    return { status: r.status, json };
  } catch {
    throw new ErrorBtcpay('BTCPay no respondió.', 0);
  } finally {
    clearTimeout(reloj);
  }
}

/**
 * Makes the invoice of a charge: an exact amount of sats, Lightning only, with the charge id as orderId. Returns the
 * invoice read back from BTCPay (its bolt11 and its expiry). Throws ErrorBtcpay for any refusal or failure.
 */
export async function crearFacturaCobro(
  config: ConfigBtcpay,
  entrada: { storeId: string; cobroId: string; sats: number; minutos: number; metadata: MetadatosCacao },
): Promise<Factura> {
  if (!ID.test(entrada.storeId)) throw new ErrorBtcpay('Tienda inválida.', 400);
  const r = await pedir(config, 'POST', `/api/v1/stores/${entrada.storeId}/invoices`, {
    amount: String(entrada.sats),
    currency: 'SATS',
    orderId: entrada.cobroId,
    metadata: entrada.metadata,
    checkout: {
      expirationMinutes: entrada.minutos,
      paymentMethods: ['BTC-LN'],
      defaultPaymentMethod: 'BTC-LN',
      speedPolicy: 'HighSpeed',
    },
  });
  if (r.status !== 200) throw new ErrorBtcpay(`BTCPay respondió ${r.status} al crear la factura.`, r.status);
  const id = (r.json as { id?: unknown } | null)?.id;
  if (typeof id !== 'string' || !ID.test(id)) throw new ErrorBtcpay('BTCPay no devolvió la factura.', 200);
  return leerFactura(config, entrada.storeId, id);
}

/**
 * The invoice BTCPay already made for this charge, found by its orderId. Null when there is none. Used only when a
 * reservation is taken over, so a request that died after BTCPay made the invoice does not make a second one.
 */
export async function buscarFacturaDeCobro(config: ConfigBtcpay, storeId: string, cobroId: string): Promise<string | null> {
  if (!ID.test(storeId)) throw new ErrorBtcpay('Tienda inválida.', 400);
  const q = new URLSearchParams({ orderId: cobroId, take: '10' });
  const r = await pedir(config, 'GET', `/api/v1/stores/${storeId}/invoices?${q}`);
  if (r.status !== 200) throw new ErrorBtcpay(`BTCPay respondió ${r.status} al buscar la factura.`, r.status);
  const lista = Array.isArray(r.json) ? (r.json as { id?: unknown; orderId?: unknown }[]) : [];
  const encontrada = lista.find((f) => f.orderId === cobroId && typeof f.id === 'string' && ID.test(f.id));
  return encontrada ? (encontrada.id as string) : null;
}

/** Marks an invoice Invalid, so it can no longer be paid as a charge. The caller reads the invoice again afterwards. */
export async function invalidarFactura(config: ConfigBtcpay, storeId: string, facturaId: string): Promise<void> {
  if (!ID.test(storeId) || !ID.test(facturaId)) throw new ErrorBtcpay('Factura inválida.', 400);
  const r = await pedir(config, 'POST', `/api/v1/stores/${storeId}/invoices/${facturaId}/status`, { status: 'Invalid' });
  if (r.status !== 200) throw new ErrorBtcpay(`BTCPay respondió ${r.status} al invalidar la factura.`, r.status);
}
