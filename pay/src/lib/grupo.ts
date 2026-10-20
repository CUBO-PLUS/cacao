/** The products of the Cacao group. Each product keeps its own copy of this list. */
export type ProductoId = 'cacao' | 'media' | 'travel' | 'market' | 'pay' | 'ledger';

export interface Producto {
  id: ProductoId;
  /** The second half of the lower case wordmark; "cacao" comes first in the heavier weight. */
  marca: string;
  url: string;
  linea: string;
}

export const URL_CACAO = 'https://cacao-grupo.vercel.app';
export const URL_PAY = 'https://cacao-pay.vercel.app';
export const URL_LEDGER = 'https://cacao-cuentas.vercel.app';

export const GRUPO_FRASE =
  'Cacao es la empresa. Media, Travel, Market, Pay y Ledger son la plataforma: el dinero llega, se gasta en lo local, se declara y se cuenta.';

export const PRODUCTOS: Producto[] = [
  { id: 'cacao', marca: '', url: URL_CACAO, linea: 'La empresa y la plataforma. De aquí salen los demás.' },
  { id: 'media', marca: 'media', url: 'https://cacao-media.vercel.app', linea: 'Historias de El Salvador, grano a grano' },
  { id: 'travel', marca: 'travel', url: 'https://cacao-travel.vercel.app', linea: 'Experiencias en El Salvador, con precio en sats' },
  { id: 'market', marca: 'market', url: 'https://cacao-market.vercel.app', linea: 'Productos y servicios locales, pagados en sats' },
  { id: 'pay', marca: 'pay', url: URL_PAY, linea: 'Mandá dinero a El Salvador y mirá cada centavo' },
  { id: 'ledger', marca: 'ledger', url: URL_LEDGER, linea: 'Cobrá y declará: la venta y su factura electrónica' },
];
