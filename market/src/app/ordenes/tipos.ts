// Shapes shared by the server functions and the client components. Keep server code out of here.
import type { EstadoOrden, ResultadoDisputa, TipoOrden } from '@/lib/estados';

export type RolOrden = 'comprador' | 'vendedor';
export type ModoEntrega = 'recogida' | 'entrega_vendedor';

// One card in the lists. `otraParte` is the shop for the buyer and the buyer for the seller.
export type ResumenOrden = {
  id: string;
  numero: number;
  tipo: TipoOrden;
  estado: EstadoOrden;
  otraParte: string;
  totalUsdCentavos: number;
  totalSats: number;
  creadaEn: string;
  pagadaEn: string | null;
  hechaEn: string | null;
  canceladaEn: string | null;
  motivoCancelacion: string | null;
  // Units bought, summed over the lines.
  productos: number;
  // True when the viewer has a next step to take on this order.
  necesitaAccion: boolean;
};

export type LineaOrden = {
  id: string;
  nombre: string;
  unidad: string;
  cantidad: number;
  precioUsdCentavos: number;
};

export type PagoOrden = {
  proveedor: 'manual' | 'falso' | 'nwc' | 'blink' | 'btcpay';
  estado: 'pendiente' | 'pagado' | 'expirado' | 'cancelado';
};

export type ResenaOrden = {
  puntuacion: number;
  comentario: string;
  creadaEn: string;
};

export type DisputaOrden = {
  estado: 'abierta' | 'resuelta';
  resultado: ResultadoDisputa | null;
  motivo: string;
  evidencia: string;
  notaResolucion: string;
  creadaEn: string;
  resueltaEn: string | null;
  reembolsoMarcadoEn: string | null;
  reembolsoConfirmadoEn: string | null;
};

export type DetalleOrden = {
  id: string;
  numero: number;
  tipo: TipoOrden;
  estado: EstadoOrden;
  rol: RolOrden;
  otraParte: string;
  totalUsdCentavos: number;
  totalSats: number;
  cotizacionUsdBtc: number;
  // Null for a job: a job has no delivery mode.
  modoEntrega: ModoEntrega | null;
  creadaEn: string;
  pagadaEn: string | null;
  listaEn: string | null;
  entregadaEn: string | null;
  cerradaEn: string | null;
  expiradaEn: string | null;
  disputadaEn: string | null;
  resueltaEn: string | null;
  hechaEn: string | null;
  canceladaEn: string | null;
  motivoCancelacion: string | null;
  lineas: LineaOrden[];
  pago: PagoOrden | null;
  resena: ResenaOrden | null;
  disputa: DisputaOrden | null;
  // Buyer only, and only while the order is pagada or lista. The key is absent otherwise.
  codigoEntrega?: string;
};

export type Mensaje = {
  id: string;
  autorId: string;
  texto: string;
  creadoEn: string;
};

export type Aviso = {
  id: string;
  texto: string;
  ordenId: string | null;
  // Site path to open: the stored one, or /ordenes/<id> for an order notice.
  ruta: string;
  creadoEn: string;
};
