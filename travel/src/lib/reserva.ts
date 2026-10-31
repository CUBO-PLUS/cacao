// Builds the booking that the booking API returns, and rebuilds it from a paid BTCPay invoice.
// Both paths use construirReserva, so a paid booking has the same numbers as the one priced at checkout.
// Server only. The only I/O here is reading the BTCPay address (./url-btcpay.ts); the routes fetch the catalogue and talk to BTCPay.
import { cotizar, repartir } from './reparto';
import { configDesdeEntorno, ErrorBtcpay, type ConfigBtcpay } from './btcpay';
import { ErrorPay } from './cacaopay';
import { urlBtcpay } from './url-btcpay';

/** What the reader sees when BTCPay cannot be reached. Never a stack trace. */
export const PAUSA_BTCPAY = 'Los pagos están en pausa por unos minutos. Probá de nuevo en un rato.';

/**
 * True when the payment service did not answer (status 0), failed on its side (5xx) or is rate limited (429).
 * The reader is then asked to wait. Covers BTCPay and CacaoPay.
 */
export function btcpayEnPausa(error: unknown): boolean {
  if (error instanceof ErrorPay) return error.estado === 0 || error.estado === 429 || error.estado >= 500;
  return error instanceof ErrorBtcpay && (error.estado === 0 || error.estado >= 500);
}

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

/**
 * BTCPay is used only when the URL, the key and the store id are all set. The URL comes from Supabase,
 * with BTCPAY_URL as the fallback (see ./url-btcpay.ts).
 */
export async function pagosConfigurados(
  entorno: Record<string, string | undefined>,
): Promise<{ config: ConfigBtcpay; storeId: string } | null> {
  const config = configDesdeEntorno({
    BTCPAY_URL: (await urlBtcpay({ env: entorno })) ?? undefined,
    BTCPAY_API_KEY: entorno.BTCPAY_API_KEY,
  });
  const storeId = (entorno.BTCPAY_STORE_ID ?? '').trim();
  return config && storeId ? { config, storeId } : null;
}

/**
 * What CacaoPay keeps with a charge so the paid booking can be rebuilt without a store of its own. Written by the
 * server from the catalogue and the price it computed. The price is the subtotal, so a later catalogue change never
 * changes a paid booking.
 */
export function datosDeCobro(tour: TourReserva, r: { codigo: string; fecha: string; personas: number }): Record<string, unknown> {
  const precio = cotizar(tour.data.precio, r.personas);
  return { orderId: r.codigo, tour: tour.id, fecha: r.fecha, personas: r.personas, subtotal: precio.subtotal, descuento: 0 };
}

/** The booking as the browser receives it. A paid booking adds pagada and facturaId. */
export function construirReserva(
  tour: TourReserva,
  r: DatosReserva,
  precioPagado?: ReturnType<typeof cotizar>,
): Record<string, unknown> {
  const d = tour.data;
  // A paid booking keeps the price it was paid at, even if the catalogue changed since.
  const cotizacion = precioPagado ?? cotizar(d.precio, r.personas);
  const base = {
    codigo: r.codigo,
    demo: !r.facturaId,
    creada: r.ahora,
    tour: { id: tour.id, titulo: d.titulo, lugar: d.lugar, duracion: d.duracion },
    fecha: r.fecha,
    personas: r.personas,
    ...cotizacion,
    reparto: repartir(cotizacion.total, d.historias.length > 0),
    // The free stories about the place on Cacao Media.
    lecturas: d.historias.map((slug) => ({ slug, url: `${r.mediaUrl}/historias/${slug}/` })),
  };
  return r.facturaId ? { ...base, pagada: true, facturaId: r.facturaId } : base;
}

/** The metadata written on the invoice when it is created. It is what the paid check rebuilds from. */
export function metadatosDeFactura(
  tour: TourReserva,
  r: { codigo: string; fecha: string; personas: number; cotizacionUsdBtc: number; usdCentavos: number },
) {
  const precio = cotizar(tour.data.precio, r.personas);
  return {
    subtotal: precio.subtotal,
    producto: 'travel' as const,
    orderId: r.codigo,
    itemDesc: `${tour.data.titulo} · ${r.fecha} · ${r.personas} persona(s)`,
    usdCentavos: r.usdCentavos,
    cotizacionUsdBtc: r.cotizacionUsdBtc,
    tour: tour.id,
    fecha: r.fecha,
    personas: r.personas,
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
  const { orderId, tour: tourId, fecha, personas } = metadata;
  if (!tour || tour.id !== tourId) throw new ErrorReserva('La experiencia de esta factura ya no existe.', 409);
  if (typeof orderId !== 'string' || !/^[0-9A-F]{8}$/.test(orderId)) throw new ErrorReserva('La factura no tiene una reserva válida.', 409);
  if (typeof fecha !== 'string' || typeof personas !== 'number' || !Number.isInteger(personas) || personas < 1) {
    throw new ErrorReserva('La factura no tiene una reserva válida.', 409);
  }
  const { subtotal, descuento } = metadata;
  // Invoices written before the reader discount was removed carry a descuento: their total keeps it.
  // Invoices made before the price was written on them fall back to the catalogue price.
  const precio =
    typeof subtotal === 'number' && typeof descuento === 'number'
      ? { subtotal, total: subtotal - descuento }
      : cotizar(tour.data.precio, personas);
  if (precio.total !== sats) {
    throw new ErrorReserva('El monto de la factura no coincide con la reserva. La reserva no se confirma.', 409);
  }
  return construirReserva(
    tour,
    {
      codigo: orderId,
      fecha,
      personas,
      ahora: opciones.ahora,
      mediaUrl: opciones.mediaUrl,
      facturaId: opciones.facturaId,
    },
    precio,
  );
}
