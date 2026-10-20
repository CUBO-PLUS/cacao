// Payment screen state, shared by the server page and the Client Component.
// No server imports here, so Client Components can use it.

import type { EstadoOrden, TipoOrden } from '@/lib/estados';

export type ProveedorCobro = 'manual' | 'falso' | 'nwc' | 'blink' | 'btcpay';

export type EstadoPago = {
  estado: EstadoOrden;
  // A job at 'hecha' whose request expired comes back here, so the screen can offer a new one.
  tipo: TipoOrden;
  numero: number;
  totalSats: number;
  totalUsdCentavos: number;
  /** BTC price in USD used for this order. */
  cotizacion: number;
  negocioNombre: string;
  /** Null when no payment request exists yet. */
  proveedor: ProveedorCobro | null;
  /** Only while the order waits for payment. */
  bolt11: string | null;
  destino: string | null;
  /** ISO time the request expires. Only while the order waits for payment. */
  expiraEn: string | null;
  /** Measured by the server, so a wrong phone clock does not change the countdown. */
  segundosRestantes: number | null;
};
