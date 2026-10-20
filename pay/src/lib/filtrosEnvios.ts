import type { EstadoEnvio } from './transferencias';

// The filters of the sender's list (/envios), read from and written to the query string. Pure, so the
// page and the links use the same rules, and the tests can check them.

export const FILTROS_ESTADO = ['todos', 'porPagar', 'enCamino', 'entregados', 'cancelados'] as const;
export type FiltroEstado = (typeof FILTROS_ESTADO)[number];

export const ETIQUETA_FILTRO: Record<FiltroEstado, string> = {
  todos: 'Todos',
  porPagar: 'Por pagar',
  enCamino: 'En camino',
  entregados: 'Entregados',
  cancelados: 'Cancelados o fallidos',
};

const ESTADOS_DE_FILTRO: Record<FiltroEstado, EstadoEnvio[] | null> = {
  todos: null,
  porPagar: ['creada'],
  enCamino: ['procesando'],
  entregados: ['completada'],
  cancelados: ['cancelada', 'fallida'],
};

const TEXTO_VACIO: Record<FiltroEstado, string> = {
  todos: 'Todavía no enviaste dinero.',
  porPagar: 'No tenés envíos por pagar.',
  enCamino: 'No hay envíos en camino ahora.',
  entregados: 'Todavía no hay envíos entregados.',
  cancelados: 'No hay envíos cancelados ni fallidos.',
};

const LARGO_BUSQUEDA = 60;

/** The states a filter shows, or null for all of them. */
export function estadosDeFiltro(filtro: FiltroEstado): EstadoEnvio[] | null {
  return ESTADOS_DE_FILTRO[filtro];
}

/**
 * The search text, reduced to letters, digits, spaces and dashes. It goes into a database filter, so
 * commas, parentheses and asterisks are removed. At most 60 characters.
 */
export function limpiarBusqueda(texto: string | null | undefined): string {
  const limpio = (texto ?? '').replace(/[^\p{L}\p{N} -]/gu, '').replace(/\s+/g, ' ').trim();
  return Array.from(limpio).slice(0, LARGO_BUSQUEDA).join('').trim();
}

function primerValor(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

/** The filter, search and page of the list from the URL. Anything unknown means the default. */
export function parsearFiltros(params: Record<string, string | string[] | undefined>): {
  filtro: FiltroEstado;
  busqueda: string;
  pagina: number;
} {
  const estado = primerValor(params.estado);
  const filtro = (FILTROS_ESTADO as readonly string[]).includes(estado ?? '') ? (estado as FiltroEstado) : 'todos';
  const pagina = primerValor(params.pagina);
  return {
    filtro,
    busqueda: limpiarBusqueda(primerValor(params.q)),
    pagina: pagina && /^\d{1,6}$/.test(pagina) && Number(pagina) >= 1 ? Number(pagina) : 1,
  };
}

/** The link to the list with these filters. Defaults are left out of the query string. */
export function enlaceDeFiltros(filtro: FiltroEstado, busqueda: string, pagina = 1, base = '/envios'): string {
  const query = new URLSearchParams();
  if (filtro !== 'todos') query.set('estado', filtro);
  if (busqueda) query.set('q', busqueda);
  if (pagina > 1) query.set('pagina', String(pagina));
  const texto = query.toString();
  return texto ? `${base}?${texto}` : base;
}

/** What an empty list says, for the filter and the search on screen. */
export function textoVacio(filtro: FiltroEstado, busqueda: string): string {
  if (busqueda) return `No encontramos envíos para "${busqueda}".`;
  return TEXTO_VACIO[filtro];
}
