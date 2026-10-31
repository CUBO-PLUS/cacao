import datos from '@/data/negocios.json';
import { coincideBusqueda } from '@/lib/buscar';

// The directory of El Salvador businesses that accept bitcoin, from BTC Map. These are not sellers
// on CacaoMarket: the rows come only from the JSON file and never touch the database.

export const CATEGORIAS = [
  { id: 'comida', nombre: 'Comida' },
  { id: 'cafe', nombre: 'Café' },
  { id: 'tiendas', nombre: 'Tiendas' },
  { id: 'servicios', nombre: 'Servicios' },
  { id: 'hospedaje', nombre: 'Hospedaje' },
  { id: 'otros', nombre: 'Otros' },
] as const;

export type Categoria = (typeof CATEGORIAS)[number]['id'];

export type Lugar = {
  id: number;
  nombre: string;
  lat: number;
  lon: number;
  categoria: Categoria;
  verificado: string;
  web?: string;
};

export type DatosBitcoin = {
  fuente: string;
  enlace: string;
  generado: string;
  verificadosDesde: string;
  totalEnElMapa: number;
  total: number;
  porCategoria: Record<Categoria, number>;
  lugares: Lugar[];
};

export const DATOS = datos as DatosBitcoin;

export const TAMANO_PAGINA = 40;

export type Filtro = {
  texto: string;
  categoria?: Categoria;
  pagina: number;
};

/** The list sorted by name in Spanish, once, so every request starts from the same order. */
export function ordenarNegocios(lugares: Lugar[]): Lugar[] {
  return [...lugares].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

/** Keeps the businesses whose name matches the search (accents ignored) and the chosen category. */
export function filtrarNegocios(lugares: Lugar[], filtro: { texto: string; categoria?: Categoria }): Lugar[] {
  return lugares.filter(
    (l) =>
      (filtro.categoria === undefined || l.categoria === filtro.categoria) &&
      coincideBusqueda(filtro.texto, [l.nombre]),
  );
}

export type Pagina<T> = {
  items: T[];
  pagina: number;
  paginas: number;
  total: number;
};

/** One page of a list. The page number is kept inside the real range. */
export function paginar<T>(lista: T[], pagina: number, tamano: number = TAMANO_PAGINA): Pagina<T> {
  const paginas = Math.max(1, Math.ceil(lista.length / tamano));
  const actual = Math.min(Math.max(1, pagina), paginas);
  return {
    items: lista.slice((actual - 1) * tamano, actual * tamano),
    pagina: actual,
    paginas,
    total: lista.length,
  };
}

function valor(v: string | string[] | undefined): string {
  const texto = Array.isArray(v) ? v[0] : v;
  return (texto ?? '').trim();
}

/** Reads the URL parameters q, categoria and pagina. Unknown values are dropped. */
export function leerFiltro(params: Record<string, string | string[] | undefined>): Filtro {
  const texto = valor(params.q).slice(0, 80);
  const codigo = valor(params.categoria);
  const categoria = CATEGORIAS.find((c) => c.id === codigo)?.id;
  const numero = Number.parseInt(valor(params.pagina), 10);
  return {
    texto,
    categoria,
    pagina: Number.isFinite(numero) && numero > 0 ? numero : 1,
  };
}

/** The directory link for a filter state. Page 1 and empty filters leave the URL bare. */
export function enlaceDirectorio(filtro: Partial<Filtro>): string {
  const params = new URLSearchParams();
  if (filtro.texto) params.set('q', filtro.texto);
  if (filtro.categoria) params.set('categoria', filtro.categoria);
  if (filtro.pagina && filtro.pagina > 1) params.set('pagina', String(filtro.pagina));
  const texto = params.toString();
  return texto ? `/negocios-bitcoin?${texto}` : '/negocios-bitcoin';
}

/** The website of the business when BTC Map has one (http or https only), otherwise its BTC Map page. */
export function sitioDe(lugar: Lugar): { href: string; etiqueta: string } {
  if (lugar.web) {
    try {
      const url = new URL(lugar.web);
      if (url.protocol === 'https:' || url.protocol === 'http:') {
        return { href: url.href, etiqueta: 'Sitio web' };
      }
    } catch {
      // A malformed address falls back to the BTC Map page below.
    }
  }
  return { href: `https://btcmap.org/merchant/${lugar.id}`, etiqueta: 'Ficha en BTC Map' };
}

export function nombreCategoria(id: Categoria): string {
  return CATEGORIAS.find((c) => c.id === id)?.nombre ?? 'Otros';
}

const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** "2025-07-11" becomes "11 de julio de 2025". Anything else gives an empty text. */
export function fechaLarga(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return '';
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (mes < 1 || mes > 12) return '';
  return `${dia} de ${MESES[mes - 1]} de ${m[1]}`;
}
