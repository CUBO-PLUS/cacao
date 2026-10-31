import 'server-only';

// The BTCPay calls that activate a business: its store and the store's Lightning. They use the businesses' key
// (PAY_BTCPAY_TIENDAS_KEY, see configTiendas). The same steps as market/scripts/tiendas-btcpay.mjs, but only Lightning:
// the business charges at the counter by invoice, so no on-chain wallet and no webhook are made.

import { ErrorBtcpay, type ConfigBtcpay } from './btcpay';

const ESPERA_MS = 8000;
const ID = /^[A-Za-z0-9]{10,64}$/;

// One call to BTCPay. Returns the status and the JSON body. A network failure or a timeout throws with estado 0.
async function pedir(config: ConfigBtcpay, metodo: 'GET' | 'POST' | 'PUT', ruta: string, cuerpo?: unknown) {
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

/** Makes the business's store: SATS, the same expiry as a counter charge. Returns its id. */
export async function crearTiendaNegocio(config: ConfigBtcpay, nombre: string): Promise<string> {
  const r = await pedir(config, 'POST', '/api/v1/stores', {
    name: nombre.slice(0, 80),
    defaultCurrency: 'SATS',
    speedPolicy: 'HighSpeed',
    invoiceExpiration: 900,
  });
  if (r.status !== 200) throw new ErrorBtcpay(`BTCPay respondió ${r.status} al crear la tienda.`, r.status);
  const id = (r.json as { id?: unknown } | null)?.id;
  if (typeof id !== 'string' || !ID.test(id)) throw new ErrorBtcpay('BTCPay no devolvió la tienda.', 200);
  return id;
}

/**
 * A store made by an earlier attempt whose id was not saved, found by its name. Stores already claimed by a business
 * are skipped. Null when there is none. Keeps a lost id from making a second store.
 */
export async function buscarTiendaPorNombre(config: ConfigBtcpay, nombre: string, reclamadas: ReadonlySet<string>): Promise<string | null> {
  const r = await pedir(config, 'GET', '/api/v1/stores');
  if (r.status !== 200) throw new ErrorBtcpay(`BTCPay respondió ${r.status} al listar las tiendas.`, r.status);
  const lista = Array.isArray(r.json) ? (r.json as { id?: unknown; name?: unknown }[]) : [];
  const hallada = lista.find(
    (t) => t.name === nombre.slice(0, 80) && typeof t.id === 'string' && ID.test(t.id) && !reclamadas.has(t.id),
  );
  return hallada ? (hallada.id as string) : null;
}

/** Turns on Lightning for the store, through BTCPay's internal node. Repeating it changes nothing. */
export async function habilitarLightning(config: ConfigBtcpay, tienda: string): Promise<void> {
  if (!ID.test(tienda)) throw new ErrorBtcpay('Tienda inválida.', 400);
  const r = await pedir(config, 'PUT', `/api/v1/stores/${tienda}/payment-methods/BTC-LN`, {
    enabled: true,
    config: { connectionString: 'Internal Node' },
  });
  if (r.status !== 200) throw new ErrorBtcpay(`BTCPay respondió ${r.status} al activar Lightning.`, r.status);
}
