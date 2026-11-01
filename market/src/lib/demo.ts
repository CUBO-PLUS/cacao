// Demo sellers: real businesses from BTC Map that show in the catalog as examples. A seller with a
// btcmap_id is a demo profile. Its products and prices are examples, and no one is told the business
// sells here. Every notice wording is kept in this file, so the screens and the tests share it.

import datos from '@/data/negocios-demo.json';

export type CategoriaDemo = 'cafe' | 'comida' | 'servicios';

export type NegocioDemo = {
  btcmapId: number;
  nombre: string;
  categoria: CategoriaDemo;
  web: string;
  verificado: string;
};

const LISTA: NegocioDemo[] = (datos as { negocios: NegocioDemo[] }).negocios;

/** The curated demo sellers, in the order of the data file. */
export const NEGOCIOS_DEMO: readonly NegocioDemo[] = LISTA;

export const CORREO_DEMO = 'hola@cacaomedia.sv';

export function esDemo(btcmapId: number | null | undefined): boolean {
  return typeof btcmapId === 'number';
}

/** The notice on a demo seller's page, product page and service page. */
export function avisoDemo(nombre: string): string {
  return `Demostración. ${nombre} es un negocio real que acepta bitcoin según BTC Map, pero no participa en CacaoMarket. Productos y precios son ejemplos.`;
}

/** Shown in the cart, at checkout, and on the order and receipt pages when a demo seller is included. */
export const AVISO_PEDIDO_DEMO =
  'Pedido de demostración: se paga con bitcoin de prueba y este negocio no lo recibe.';

export const CONTACTO_DEMO = `¿Sos de este negocio? Escribinos a ${CORREO_DEMO} para quitarlo.`;

export function enlacesBtcMap(btcmapId: number): { negocio: string; licencia: string } {
  return {
    negocio: `https://btcmap.org/merchant/${btcmapId}`,
    licencia: 'https://www.openstreetmap.org/copyright',
  };
}

/** A demo seller never shows open or closed status: that would be a claim about a real business's hours. */
export function mostrarCerrado(btcmapId: number | null | undefined, abierto: boolean): boolean {
  return !esDemo(btcmapId) && !abierto;
}

export function mostrarEstadoNegocio(btcmapId: number | null | undefined): boolean {
  return !esDemo(btcmapId);
}

type ModoEntregaDemo = 'recogida' | 'entrega_vendedor';

/**
 * The delivery choices offered in the cart. A demo shop offers none: no real business has agreed to hand
 * anything over, so the order is placed without a choice and no delivery wording is shown.
 */
export function opcionesDeEntrega(demo: boolean): ModoEntregaDemo[] {
  return demo ? [] : ['recogida', 'entrega_vendedor'];
}

/** The mode sent with the order: the buyer's choice for a normal shop, pickup for a demo shop. */
export function modoDeEntrega(demo: boolean, elegido: ModoEntregaDemo): ModoEntregaDemo {
  return demo ? 'recogida' : elegido;
}

export function datosDemo(btcmapId: number | null | undefined): NegocioDemo | null {
  if (!esDemo(btcmapId)) return null;
  return LISTA.find((n) => n.btcmapId === btcmapId) ?? null;
}

/**
 * The payment adapter a shop's charges use. A demo seller with a test store charges there, in test bitcoin. One
 * with no store has nowhere to charge, so its order uses the simulated provider instead of getting stuck.
 */
export function proveedorEfectivo<T extends string>(
  tipo: T,
  btcmapId: number | null | undefined,
  tiendaBtcpay: string | null | undefined,
): T | 'falso' {
  return esDemo(btcmapId) && !tiendaBtcpay ? 'falso' : tipo;
}
