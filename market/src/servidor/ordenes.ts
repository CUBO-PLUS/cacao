import 'server-only';

import type { ModoEntrega, ProductoRevisado, RevisionCarrito } from '@/app/carrito/tipos';
import { esDemo } from '@/lib/demo';
import { cotizacionUsdBtc } from '@/lib/precio/fuente';

import { cotizacionSegura } from './catalogo';
import { registrarEvento, sesionDeVisitaCreando } from './eventos';
import { asegurarCobro } from './pagos';
import { desdeError, exito, fallo, type Resultado } from './resultado';
import { clienteServicio, clienteSesion } from './supabase';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MODOS: readonly ModoEntrega[] = ['recogida', 'entrega_vendedor'];
const MAX_LINEAS = 50;
const MAX_CANTIDAD = 99;
const MAX_CLAVE = 100;
const MENSAJE_DATOS = 'Revisá el carrito y probá de nuevo.';

export type LineaPedido = { productoId: string; cantidad: number };

// Checks the shape of cart lines sent by the browser. Anything else is refused before the database.
function lineasValidas(valor: unknown, minimo: number): LineaPedido[] | null {
  if (!Array.isArray(valor) || valor.length < minimo || valor.length > MAX_LINEAS) return null;
  const vistos = new Set<string>();
  const salida: LineaPedido[] = [];
  for (const item of valor) {
    if (typeof item !== 'object' || item === null) return null;
    const { productoId, cantidad } = item as Record<string, unknown>;
    if (typeof productoId !== 'string' || !UUID.test(productoId)) return null;
    if (typeof cantidad !== 'number' || !Number.isInteger(cantidad)) return null;
    if (cantidad < 1 || cantidad > MAX_CANTIDAD) return null;
    if (vistos.has(productoId)) return null;
    vistos.add(productoId);
    salida.push({ productoId, cantidad });
  }
  return salida;
}

/**
 * Creates the order for one shop and its payment request. The database returns the same order
 * for the same (buyer, clave), so a double tap creates one order.
 */
export async function crearPedido(
  usuarioId: string,
  entrada: unknown,
): Promise<Resultado<{ ordenId: string }>> {
  if (typeof entrada !== 'object' || entrada === null) return fallo('DATOS_INVALIDOS', MENSAJE_DATOS);
  const { negocioId, lineas, modo, clave } = entrada as Record<string, unknown>;

  if (typeof negocioId !== 'string' || !UUID.test(negocioId)) {
    return fallo('DATOS_INVALIDOS', MENSAJE_DATOS);
  }
  const lineasOk = lineasValidas(lineas, 1);
  if (!lineasOk) return fallo('DATOS_INVALIDOS', MENSAJE_DATOS);
  if (typeof modo !== 'string' || !MODOS.includes(modo as ModoEntrega)) {
    return fallo('DATOS_INVALIDOS', MENSAJE_DATOS);
  }
  if (typeof clave !== 'string' || clave.trim() === '' || clave.length > MAX_CLAVE) {
    return fallo('DATOS_INVALIDOS', MENSAJE_DATOS);
  }

  let cotizacion: number;
  try {
    cotizacion = await cotizacionUsdBtc();
  } catch {
    return fallo('SIN_COTIZACION', 'No pudimos obtener el precio del bitcoin. Probá de nuevo en un momento.');
  }

  try {
    const { data, error } = await clienteServicio().rpc('crear_orden', {
      p_comprador: usuarioId,
      p_negocio: negocioId,
      p_lineas: lineasOk.map((l) => ({ producto_id: l.productoId, cantidad: l.cantidad })),
      p_modo: modo as ModoEntrega,
      p_clave: clave,
      p_cotizacion: cotizacion,
    });
    if (error) return desdeError(error);
    if (!data) return fallo('ERROR', 'Algo falló de nuestro lado. Probá de nuevo en un momento.');

    // A failed payment request does not undo the order: the payment screen retries it on load.
    if (data.estado === 'creada') await asegurarCobro(data.id);

    // The order was placed from the cart. This is also where the browser's session id is first set
    // when the buyer never opened a product page in this browser.
    await registrarEvento({
      nombre: 'inicio_pedido',
      sesion: await sesionDeVisitaCreando(),
      usuarioId,
      ruta: '/carrito',
      objeto: data.id,
      valorUsdCentavos: data.total_usd_centavos,
    });
    return exito({ ordenId: data.id });
  } catch (error) {
    return desdeError(error);
  }
}

// Shape of the product rows the cart check reads. Products the buyer cannot see are not returned.
type FilaRevision = {
  id: string;
  nombre: string;
  unidad: string;
  precio_usd_centavos: number;
  stock: number;
  activo: boolean;
  fotos: string[];
  categoria_id: number;
  negocios: { id: string; nombre: string; abierto: boolean; btcmap_id: number | null } | null;
};

const COLUMNAS_REVISION =
  'id, nombre, unidad, precio_usd_centavos, stock, activo, fotos, categoria_id, negocios!inner(id, nombre, abierto, btcmap_id)';

// Same wording as the product page, so the reason does not change between screens.
function motivoNoDisponible(fila: FilaRevision): string | null {
  if (!fila.activo) return 'Ya no está a la venta.';
  if (fila.stock <= 0) return 'Este producto está agotado.';
  if (!fila.negocios || !fila.negocios.abierto) {
    return 'La tienda está cerrada por ahora. Volvé a pedir cuando abra.';
  }
  return null;
}

/**
 * Current name, price, stock and availability of the cart's products, plus the BTC price.
 * Public data: the cart page calls it before the buyer signs in.
 */
// Cart lines that are not valid (a tampered cart) are left out of the check. The screen then shows
// them as no longer available, and they are never ordered. One bad line does not block the others.
function lineasRevisables(valor: unknown[]): LineaPedido[] {
  const vistos = new Set<string>();
  const salida: LineaPedido[] = [];
  for (const item of valor.slice(0, MAX_LINEAS)) {
    if (typeof item !== 'object' || item === null) continue;
    const { productoId, cantidad } = item as Record<string, unknown>;
    if (typeof productoId !== 'string' || !UUID.test(productoId) || vistos.has(productoId)) continue;
    if (typeof cantidad !== 'number' || !Number.isInteger(cantidad) || cantidad < 1 || cantidad > MAX_CANTIDAD) {
      continue;
    }
    vistos.add(productoId);
    salida.push({ productoId, cantidad });
  }
  return salida;
}

export async function revisarCarrito(entrada: unknown): Promise<Resultado<RevisionCarrito>> {
  if (!Array.isArray(entrada)) return fallo('DATOS_INVALIDOS', MENSAJE_DATOS);
  const lineas = lineasRevisables(entrada);
  if (lineas.length === 0) return exito({ productos: [], cotizacion: await cotizacionSegura() });

  try {
    const db = await clienteSesion();
    const [consulta, cotizacion] = await Promise.all([
      db.from('productos').select(COLUMNAS_REVISION).in(
        'id',
        lineas.map((l) => l.productoId),
      ),
      cotizacionSegura(),
    ]);
    if (consulta.error) return desdeError(consulta.error);

    const filas = (consulta.data ?? []) as unknown as FilaRevision[];
    const productos: ProductoRevisado[] = filas.map((fila) => {
      const motivo = motivoNoDisponible(fila);
      return {
        productoId: fila.id,
        negocioId: fila.negocios?.id ?? '',
        negocioNombre: fila.negocios?.nombre ?? '',
        nombre: fila.nombre,
        unidad: fila.unidad,
        foto: fila.fotos[0] ?? null,
        categoriaId: fila.categoria_id,
        precioUsdCentavos: fila.precio_usd_centavos,
        stock: fila.stock,
        disponible: motivo === null,
        motivo,
        demo: esDemo(fila.negocios?.btcmap_id ?? null),
      };
    });
    return exito({ productos, cotizacion });
  } catch (error) {
    return desdeError(error);
  }
}
