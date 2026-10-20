// Builds the booking that the booking API returns, and rebuilds it from a paid BTCPay invoice.
// Both paths use construirReserva, so a paid booking has the same numbers as the one priced at checkout.
// Server only. No I/O here: the routes fetch the catalogue and talk to BTCPay.
import { DIA, firmar } from './firma';
import { cotizar, repartir, DESCUENTO_LECTOR } from './reparto';
import { configDesdeEntorno, type ConfigBtcpay } from './btcpay';

/** Reading that comes with a booking stays open this long. */
const DIAS_DE_LECTURA = 30;

/** How long a Lightning invoice stays payable. */
export const MINUTOS_DE_PAGO = 15;

/** The catalogue fields a booking needs. Structurally compatible with a tours collection entry. */
export interface TourReserva {
  id: string;
  data: {
    titulo: string;
    lugar: string;
    duracion: string;
    precio: number;
    historias: string[];
  };
}

export interface DatosReserva {
  codigo: string;
  fecha: string;
  personas: number;
  lector: boolean;
  /** Epoch milliseconds the booking is made. */
  ahora: number;
  /** Public address of Cacao Media, where the stories live. */
  mediaUrl: string;
  /** Set when the booking was paid through BTCPay. */
  facturaId?: string;
}

/** A booking that cannot be confirmed. The estado code is the HTTP status to answer with. */
export class ErrorReserva extends Error {
  readonly estado: number;
  constructor(mensaje: string, estado: number) {
    super(mensaje);
    this.estado = estado;
  }
}

/** BTCPay is used only when the URL, the key and the store id are all set. */
export function pagosConfigurados(entorno: Record<string, string | undefined>): { config: ConfigBtcpay; storeId: string } | null {
  const config = configDesdeEntorno(entorno);
  const storeId = (entorno.BTCPAY_STORE_ID ?? '').trim();
  return config && storeId ? { config, storeId } : null;
}

/** The booking as the browser receives it. A paid booking adds pagada and facturaId. */
export function construirReserva(
  tour: TourReserva,
  r: DatosReserva,
  precioPagado?: ReturnType<typeof cotizar>,
): Record<string, unknown> {
  const d = tour.data;
  // A paid booking keeps the price it was paid at, even if the catalogue changed since.
  const cotizacion = precioPagado ?? cotizar(d.precio, r.personas, r.lector);
  const base = {
    codigo: r.codigo,
    demo: !r.facturaId,
    creada: r.ahora,
    tour: { id: tour.id, titulo: d.titulo, lugar: d.lugar, duracion: d.duracion },
    fecha: r.fecha,
    personas: r.personas,
    ...cotizacion,
    lector: r.lector,
    reparto: repartir(cotizacion.total, d.historias.length > 0),
    // The booking opens the stories about the place on Cacao Media.
    lecturas: d.historias.map((slug) => ({ slug, url: `${r.mediaUrl}/historias/${slug}/` })),
    pase: d.historias.length
      ? firmar({ tipo: 'reserva', slugs: d.historias, exp: r.ahora + DIAS_DE_LECTURA * DIA, codigo: r.codigo })
      : null,
  };
  return r.facturaId ? { ...base, pagada: true, facturaId: r.facturaId } : base;
}

/** The metadata written on the invoice when it is created. It is what the paid check rebuilds from. */
export function metadatosDeFactura(
  tour: TourReserva,
  r: { codigo: string; fecha: string; personas: number; lector: boolean; cotizacionUsdBtc: number; usdCentavos: number },
) {
  const precio = cotizar(tour.data.precio, r.personas, r.lector);
  return {
    subtotal: precio.subtotal,
    descuento: precio.descuento,
    producto: 'travel' as const,
    orderId: r.codigo,
    itemDesc: `${tour.data.titulo} · ${r.fecha} · ${r.personas} persona(s)`,
    usdCentavos: r.usdCentavos,
    cotizacionUsdBtc: r.cotizacionUsdBtc,
    tour: tour.id,
    fecha: r.fecha,
    personas: r.personas,
    descuentoLector: r.lector ? Math.round(DESCUENTO_LECTOR * 100) : 0,
  };
}

/**
 * Rebuilds a paid booking from the invoice metadata. Only this server writes invoices in the Travel store,
 * so the metadata is trusted. The price is the one written on the invoice, so a later catalogue change never
 * leaves a paid booking unconfirmed. Throws ErrorReserva (409) when the metadata is not a booking or its total
 * is not the amount paid. The fecha is not checked here: the rule "from tomorrow" applies only when the
 * booking is requested.
 */
export function reconstruirReserva(
  tour: TourReserva | undefined,
  metadata: Record<string, unknown>,
  sats: number,
  opciones: { ahora: number; mediaUrl: string; facturaId: string },
): Record<string, unknown> {
  const { orderId, tour: tourId, fecha, personas, descuentoLector } = metadata;
  if (!tour || tour.id !== tourId) throw new ErrorReserva('La experiencia de esta factura ya no existe.', 409);
  if (typeof orderId !== 'string' || !/^[0-9A-F]{8}$/.test(orderId)) throw new ErrorReserva('La factura no tiene una reserva válida.', 409);
  if (typeof fecha !== 'string' || typeof personas !== 'number' || !Number.isInteger(personas) || personas < 1) {
    throw new ErrorReserva('La factura no tiene una reserva válida.', 409);
  }
  const lector = Number(descuentoLector) > 0;
  const { subtotal, descuento } = metadata;
  // Invoices made before the price was written on them fall back to the catalogue price.
  const precio =
    typeof subtotal === 'number' && typeof descuento === 'number'
      ? { subtotal, descuento, total: subtotal - descuento }
      : cotizar(tour.data.precio, personas, lector);
  if (precio.total !== sats) {
    throw new ErrorReserva('El monto de la factura no coincide con la reserva. La reserva no se confirma.', 409);
  }
  return construirReserva(
    tour,
    {
      codigo: orderId,
      fecha,
      personas,
      lector,
      ahora: opciones.ahora,
      mediaUrl: opciones.mediaUrl,
      facturaId: opciones.facturaId,
    },
    precio,
  );
}
