// Places near an experience that accept bitcoin, from the BTC Map extract in data/negocios.json.
// Runs at build time only: the page receives the few chosen places, never the whole file.
import negocios from '../data/negocios.json';
import { coordenadas } from './tours';

interface LugarBtc {
  id: number;
  nombre: string;
  lat: number;
  lon: number;
  categoria: string;
  web?: string;
  verificado: string;
}

export interface LugarCerca {
  id: number;
  nombre: string;
  /** Plain Spanish type: "Comida", "Café". */
  tipo: string;
  /** Whole kilometres, or "menos de 1". */
  distancia: string;
  enlace: string;
  /** What the link points to: the place's website or its BTC Map page. */
  enlaceTexto: string;
}

const RADIO_KM = 20;
const MAXIMO = 6;
/** Listed first, then nearest first. Other categories only fill what is left. */
const PRIMERAS = ['comida', 'cafe', 'hospedaje'];

const TIPOS: Record<string, string> = {
  comida: 'Comida',
  cafe: 'Café',
  hospedaje: 'Hospedaje',
  tiendas: 'Tienda',
  servicios: 'Servicio',
  otros: 'Otro',
};

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Great-circle distance in kilometres (haversine). Both points are [lat, lng] in degrees. */
export function distanciaKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const rad = (grados: number) => (grados * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const enlaceDe = (l: LugarBtc): { enlace: string; enlaceTexto: string } =>
  l.web && /^https?:\/\//.test(l.web)
    ? { enlace: l.web, enlaceTexto: 'Sitio web' }
    : { enlace: `https://btcmap.org/merchant/${l.id}`, enlaceTexto: 'Ver en BTC Map' };

/** Up to six places within 20 km of the experience. Empty when the experience has no coordinates or nothing is near. */
export function lugaresCercanos(coords: string | undefined): LugarCerca[] {
  const origen = coordenadas(coords);
  if (!origen) return [];
  const lugares = negocios.lugares as LugarBtc[];
  const prioridad = (categoria: string) => (PRIMERAS.includes(categoria) ? 0 : 1);

  return lugares
    .map((l) => ({ l, km: distanciaKm(origen, [l.lat, l.lon]) }))
    .filter(({ km }) => km <= RADIO_KM)
    .sort((a, b) => prioridad(a.l.categoria) - prioridad(b.l.categoria) || a.km - b.km)
    .slice(0, MAXIMO)
    .map(({ l, km }) => ({
      id: l.id,
      nombre: l.nombre,
      tipo: TIPOS[l.categoria] ?? 'Otro',
      distancia: km < 1 ? 'menos de 1' : String(Math.round(km)),
      ...enlaceDe(l),
    }));
}

/** Check date of the extract, from `generado`: "31 de octubre de 2026". */
export function fechaRevision(): string {
  const [anio, mes, dia] = negocios.generado.split('-').map(Number);
  return `${dia} de ${MESES[mes - 1]} de ${anio}`;
}
