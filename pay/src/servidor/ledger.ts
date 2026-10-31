// Reports a paid business charge to CacaoLedger (its API v1, POST /api/v1/ventas). The queue (pay_avisos, destino
// 'ledger') calls it through avisos.ts, and the Idempotency-Key is the notice id, so a retry never makes a second sale.
// Nothing here touches the charge: a failure is only a failed attempt, and the notice is due again.

/** The address and the key of the Ledger client Pay uses. Null when either is missing. */
export type ConfigLedger = { url: string; clave: string };

/** A business charge as Ledger needs it. */
export type VentaLedger = {
  /** The charge id: a stable reference, unique in Ledger for this client. */
  cobroId: string;
  /** The business the charge belongs to. */
  negocioId: string;
  descripcion: string;
  usdCentavos: number;
  sats: number;
  /** USD per BTC, two decimals, as text. */
  tasa: string;
  facturaId: string;
  /** The payment hash, 64 hex characters. */
  hash: string;
};

const TIEMPO_MAXIMO_MS = 8000;

export function configLedger(entorno: Record<string, string | undefined> = process.env): ConfigLedger | null {
  const url = (entorno.LEDGER_API_URL ?? '').trim().replace(/\/+$/, '');
  const clave = (entorno.LEDGER_API_KEY ?? '').trim();
  if (url === '' || clave === '') return null;
  return { url, clave };
}

/** The body of POST /api/v1/ventas for one business charge. The reference is the charge id, so it is unique. */
export function cuerpoVentaLedger(v: VentaLedger): string {
  return JSON.stringify({
    referencia: `pay-${v.cobroId}`,
    producto: 'negocios',
    negocio_id: v.negocioId,
    descripcion: v.descripcion.slice(0, 200),
    monto_usd_centavos: v.usdCentavos,
    medio: 'lightning',
    pago: { sats: v.sats, tasa: v.tasa, factura_id: v.facturaId, hash: v.hash },
  });
}

/**
 * Sends one business sale. Any answer other than 2xx is a failure, and the error says only the status. The request has a
 * time limit, and the key never appears in an error.
 */
export async function enviarVentaLedger(
  config: ConfigLedger,
  avisoId: string,
  venta: VentaLedger,
  opciones: { fetch?: typeof fetch; tiempoMs?: number } = {},
): Promise<void> {
  const f = opciones.fetch ?? fetch;
  const senal = AbortSignal.timeout(opciones.tiempoMs ?? TIEMPO_MAXIMO_MS);
  let respuesta: Response;
  try {
    respuesta = await f(`${config.url}/api/v1/ventas`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.clave}`,
        'content-type': 'application/json',
        'idempotency-key': avisoId,
      },
      body: cuerpoVentaLedger(venta),
      cache: 'no-store',
      signal: senal,
    });
  } catch {
    throw new Error('CacaoLedger no respondió.');
  }
  // The body is not read: it may name the sale, but a failed attempt keeps only the status.
  await respuesta.body?.cancel();
  if (respuesta.status < 200 || respuesta.status >= 300) {
    throw new Error(`CacaoLedger respondió ${respuesta.status}.`);
  }
}
