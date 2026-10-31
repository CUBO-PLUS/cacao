// Where to spend bitcoin: the list of businesses from BTC Map. Pure functions, shared by the server page and the
// browser. None of them keep a position or a request.

export type Categoria = 'comida' | 'cafe' | 'tiendas' | 'servicios' | 'hospedaje' | 'otros';

export type Lugar = {
  id: number;
  nombre: string;
  lat: number;
  lon: number;
  categoria: Categoria;
  web?: string;
  verificado: string;
};

// The filter chips, in the order they show. `tipo` is the plain word shown for each business.
export const CATEGORIAS: ReadonlyArray<{ clave: Categoria; etiqueta: string; tipo: string }> = [
  { clave: 'comida', etiqueta: 'Comida', tipo: 'Comida' },
  { clave: 'cafe', etiqueta: 'Cafés', tipo: 'Café' },
  { clave: 'tiendas', etiqueta: 'Tiendas', tipo: 'Tienda' },
  { clave: 'servicios', etiqueta: 'Servicios', tipo: 'Servicio' },
  { clave: 'hospedaje', etiqueta: 'Hospedaje', tipo: 'Hospedaje' },
  { clave: 'otros', etiqueta: 'Otros', tipo: 'Otro negocio' },
];

export const POR_PAGINA = 20;
export const LARGO_BUSQUEDA = 60;

export function categoriaDeTexto(valor: string | undefined): Categoria | null {
  return CATEGORIAS.find((c) => c.clave === valor)?.clave ?? null;
}

export function tipoDe(categoria: Categoria): string {
  return CATEGORIAS.find((c) => c.clave === categoria)?.tipo ?? 'Otro negocio';
}

// Lower case, no accents, single spaces: "Café" and "cafe" match each other.
export function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// The search text from the URL: trimmed, single spaces, cut to a short length.
export function busquedaDeTexto(valor: string | undefined): string {
  return (valor ?? '').replace(/\s+/g, ' ').trim().slice(0, LARGO_BUSQUEDA);
}

// Alphabetical by name, Spanish order.
export function ordenar(lugares: readonly Lugar[]): Lugar[] {
  return [...lugares].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

export function filtrarLugares(
  lugares: readonly Lugar[],
  opciones: { busqueda: string; categoria: Categoria | null },
): Lugar[] {
  const buscado = normalizar(opciones.busqueda);
  const coincidencias = lugares.filter(
    (l) =>
      (opciones.categoria === null || l.categoria === opciones.categoria) &&
      (buscado === '' || normalizar(l.nombre).includes(buscado)),
  );
  return ordenar(coincidencias);
}

// A page number from the URL. Anything that is not a whole number from 1 up is the first page.
export function paginaDe(valor: string | string[] | undefined): number {
  const texto = Array.isArray(valor) ? valor[0] : valor;
  return texto && /^\d+$/.test(texto) && Number(texto) >= 1 ? Number(texto) : 1;
}

export function paginar<T>(lista: readonly T[], pagina: number, porPagina = POR_PAGINA) {
  const totalPaginas = Math.max(1, Math.ceil(lista.length / porPagina));
  const actual = Math.min(pagina, totalPaginas);
  const inicio = (actual - 1) * porPagina;
  return {
    items: lista.slice(inicio, inicio + porPagina),
    total: lista.length,
    pagina: actual,
    totalPaginas,
  };
}

// The website when the listing has an https one, otherwise the BTC Map page of the business.
export function enlaceDeLugar(lugar: Pick<Lugar, 'id' | 'web'>): { href: string; etiqueta: string } {
  if (lugar.web && /^https:\/\/[^\s]+$/.test(lugar.web)) return { href: lugar.web, etiqueta: 'Sitio web' };
  return { href: `https://btcmap.org/merchant/${lugar.id}`, etiqueta: 'Ficha en BTC Map' };
}

// Great-circle distance in kilometres.
export function distanciaKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = (grados: number) => (grados * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// The nearest businesses to a point, with their distance in kilometres.
export function cercanos(
  lugares: readonly Lugar[],
  lat: number,
  lon: number,
  cantidad: number,
): Array<{ lugar: Lugar; km: number }> {
  return lugares
    .map((lugar) => ({ lugar, km: distanciaKm(lat, lon, lugar.lat, lugar.lon) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, cantidad);
}

const formatoKm = new Intl.NumberFormat('es-SV', { maximumFractionDigits: 1 });

export function formatoDistancia(km: number): string {
  if (km < 1) return `a ${Math.max(10, Math.round((km * 1000) / 10) * 10)} m`;
  return `a ${formatoKm.format(km)} km`;
}

// "2026-10-31" -> "31 de octubre de 2026". Read as a calendar date, never shifted by the time zone.
export function fechaLarga(iso: string): string {
  const [anio, mes, dia] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('es-SV', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(anio, mes - 1, dia)),
  );
}

// The list's own address with its filters. Empty values are left out; page 1 has no page parameter.
export function hrefLista(filtros: { busqueda?: string; categoria?: Categoria | null; pagina?: number }): string {
  const params = new URLSearchParams();
  if (filtros.busqueda) params.set('q', filtros.busqueda);
  if (filtros.categoria) params.set('categoria', filtros.categoria);
  if (filtros.pagina && filtros.pagina > 1) params.set('pagina', String(filtros.pagina));
  const texto = params.toString();
  return texto ? `/donde-gastar?${texto}` : '/donde-gastar';
}
