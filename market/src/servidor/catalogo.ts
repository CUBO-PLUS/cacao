import 'server-only';

import { coincideBusqueda, patronAmplio } from '@/lib/buscar';
import { cotizacionUsdBtc } from '@/lib/precio/fuente';

import { clienteSesion } from './supabase';

// Ids come from the URL. A value that is not a UUID cannot be a row, so answer "not found"
// without asking the database.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esUuid = (id: string) => UUID.test(id);

export type Categoria = { id: number; nombre: string; orden: number };

export type ProductoCatalogo = {
  id: string;
  nombre: string;
  unidad: string;
  precioUsdCentavos: number;
  stock: number;
  foto: string | null;
  categoriaId: number;
  categoriaNombre: string;
  negocioId: string;
  negocioNombre: string;
  abierto: boolean;
  /** The shop's average rating, null when the shop has no reviews. */
  negocioPromedio: number | null;
  negocioResenas: number;
};

export type ProductoDetalle = ProductoCatalogo & { descripcion: string };

export type NegocioDetalle = {
  id: string;
  nombre: string;
  descripcion: string;
  ubicacion: string;
  abierto: boolean;
  promedio: number | null;
  cantidadResenas: number;
  productos: ProductoCatalogo[];
};

export type Resena = {
  id: string;
  puntuacion: number;
  comentario: string;
  creadaEn: string;
};

// Columns are named on purpose: the database grants column by column on `negocios`.
const COLUMNAS_PRODUCTO =
  'id, nombre, unidad, precio_usd_centavos, stock, fotos, categoria_id, categorias(nombre), negocios!inner(id, nombre, abierto)';

type FilaProducto = {
  id: string;
  nombre: string;
  unidad: string;
  precio_usd_centavos: number;
  stock: number;
  fotos: string[];
  categoria_id: number;
  categorias: { nombre: string } | null;
  negocios: { id: string; nombre: string; abierto: boolean } | null;
};

type Cliente = Awaited<ReturnType<typeof clienteSesion>>;
type Reputacion = { promedio: number | null; cantidad: number };

function aProducto(fila: FilaProducto): ProductoCatalogo | null {
  if (!fila.negocios) return null;
  return {
    id: fila.id,
    nombre: fila.nombre,
    unidad: fila.unidad,
    precioUsdCentavos: fila.precio_usd_centavos,
    stock: fila.stock,
    foto: fila.fotos[0] ?? null,
    categoriaId: fila.categoria_id,
    categoriaNombre: fila.categorias?.nombre ?? '',
    negocioId: fila.negocios.id,
    negocioNombre: fila.negocios.nombre,
    abierto: fila.negocios.abierto,
    negocioPromedio: null,
    negocioResenas: 0,
  };
}

// Characters that have a meaning in PostgREST filters or in LIKE patterns are dropped.
function textoBuscado(texto: string | undefined): string {
  return (texto ?? '').replace(/[%_*,()\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

// One query for every shop in the list, never one per card. Reviews are averaged here.
async function reputacionDeNegocios(db: Cliente, ids: string[]): Promise<Map<string, Reputacion>> {
  const mapa = new Map<string, Reputacion>();
  if (ids.length === 0) return mapa;

  const { data, error } = await db.from('resenas').select('negocio_id, puntuacion').in('negocio_id', ids);
  if (error) throw new Error(`No pudimos leer las reseñas: ${error.message}`);

  const sumas = new Map<string, { suma: number; cantidad: number }>();
  for (const r of data ?? []) {
    const previo = sumas.get(r.negocio_id) ?? { suma: 0, cantidad: 0 };
    sumas.set(r.negocio_id, { suma: previo.suma + r.puntuacion, cantidad: previo.cantidad + 1 });
  }
  for (const [id, { suma, cantidad }] of sumas) {
    mapa.set(id, { promedio: Math.round((suma / cantidad) * 10) / 10, cantidad });
  }
  return mapa;
}

export async function categorias(): Promise<Categoria[]> {
  const db = await clienteSesion();
  const { data, error } = await db
    .from('categorias')
    .select('id, nombre, orden')
    .order('orden', { ascending: true })
    .order('nombre', { ascending: true });
  if (error) throw new Error(`No pudimos leer las categorías: ${error.message}`);
  return data ?? [];
}

/** Active products of approved shops, newest first. Out-of-stock products stay listed. */
export async function productosDelCatalogo(
  filtro: { texto?: string; categoriaId?: number; negocioId?: string } = {},
): Promise<ProductoCatalogo[]> {
  if (filtro.negocioId !== undefined && !esUuid(filtro.negocioId)) return [];

  const db = await clienteSesion();
  const texto = textoBuscado(filtro.texto);

  // A search also reads the description, so the text can be checked in code (accents do not count).
  let consulta = db
    .from('productos')
    .select(texto ? `${COLUMNAS_PRODUCTO}, descripcion` : COLUMNAS_PRODUCTO)
    .eq('activo', true)
    .eq('negocios.estado', 'aprobado');

  if (texto) {
    // The database cannot ignore accents, so it gets a looser pattern and the exact check runs below.
    // Products of a shop whose name matches are included too.
    const patron = patronAmplio(texto);
    const { data: tiendas, error: errorTiendas } = await db
      .from('negocios')
      .select('id')
      .eq('estado', 'aprobado')
      .ilike('nombre', patron);
    if (errorTiendas) throw new Error(`No pudimos leer el catálogo: ${errorTiendas.message}`);

    const idsTiendas = (tiendas ?? []).map((t) => t.id);
    const condiciones = [`nombre.ilike.${patron}`, `descripcion.ilike.${patron}`];
    if (idsTiendas.length > 0) condiciones.push(`negocio_id.in.(${idsTiendas.join(',')})`);
    consulta = consulta.or(condiciones.join(','));
  }
  if (filtro.categoriaId !== undefined) consulta = consulta.eq('categoria_id', filtro.categoriaId);
  if (filtro.negocioId) consulta = consulta.eq('negocio_id', filtro.negocioId);

  const { data, error } = await consulta.order('creado_en', { ascending: false }).limit(120);
  if (error) throw new Error(`No pudimos leer el catálogo: ${error.message}`);

  const filas = (data ?? []) as unknown as (FilaProducto & { descripcion?: string })[];
  const exactas = texto
    ? filas.filter((f) =>
        coincideBusqueda(texto, [f.nombre, f.descripcion ?? '', f.negocios?.nombre ?? '']),
      )
    : filas;

  const productos = exactas.map(aProducto).filter((p): p is ProductoCatalogo => p !== null);
  const reputaciones = await reputacionDeNegocios(db, [...new Set(productos.map((p) => p.negocioId))]);
  return productos.map((p) => {
    const rep = reputaciones.get(p.negocioId);
    return { ...p, negocioPromedio: rep?.promedio ?? null, negocioResenas: rep?.cantidad ?? 0 };
  });
}

export async function productoPorId(id: string): Promise<ProductoDetalle | null> {
  if (!esUuid(id)) return null;

  const db = await clienteSesion();
  const { data, error } = await db
    .from('productos')
    .select(`${COLUMNAS_PRODUCTO}, descripcion`)
    .eq('id', id)
    .eq('activo', true)
    .eq('negocios.estado', 'aprobado')
    .maybeSingle();
  if (error) throw new Error(`No pudimos leer el producto: ${error.message}`);
  if (!data) return null;

  const fila = data as unknown as FilaProducto & { descripcion: string };
  const base = aProducto(fila);
  if (!base) return null;
  const rep = (await reputacionDeNegocios(db, [base.negocioId])).get(base.negocioId);
  return {
    ...base,
    descripcion: fila.descripcion,
    negocioPromedio: rep?.promedio ?? null,
    negocioResenas: rep?.cantidad ?? 0,
  };
}

export async function negocioPorId(id: string): Promise<NegocioDetalle | null> {
  if (!esUuid(id)) return null;

  const db = await clienteSesion();
  const [negocio, productos, puntuaciones] = await Promise.all([
    db
      .from('negocios')
      .select('id, nombre, descripcion, ubicacion, abierto')
      .eq('id', id)
      .maybeSingle(),
    productosDelCatalogo({ negocioId: id }),
    db.from('resenas').select('puntuacion').eq('negocio_id', id),
  ]);

  if (negocio.error) throw new Error(`No pudimos leer el negocio: ${negocio.error.message}`);
  if (puntuaciones.error) throw new Error(`No pudimos leer las reseñas: ${puntuaciones.error.message}`);
  if (!negocio.data) return null;

  const notas = (puntuaciones.data ?? []).map((r) => r.puntuacion);
  const promedio = notas.length
    ? Math.round((notas.reduce((suma, n) => suma + n, 0) / notas.length) * 10) / 10
    : null;

  return {
    id: negocio.data.id,
    nombre: negocio.data.nombre,
    descripcion: negocio.data.descripcion,
    ubicacion: negocio.data.ubicacion,
    abierto: negocio.data.abierto,
    promedio,
    cantidadResenas: notas.length,
    productos,
  };
}

export async function resenasDeNegocio(id: string): Promise<Resena[]> {
  if (!esUuid(id)) return [];

  const db = await clienteSesion();
  const { data, error } = await db
    .from('resenas')
    .select('id, puntuacion, comentario, creada_en')
    .eq('negocio_id', id)
    .order('creada_en', { ascending: false })
    .limit(20);
  if (error) throw new Error(`No pudimos leer las reseñas: ${error.message}`);

  return (data ?? []).map((r) => ({
    id: r.id,
    puntuacion: r.puntuacion,
    comentario: r.comentario,
    creadaEn: r.creada_en,
  }));
}

/** BTC price in USD, or null when no source answers. Pages then show USD only. */
export async function cotizacionSegura(): Promise<number | null> {
  try {
    return await cotizacionUsdBtc();
  } catch {
    return null;
  }
}
