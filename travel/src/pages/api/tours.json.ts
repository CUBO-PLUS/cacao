// Public catalogue. Cacao Media's story pages call this to show the experience that goes with a story.
import type { APIContext } from 'astro';
import { PARTES, PARTES_SIN_HISTORIA } from '../../lib/reparto';
import { coordenadas, personas, todosLosTours, urlTour } from '../../lib/tours';

export async function GET({ site }: APIContext) {
  const absoluta = (ruta: string) => new URL(ruta, site).href;
  const tours = (await todosLosTours()).map((t) => ({
    id: t.id,
    titulo: t.data.titulo,
    bajada: t.data.bajada,
    lugar: t.data.lugar,
    categoria: t.data.categoria,
    zona: t.data.zona,
    coords: t.data.coords ?? null,
    posicion: coordenadas(t.data.coords),
    salidas: t.data.salidas,
    duracion: t.data.duracion,
    nivel: t.data.nivel,
    grupo: personas(t.data.grupo),
    precio: t.data.precio,
    url: absoluta(urlTour(t)),
    foto: absoluta(t.data.portada),
    alt: t.data.alt,
    historias: t.data.historias,
  }));
  // reparto applies to experiences with linked stories; repartoSinHistoria to the rest.
  return Response.json({ version: 3, moneda: 'sats', demo: true, reparto: PARTES, repartoSinHistoria: PARTES_SIN_HISTORIA, tours });
}
