// Types shared by the cart screen and its server code. No server imports here,
// so Client Components can use them.

export type ModoEntrega = 'recogida' | 'entrega_vendedor';

export type ProductoRevisado = {
  productoId: string;
  negocioId: string;
  negocioNombre: string;
  nombre: string;
  unidad: string;
  foto: string | null;
  categoriaId: number;
  precioUsdCentavos: number;
  stock: number;
  disponible: boolean;
  /** Why the product cannot be ordered now. Null when it can. */
  motivo: string | null;
  /** The seller is a demo profile (a real business shown as an example). */
  demo: boolean;
};

export type RevisionCarrito = {
  /** Only the products the buyer can see. A missing id means the product is gone. */
  productos: ProductoRevisado[];
  /** Null when no BTC price is available: totals then show USD only. */
  cotizacion: number | null;
};
