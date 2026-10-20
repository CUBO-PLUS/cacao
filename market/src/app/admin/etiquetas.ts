// Labels and small formatters for the admin area. Pure: no I/O, so Client Components can import it.

import { formatoSats, formatoUsd } from '@/lib/dinero';
import {
  ETIQUETA_ESTADO,
  ETIQUETA_RESULTADO,
  RESULTADOS_CON_REEMBOLSO,
  type EstadoOrden,
  type ResultadoDisputa,
  type TipoOrden,
} from '@/lib/estados';

// The result labels live in lib/estados, next to the rules that choose them.
export { ETIQUETA_RESULTADO, type ResultadoDisputa };

export const ESTADOS_ORDEN = Object.keys(ETIQUETA_ESTADO) as EstadoOrden[];

export const ETIQUETA_TIPO: Record<TipoOrden, string> = {
  productos: 'Productos',
  servicio: 'Trabajos',
};

// Shops: the three groups on /admin/negocios.
export type EstadoNegocio = 'pendiente' | 'aprobado' | 'suspendido';
export const ETIQUETA_NEGOCIO: Record<EstadoNegocio, string> = {
  pendiente: 'Por aprobar',
  aprobado: 'Aprobado',
  suspendido: 'Suspendido',
};

// The money results: the choices on a product dispute. A job never paid has its own two (see estados).
export const RESULTADOS_DISPUTA: ResultadoDisputa[] = RESULTADOS_CON_REEMBOLSO;

export const ETIQUETA_PROVEEDOR: Record<string, string> = {
  manual: 'Lightning Address',
  falso: 'Prueba (sin pago real)',
  nwc: 'Nostr Wallet Connect',
  blink: 'Blink',
  btcpay: 'BTCPay Server (Lightning)',
};

export const ETIQUETA_COBRO: Record<string, string> = {
  pendiente: 'Pendiente',
  pagado: 'Pagado',
  expirado: 'Expirado',
  // The buyer cancelled the order before paying, so its request is closed.
  cancelado: 'Cancelado',
};

export const ETIQUETA_MODO: Record<string, string> = {
  recogida: 'Recogida en punto',
  entrega_vendedor: 'Entrega del vendedor',
};

// Keys written by the database in `auditoria.detalle`, named for the admin reader.
const NOMBRE_CLAVE: Record<string, string> = {
  desde: 'Estado anterior',
  hacia: 'Estado nuevo',
};

// El Salvador keeps UTC-6 all year. Every admin screen shows times in this zone.
export const ZONA_HORARIA = 'America/El_Salvador';

const formatoFechaHora = new Intl.DateTimeFormat('es-SV', {
  timeZone: ZONA_HORARIA,
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatoFecha(iso: string | null | undefined): string {
  if (!iso) return '—';
  return formatoFechaHora.format(new Date(iso));
}

// Sats and USD together. The USD figure is derived from today's quote, so it is marked "aprox.".
export function usdDeSats(sats: number, cotizacionUsdBtc: number): number {
  return Math.round((sats * cotizacionUsdBtc) / 1_000_000);
}

export function montoAproximado(sats: number, cotizacionUsdBtc: number | null): string {
  if (cotizacionUsdBtc === null) return `${formatoSats(sats)} · sin precio de bitcoin ahora`;
  return `${formatoSats(sats)} · aprox. ${formatoUsd(usdDeSats(sats, cotizacionUsdBtc))}`;
}

// Order totals keep the USD and sats the buyer saw at checkout, so no "aprox." here.
export function montoExacto(sats: number, usdCentavos: number): string {
  return `${formatoSats(sats)} · ${formatoUsd(usdCentavos)}`;
}

// The index is re-spent / collected. Null means nothing was collected yet.
export function porcentajeTexto(indice: number | null): string {
  if (indice === null) return 'Sin datos todavía';
  return `${(indice * 100).toFixed(1).replace('.', ',')}%`;
}

// 50376000001 -> "+503 7600 0001". Anything else is shown as stored.
export function formatoTelefono(telefono: string | null | undefined): string {
  const digitos = (telefono ?? '').replace(/\D/g, '');
  if (/^503\d{8}$/.test(digitos)) return `+503 ${digitos.slice(3, 7)} ${digitos.slice(7)}`;
  return telefono || '—';
}

export function nombreVisible(nombre: string | null | undefined): string {
  const limpio = (nombre ?? '').trim();
  return limpio === '' ? 'Sin nombre' : limpio;
}

// Audit action names come from the database: "orden.pagada", "negocio.aprobado".
export function etiquetaAccion(accion: string): string {
  const orden = /^orden\.(.+)$/.exec(accion);
  if (orden && orden[1] in ETIQUETA_ESTADO) {
    return `Orden: ${ETIQUETA_ESTADO[orden[1] as EstadoOrden]}`;
  }
  const negocio = /^negocio\.(.+)$/.exec(accion);
  if (negocio && negocio[1] in ETIQUETA_NEGOCIO) {
    return `Negocio: ${ETIQUETA_NEGOCIO[negocio[1] as EstadoNegocio].toLowerCase()}`;
  }
  return accion;
}

// Turns the audit detail into "clave: valor" lines. Never returns markup: every value is plain text.
export function detalleLegible(detalle: unknown): { clave: string; valor: string }[] {
  if (detalle === null || detalle === undefined) return [];
  if (typeof detalle !== 'object' || Array.isArray(detalle)) {
    return [{ clave: 'Detalle', valor: String(detalle) }];
  }
  return Object.entries(detalle as Record<string, unknown>).map(([clave, valor]) => ({
    clave: NOMBRE_CLAVE[clave] ?? clave,
    valor: valorLegible(clave, valor),
  }));
}

function valorLegible(clave: string, valor: unknown): string {
  if (valor === null || valor === undefined) return '—';
  if (typeof valor === 'string') {
    if (clave === 'desde' || clave === 'hacia') {
      if (valor in ETIQUETA_ESTADO) return ETIQUETA_ESTADO[valor as EstadoOrden];
      if (valor in ETIQUETA_NEGOCIO) return ETIQUETA_NEGOCIO[valor as EstadoNegocio];
    }
    return valor;
  }
  if (typeof valor === 'object') return JSON.stringify(valor);
  return String(valor);
}
