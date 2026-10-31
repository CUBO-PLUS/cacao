import 'server-only';

import { createHash } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';

import { cotizacionUsdBtc } from '@/lib/precio/fuente';

import { registrarEvento, sesionDeVisitaCreando } from './eventos';
import {
  enteroEnLimite,
  esTipoPrecio,
  esUuid,
  LIMITES,
  textoBusqueda,
  textoEnLimite,
  type TipoPrecio,
} from '@/lib/servicios';
import type { Database } from '@/tipos/db';

import { desdeError, exito, fallo, type Resultado } from './resultado';
import { clienteServicio, clienteSesion } from './supabase';

// The session client in pages, the service client in tests. Both read the same tables.
type Cliente = SupabaseClient<Database>;

export type CategoriaServicio = { id: number; nombre: string; orden: number };

export type ServicioCatalogo = {
  id: string;
  titulo: string;
  tipoPrecio: TipoPrecio;
  precioUsdCentavos: number | null;
  unidad: string | null;
  zona: string;
  foto: string | null;
  categoriaId: number;
  categoriaNombre: string;
  negocioId: string;
  negocioNombre: string;
  abierto: boolean;
  /** BTC Map id of a demo seller, null for a normal seller. */
  btcmapId: number | null;
};

export type ServicioDetalle = ServicioCatalogo & {
  descripcion: string;
  fotos: string[];
  negocioDescripcion: string;
  promedio: number | null;
  cantidadResenas: number;
};

// A provider's own service, paused or hidden ones included.
export type ServicioMio = {
  id: string;
  titulo: string;
  descripcion: string;
  zona: string;
  tipoPrecio: TipoPrecio;
  precioUsdCentavos: number | null;
  unidad: string | null;
  activo: boolean;
  oculto: boolean;
  fotos: string[];
  categoriaId: number;
  categoriaNombre: string;
};

// What the form sends. Prices are whole USD cents: the page reads the typed text with precioDesdeTexto.
export type DatosServicio = {
  /** Null creates a service; a UUID edits one of the shop's services. */
  id: string | null;
  categoriaId: number;
  titulo: string;
  descripcion: string;
  zona: string;
  tipoPrecio: TipoPrecio;
  /** Only for fixed prices. Null for quoted services. */
  precioUsdCentavos: number | null;
  /** Only for fixed prices, for example "por corte". Null for quoted services. */
  unidad: string | null;
  activo: boolean;
  /** Public photo URLs, first one is the cover. */
  fotos: string[];
};

const MENSAJE_SESION = 'Entrá a tu cuenta para seguir.';
const MENSAJE_DATOS = 'Revisá los datos y probá de nuevo.';
const MENSAJE_CONTRATAR = 'Faltan datos para contratar el servicio.';

// Session reads name their columns: the database grants them column by column on negocios.
const COLUMNAS = [
  'id',
  'titulo',
  'descripcion',
  'zona',
  'tipo_precio',
  'precio_usd_centavos',
  'unidad',
  'fotos',
  'categoria_id',
  'categorias_servicio(nombre)',
  'negocios!inner(id, nombre, abierto, descripcion, btcmap_id)',
].join(', ');

type FilaServicio = {
  id: string;
  titulo: string;
  descripcion: string;
  zona: string;
  tipo_precio: TipoPrecio;
  precio_usd_centavos: number | null;
  unidad: string | null;
  fotos: string[];
  categoria_id: number;
  categorias_servicio: { nombre: string } | null;
  negocios: { id: string; nombre: string; abierto: boolean; descripcion: string; btcmap_id: number | null } | null;
};

const COLUMNAS_MIO =
  'id, titulo, descripcion, zona, tipo_precio, precio_usd_centavos, unidad, activo, oculto, fotos, categoria_id, categorias_servicio(nombre)';

type FilaMio = Omit<FilaServicio, 'negocios'> & { activo: boolean; oculto: boolean };

function aCatalogo(fila: FilaServicio): ServicioCatalogo | null {
  if (!fila.negocios) return null;
  return {
    id: fila.id,
    titulo: fila.titulo,
    tipoPrecio: fila.tipo_precio,
    precioUsdCentavos: fila.precio_usd_centavos,
    unidad: fila.unidad,
    zona: fila.zona,
    foto: fila.fotos[0] ?? null,
    categoriaId: fila.categoria_id,
    categoriaNombre: fila.categorias_servicio?.nombre ?? '',
    negocioId: fila.negocios.id,
    negocioNombre: fila.negocios.nombre,
    abierto: fila.negocios.abierto,
    btcmapId: fila.negocios.btcmap_id ?? null,
  };
}

function aMio(fila: FilaMio): ServicioMio {
  return {
    id: fila.id,
    titulo: fila.titulo,
    descripcion: fila.descripcion,
    zona: fila.zona,
    tipoPrecio: fila.tipo_precio,
    precioUsdCentavos: fila.precio_usd_centavos,
    unidad: fila.unidad,
    activo: fila.activo,
    oculto: fila.oculto,
    fotos: fila.fotos,
    categoriaId: fila.categoria_id,
    categoriaNombre: fila.categorias_servicio?.nombre ?? '',
  };
}

function promedio(notas: number[]): number | null {
  if (notas.length === 0) return null;
  return Math.round((notas.reduce((suma, n) => suma + n, 0) / notas.length) * 10) / 10;
}

// Next refuses to revalidate outside a request (scripts, tests). The write has already happened then.
function revalidar(ruta: string, tipo?: 'page'): void {
  try {
    revalidatePath(ruta, tipo);
  } catch {
    // No cache to clear outside a request.
  }
}

export async function categoriasServicio(): Promise<CategoriaServicio[]> {
  const db = await clienteSesion();
  const { data, error } = await db
    .from('categorias_servicio')
    .select('id, nombre, orden')
    .order('orden', { ascending: true })
    .order('nombre', { ascending: true });
  if (error) throw new Error(`No pudimos leer las categorías de servicios: ${error.message}`);
  return data ?? [];
}

export type FiltroCatalogo = { busqueda?: string; categoriaId?: number };

/**
 * Visible services, newest first, at most 60. Hidden, paused and unapproved-shop services never
 * come back: the filters say so, and the row-level policy agrees.
 */
export async function leerCatalogo(db: Cliente, filtro: FiltroCatalogo = {}): Promise<ServicioCatalogo[]> {
  if (filtro.categoriaId !== undefined && !enteroEnLimite(filtro.categoriaId, LIMITES.categoria)) return [];

  let consulta = db
    .from('servicios')
    .select(COLUMNAS)
    .eq('activo', true)
    .eq('oculto', false)
    .eq('negocios.estado', 'aprobado');

  const texto = textoBusqueda(filtro.busqueda);
  if (texto) consulta = consulta.or(`titulo.ilike.*${texto}*,descripcion.ilike.*${texto}*`);
  if (filtro.categoriaId !== undefined) consulta = consulta.eq('categoria_id', filtro.categoriaId);

  const { data, error } = await consulta.order('creado_en', { ascending: false }).limit(60);
  if (error) throw new Error(`No pudimos leer los servicios: ${error.message}`);

  const filas = (data ?? []) as unknown as FilaServicio[];
  return filas.map(aCatalogo).filter((s): s is ServicioCatalogo => s !== null);
}

export async function catalogoServicios(filtro: FiltroCatalogo = {}): Promise<ServicioCatalogo[]> {
  return leerCatalogo(await clienteSesion(), filtro);
}

/** One visible service with its shop's name and rating, or null. */
export async function leerServicioPublico(db: Cliente, id: string): Promise<ServicioDetalle | null> {
  if (!esUuid(id)) return null;

  const { data, error } = await db
    .from('servicios')
    .select(COLUMNAS)
    .eq('id', id)
    .eq('activo', true)
    .eq('oculto', false)
    .eq('negocios.estado', 'aprobado')
    .maybeSingle();
  if (error) throw new Error(`No pudimos leer el servicio: ${error.message}`);
  if (!data) return null;

  const fila = data as unknown as FilaServicio;
  const base = aCatalogo(fila);
  if (!base || !fila.negocios) return null;

  const { data: puntuaciones, error: errorResenas } = await db
    .from('resenas')
    .select('puntuacion')
    .eq('negocio_id', fila.negocios.id);
  if (errorResenas) throw new Error(`No pudimos leer las reseñas: ${errorResenas.message}`);

  const notas = (puntuaciones ?? []).map((r) => r.puntuacion);
  return {
    ...base,
    descripcion: fila.descripcion,
    fotos: fila.fotos,
    negocioDescripcion: fila.negocios.descripcion,
    promedio: promedio(notas),
    cantidadResenas: notas.length,
  };
}

export async function servicioPublico(id: string): Promise<ServicioDetalle | null> {
  return leerServicioPublico(await clienteSesion(), id);
}

/** All services of a shop, active first, then by title. Paused and hidden ones included. */
export async function misServicios(negocioId: string): Promise<ServicioMio[]> {
  if (!esUuid(negocioId)) return [];

  const { data, error } = await clienteServicio()
    .from('servicios')
    .select(COLUMNAS_MIO)
    .eq('negocio_id', negocioId);
  if (error) throw new Error(`No pudimos leer tus servicios: ${error.message}`);

  const filas = (data ?? []) as unknown as FilaMio[];
  return filas
    .map(aMio)
    .sort((a, b) => Number(b.activo) - Number(a.activo) || a.titulo.localeCompare(b.titulo, 'es'));
}

/** One service of the shop, or null when it is not there or belongs to another shop. */
export async function miServicio(negocioId: string, servicioId: string): Promise<ServicioMio | null> {
  if (!esUuid(negocioId) || !esUuid(servicioId)) return null;

  const { data, error } = await clienteServicio()
    .from('servicios')
    .select(COLUMNAS_MIO)
    .eq('id', servicioId)
    .eq('negocio_id', negocioId)
    .maybeSingle();
  if (error) throw new Error(`No pudimos leer el servicio: ${error.message}`);
  return data ? aMio(data as unknown as FilaMio) : null;
}

async function negocioDeUsuario(usuarioId: string): Promise<Resultado<{ id: string }>> {
  if (!esUuid(usuarioId)) return fallo('DATOS_INVALIDOS', MENSAJE_SESION);

  const { data, error } = await clienteServicio()
    .from('negocios')
    .select('id')
    .eq('usuario_id', usuarioId)
    .maybeSingle();
  if (error) return desdeError(error);
  if (!data) return fallo('NO_PERMITIDO', 'Primero tenés que registrar tu negocio.');
  return exito({ id: data.id });
}

// Photos come from this project's bucket under the shop's own folder, or from the seeded files in
// public/productos. Any other URL would let a provider point at arbitrary content.
const ARCHIVO_SUBIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;
const RUTA_LOCAL = /^\/productos\/[A-Za-z0-9_\-/]+\.(jpg|jpeg|png|webp)$/;

function fotoPermitida(url: string, negocioId: string): boolean {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '');
  const prefijo = `${base}/storage/v1/object/public/productos/${negocioId}/`;
  if (base && url.startsWith(prefijo)) return ARCHIVO_SUBIDO.test(url.slice(prefijo.length));
  return RUTA_LOCAL.test(url);
}

type CamposServicio = {
  categoria: number;
  titulo: string;
  descripcion: string;
  zona: string;
  tipoPrecio: TipoPrecio;
  precioUsdCentavos: number | null;
  unidad: string | null;
  activo: boolean;
  fotos: string[];
};

// Checks everything the form sent, before any query. Photos need the shop, so they are checked later.
function validarCampos(datos: DatosServicio): Resultado<CamposServicio> {
  if (typeof datos !== 'object' || datos === null) return fallo('DATOS_INVALIDOS', MENSAJE_DATOS);
  if (datos.id !== null && !esUuid(datos.id)) {
    return fallo('DATOS_INVALIDOS', 'No encontramos ese servicio en tu negocio.');
  }
  if (!enteroEnLimite(datos.categoriaId, LIMITES.categoria)) {
    return fallo('DATOS_INVALIDOS', 'Elegí una categoría válida.');
  }
  if (!textoEnLimite(datos.titulo, LIMITES.tituloServicio)) {
    return fallo('DATOS_INVALIDOS', 'El título tiene que tener entre 2 y 80 caracteres.');
  }
  if (!textoEnLimite(datos.descripcion, LIMITES.descripcionServicio)) {
    return fallo('DATOS_INVALIDOS', 'La descripción no puede pasar de 600 caracteres.');
  }
  if (!textoEnLimite(datos.zona, LIMITES.zona)) {
    return fallo('DATOS_INVALIDOS', 'La zona no puede pasar de 160 caracteres.');
  }
  if (!esTipoPrecio(datos.tipoPrecio)) {
    return fallo('DATOS_INVALIDOS', 'Elegí si el servicio tiene precio fijo o se cotiza.');
  }
  if (typeof datos.activo !== 'boolean') {
    return fallo('DATOS_INVALIDOS', 'Indicá si el servicio está activo.');
  }
  if (
    !Array.isArray(datos.fotos) ||
    !datos.fotos.every((f): f is string => typeof f === 'string') ||
    datos.fotos.length > LIMITES.fotosServicio.maximo
  ) {
    return fallo('DATOS_INVALIDOS', `Un servicio puede tener una sola foto.`);
  }

  // A quoted service stores no price and no unit: the price comes from each job.
  let precio: number | null = null;
  let unidad: string | null = null;
  if (datos.tipoPrecio === 'fijo') {
    if (!enteroEnLimite(datos.precioUsdCentavos, LIMITES.precioCentavos)) {
      return fallo('DATOS_INVALIDOS', 'El precio tiene que estar entre $0.01 y $10,000.00.');
    }
    if (!textoEnLimite(datos.unidad, LIMITES.unidad)) {
      return fallo('DATOS_INVALIDOS', 'La unidad tiene que tener entre 1 y 40 caracteres.');
    }
    precio = datos.precioUsdCentavos;
    unidad = datos.unidad.trim();
  }

  return exito({
    categoria: datos.categoriaId,
    titulo: datos.titulo.trim(),
    descripcion: datos.descripcion.trim(),
    zona: datos.zona.trim(),
    tipoPrecio: datos.tipoPrecio,
    precioUsdCentavos: precio,
    unidad,
    activo: datos.activo,
    fotos: datos.fotos,
  });
}

async function escribirServicio(
  usuarioId: string,
  servicioId: string | null,
  campos: CamposServicio,
  negocioId: string,
): Promise<Resultado<{ id: string }>> {
  // Photos are checked against the shop here, because the shop is known only now.
  if (!campos.fotos.every((f) => fotoPermitida(f, negocioId))) {
    return fallo('DATOS_INVALIDOS', 'Una de las fotos no es válida. Subila de nuevo.');
  }

  // The generated types leave null out of uuid and number arguments, but the function takes null.
  const { data, error } = await clienteServicio().rpc('guardar_servicio', {
    p_usuario: usuarioId,
    p_servicio: servicioId as unknown as string,
    p_categoria: campos.categoria,
    p_titulo: campos.titulo,
    p_descripcion: campos.descripcion,
    p_zona: campos.zona,
    p_tipo_precio: campos.tipoPrecio,
    p_precio: campos.precioUsdCentavos as unknown as number,
    p_unidad: campos.unidad as unknown as string,
    p_activo: campos.activo,
    p_fotos: campos.fotos,
  });
  if (error) return desdeError(error);

  revalidar('/servicios');
  revalidar('/servicios/[id]', 'page');
  revalidar('/mi-negocio/servicios');
  return exito({ id: data.id });
}

/** Creates a service (datos.id null) or edits one of the user's shop. */
export async function guardarServicio(usuarioId: string, datos: DatosServicio): Promise<Resultado<{ id: string }>> {
  try {
    const campos = validarCampos(datos);
    if (!campos.ok) return campos;

    const negocio = await negocioDeUsuario(usuarioId);
    if (!negocio.ok) return negocio;

    return await escribirServicio(usuarioId, datos.id, campos.dato, negocio.dato.id);
  } catch (error) {
    return desdeError(error);
  }
}

/** Pauses or activates a service. Every other field is kept as it is. */
export async function cambiarActivoServicio(
  usuarioId: string,
  servicioId: string,
  activo: boolean,
): Promise<Resultado<{ activo: boolean }>> {
  try {
    if (!esUuid(servicioId)) return fallo('DATOS_INVALIDOS', 'No encontramos ese servicio en tu negocio.');
    if (typeof activo !== 'boolean') return fallo('DATOS_INVALIDOS', 'Indicá si el servicio está activo.');

    const negocio = await negocioDeUsuario(usuarioId);
    if (!negocio.ok) return negocio;

    const actual = await miServicio(negocio.dato.id, servicioId);
    if (!actual) return fallo('NO_ENCONTRADA', 'No encontramos ese servicio en tu negocio.');

    const r = await escribirServicio(
      usuarioId,
      actual.id,
      {
        categoria: actual.categoriaId,
        titulo: actual.titulo,
        descripcion: actual.descripcion,
        zona: actual.zona,
        tipoPrecio: actual.tipoPrecio,
        precioUsdCentavos: actual.precioUsdCentavos,
        unidad: actual.unidad,
        activo,
        fotos: actual.fotos,
      },
      negocio.dato.id,
    );
    if (!r.ok) return r;
    return exito({ activo });
  } catch (error) {
    return desdeError(error);
  }
}

// The orders share one idempotency column with product orders. The key starts with a namespace and
// names the service, so the same key for two services cannot return the wrong job. The random part is
// hashed so any key up to 100 characters fits the database limit.
function claveDeContrato(servicioId: string, clave: string): string {
  const huella = createHash('sha256').update(clave).digest('hex').slice(0, 40);
  return `servicio:${servicioId.toLowerCase()}:${huella}`;
}

/**
 * Hires a fixed-price service. The price is copied into the job now, with today's quote. The same
 * clave twice returns the job the first call made, so a double tap creates one job.
 */
export async function contratarServicio(
  usuarioId: string,
  datos: { servicioId: string; nota: string; clave: string },
): Promise<Resultado<{ ordenId: string }>> {
  try {
    if (!esUuid(usuarioId) || !esUuid(datos.servicioId)) return fallo('DATOS_INVALIDOS', MENSAJE_CONTRATAR);
    if (!textoEnLimite(datos.nota, LIMITES.nota)) {
      return fallo('DATOS_INVALIDOS', 'La nota no puede pasar de 600 caracteres.');
    }
    if (!textoEnLimite(datos.clave, LIMITES.clave)) return fallo('DATOS_INVALIDOS', MENSAJE_CONTRATAR);

    let cotizacion: number;
    try {
      cotizacion = await cotizacionUsdBtc();
    } catch {
      return fallo('SIN_COTIZACION', 'No pudimos obtener el precio del bitcoin. Probá de nuevo en un momento.');
    }

    const { data, error } = await clienteServicio().rpc('contratar_servicio', {
      p_cliente: usuarioId,
      p_servicio: datos.servicioId,
      p_nota: datos.nota.trim(),
      p_clave: claveDeContrato(datos.servicioId, datos.clave.trim()),
      p_cotizacion_btc: cotizacion,
    });
    if (error) return desdeError(error);

    await registrarEvento({
      nombre: 'acordo_trabajo',
      sesion: await sesionDeVisitaCreando(),
      usuarioId,
      ruta: `/servicios/${datos.servicioId}`,
      objeto: data.id,
      valorUsdCentavos: data.total_usd_centavos,
    });
    return exito({ ordenId: data.id });
  } catch (error) {
    return desdeError(error);
  }
}
