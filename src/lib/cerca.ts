import negocios from '../data/negocios.json';

// Places that accept bitcoin, from BTC Map. Runs at build time only: the page gets the few places it shows, never the file.

export interface Coordenadas {
  lat: number;
  lon: number;
}

export interface Comercio {
  id: number;
  nombre: string;
  tipo: string;
  km: number;
  /** The business's own website when it is a safe http(s) link, otherwise its BTC Map page. */
  url: string;
}

const RADIO_KM = 15;
const MAXIMO = 4;
const PRIORITARIAS = ['comida', 'cafe', 'hospedaje'];

const TIPO: Record<string, string> = {
  comida: 'Comida',
  cafe: 'Café',
  hospedaje: 'Hospedaje',
  tiendas: 'Tienda',
  servicios: 'Servicio',
  otros: 'Otro',
};

interface Lugar {
  id: number;
  nombre: string;
  lat: number;
  lon: number;
  categoria: string;
  web?: string;
  verificado: string;
}

/** Reads "13.87°N · 89.79°W" (or S and E) into signed decimal degrees. Returns null when it cannot. */
export function parsearCoordenadas(texto: string | undefined): Coordenadas | null {
  if (!texto) return null;
  const m = texto.match(/(\d{1,2}(?:\.\d+)?)\s*°?\s*([NS])\D+?(\d{1,3}(?:\.\d+)?)\s*°?\s*([EW])/i);
  if (!m) return null;
  const lat = parseFloat(m[1]) * (m[2].toUpperCase() === 'S' ? -1 : 1);
  const lon = parseFloat(m[3]) * (m[4].toUpperCase() === 'W' ? -1 : 1);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/** Great-circle distance in kilometres. */
export function distanciaKm(a: Coordenadas, b: Coordenadas): number {
  const rad = (grados: number) => (grados * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Only web addresses that start with http or https count as a website. */
function sitioSeguro(web: string | undefined): string | null {
  if (!web) return null;
  try {
    const u = new URL(web);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * Up to four places within 15 km. Comida, café and hospedaje come first, then the rest;
 * inside each group the nearest comes first.
 */
export function cercanos(texto: string | undefined): Comercio[] {
  const origen = parsearCoordenadas(texto);
  if (!origen) return [];
  const lugares = (negocios as { lugares: Lugar[] }).lugares;
  return lugares
    .map((l) => ({ l, km: distanciaKm(origen, { lat: l.lat, lon: l.lon }) }))
    .filter(({ km }) => km <= RADIO_KM)
    .sort((a, b) => {
      const grupo = (x: Lugar) => (PRIORITARIAS.includes(x.categoria) ? 0 : 1);
      return grupo(a.l) - grupo(b.l) || a.km - b.km;
    })
    .slice(0, MAXIMO)
    .map(({ l, km }) => ({
      id: l.id,
      nombre: l.nombre,
      tipo: TIPO[l.categoria] ?? 'Otro',
      km,
      url: sitioSeguro(l.web) ?? `https://btcmap.org/merchant/${l.id}`,
    }));
}

/** "240 m" under a kilometre, otherwise "1.2 km". */
export function distanciaTexto(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}
