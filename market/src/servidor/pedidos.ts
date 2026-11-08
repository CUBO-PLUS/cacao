import 'server-only';

import type { ProveedorCobro } from '@/app/ordenes/[id]/pagar/tipos';
import type {
  DetalleOrden,
  DisputaOrden,
  LineaOrden,
  PagoOrden,
  ResenaOrden,
  ResumenOrden,
  RolOrden,
} from '@/app/ordenes/tipos';
import { esDemo } from '@/lib/demo';
import { accionesPosibles, type OrdenParaAcciones } from '@/lib/estados';
import type { Database } from '@/tipos/db';

import { registrarEvento, sesionDeVisitaCreando } from './eventos';
import { cancelarCobroEnPay, confirmarPagoEnBD } from './pagos';
import { barrer } from './mantenimiento';
import { desdeError, exito, fallo, type Resultado } from './resultado';
import type { Sesion } from './sesion';
import { clienteServicio, clienteSesion } from './supabase';

type Tabla<N extends keyof Database['public']['Tables']> = Database['public']['Tables'][N]['Row'];

// Ids come from the URL or the browser. A value that is not a UUID cannot be a row.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function esUuid(valor: string): boolean {
  return UUID.test(valor);
}

// The database counts characters (code points), so count the same way.
export function largo(texto: string): number {
  return Array.from(texto).length;
}

const NO_ENCONTRADA = () => fallo('NO_ENCONTRADA', 'No encontramos esa orden.');

// Columns are named on purpose: `select *` is refused on orders. The delivery code is not listed.
const COLUMNAS_ORDEN =
  'id, numero, tipo, comprador_id, negocio_id, estado, total_usd_centavos, total_sats, cotizacion_usd_btc, modo_entrega, creada_en, pagada_en, lista_en, entregada_en, cerrada_en, expirada_en, disputada_en, resuelta_en, hecha_en, cancelada_en, motivo_cancelacion';

type FilaOrden = Pick<
  Tabla<'ordenes'>,
  | 'id'
  | 'numero'
  | 'tipo'
  | 'comprador_id'
  | 'negocio_id'
  | 'estado'
  | 'total_usd_centavos'
  | 'total_sats'
  | 'cotizacion_usd_btc'
  | 'modo_entrega'
  | 'creada_en'
  | 'pagada_en'
  | 'lista_en'
  | 'entregada_en'
  | 'cerrada_en'
  | 'expirada_en'
  | 'disputada_en'
  | 'resuelta_en'
  | 'hecha_en'
  | 'cancelada_en'
  | 'motivo_cancelacion'
>;

type FilaDisputa = Pick<
  Tabla<'disputas'>,
  | 'orden_id'
  | 'estado'
  | 'resultado'
  | 'motivo'
  | 'evidencia'
  | 'nota_resolucion'
  | 'creada_en'
  | 'resuelta_en'
  | 'reembolso_marcado_en'
  | 'reembolso_confirmado_en'
>;

// Actions that wait for the viewer. Used to group the lists; the buttons come from accionesPosibles.
const PENDIENTES = new Set([
  'pagar',
  'confirmar_pago',
  'marcar_lista',
  'marcar_entregada',
  'entregar_con_codigo',
  'marcar_reembolso',
  'confirmar_reembolso',
  // A job waiting for the provider to mark it done.
  'marcar_hecha',
]);

// Shop and buyer names come from the service role. A suspended shop is hidden from session reads,
// but its buyers still need to see whose order it is. Only id and name are read, never the phone.
/** The name shown when a party has no name on its account. The receipt leaves that row out. */
export const NOMBRE_SIN_DATO = 'Comprador';

async function nombresNegocios(ids: string[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return new Map();
  const { data, error } = await clienteServicio().from('negocios').select('id, nombre').in('id', unicos);
  if (error) {
    console.error('nombres de negocios:', error.message);
    return new Map();
  }
  return new Map((data ?? []).map((f) => [f.id, f.nombre] as [string, string]));
}

async function nombresUsuarios(ids: string[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return new Map();
  const { data, error } = await clienteServicio().from('usuarios').select('id, nombre').in('id', unicos);
  if (error) {
    console.error('nombres de usuarios:', error.message);
    return new Map();
  }
  return new Map((data ?? []).map((f) => [f.id, f.nombre] as [string, string]));
}

async function unidadesPorOrden(ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const db = await clienteSesion();
  const { data, error } = await db.from('lineas_orden').select('orden_id, cantidad').in('orden_id', ids);
  if (error) throw new Error(`No pudimos leer los productos: ${error.message}`);
  const total = new Map<string, number>();
  for (const linea of data ?? []) {
    total.set(linea.orden_id, (total.get(linea.orden_id) ?? 0) + linea.cantidad);
  }
  return total;
}

async function disputasPorOrden(ids: string[]): Promise<Map<string, FilaDisputa>> {
  if (ids.length === 0) return new Map();
  const db = await clienteSesion();
  const { data, error } = await db
    .from('disputas')
    .select('orden_id, estado, resultado, motivo, evidencia, nota_resolucion, creada_en, resuelta_en, reembolso_marcado_en, reembolso_confirmado_en')
    .in('orden_id', ids);
  if (error) throw new Error(`No pudimos leer las disputas: ${error.message}`);
  return new Map((data ?? []).map((f) => [f.orden_id, f as FilaDisputa] as [string, FilaDisputa]));
}

// Lines and totals use the same rules as the buttons, so the lists and the detail never disagree.
function aOrdenParaAcciones(
  orden: FilaOrden,
  disputa: FilaDisputa | null,
  proveedor: ProveedorCobro | null,
): OrdenParaAcciones {
  return {
    tipo: orden.tipo,
    estado: orden.estado,
    pagada: orden.pagada_en !== null,
    entregadaEn: orden.entregada_en ? new Date(orden.entregada_en) : null,
    // Review does not change the actions the lists group by.
    tieneResena: false,
    disputa: disputa
      ? {
          estado: disputa.estado,
          resultado: disputa.resultado,
          reembolsoMarcado: disputa.reembolso_marcado_en !== null,
          reembolsoConfirmado: disputa.reembolso_confirmado_en !== null,
        }
      : null,
    proveedor: proveedor ?? 'manual',
  };
}

// Payment method per order: only a manual payment asks the seller to confirm by hand.
async function proveedoresPorOrden(ids: string[]): Promise<Map<string, ProveedorCobro>> {
  if (ids.length === 0) return new Map();
  const db = await clienteSesion();
  const { data, error } = await db.from('cobros').select('orden_id, proveedor').in('orden_id', ids);
  if (error) throw new Error(`No pudimos leer los pagos: ${error.message}`);
  return new Map((data ?? []).map((f) => [f.orden_id, f.proveedor as ProveedorCobro] as [string, ProveedorCobro]));
}

async function resumenes(filas: FilaOrden[], rol: RolOrden): Promise<ResumenOrden[]> {
  if (filas.length === 0) return [];
  const ids = filas.map((f) => f.id);
  const [unidades, disputas, proveedores, nombres] = await Promise.all([
    unidadesPorOrden(ids),
    disputasPorOrden(ids),
    proveedoresPorOrden(ids),
    rol === 'comprador'
      ? nombresNegocios(filas.map((f) => f.negocio_id))
      : nombresUsuarios(filas.map((f) => f.comprador_id)),
  ]);

  return filas.map((f) => {
    const disputa = disputas.get(f.id) ?? null;
    const otraParte =
      rol === 'comprador'
        ? (nombres.get(f.negocio_id) ?? 'Tienda')
        : (nombres.get(f.comprador_id) ?? NOMBRE_SIN_DATO);
    const necesitaAccion = accionesPosibles(
      aOrdenParaAcciones(f, disputa, proveedores.get(f.id) ?? null),
      rol,
    ).some((a) => PENDIENTES.has(a));
    return {
      id: f.id,
      numero: f.numero,
      tipo: f.tipo,
      estado: f.estado,
      otraParte,
      totalUsdCentavos: f.total_usd_centavos,
      totalSats: f.total_sats,
      creadaEn: f.creada_en,
      pagadaEn: f.pagada_en,
      hechaEn: f.hecha_en,
      canceladaEn: f.cancelada_en,
      motivoCancelacion: f.motivo_cancelacion,
      productos: unidades.get(f.id) ?? 0,
      necesitaAccion,
    };
  });
}

/** The orders the signed-in buyer placed, newest first. */
export async function misCompras(usuarioId: string): Promise<ResumenOrden[]> {
  if (!esUuid(usuarioId)) return [];
  await barrer();
  const db = await clienteSesion();
  const { data, error } = await db
    .from('ordenes')
    .select(COLUMNAS_ORDEN)
    .eq('comprador_id', usuarioId)
    .order('creada_en', { ascending: false })
    .limit(500); // 30 per page on screen; the lists are paged in memory after the attention split.
  if (error) throw new Error(`No pudimos leer tus órdenes: ${error.message}`);
  return resumenes((data ?? []) as unknown as FilaOrden[], 'comprador');
}

/** The orders placed with one shop, newest first. The session must own the shop (RLS). */
export async function ventasDe(negocioId: string): Promise<ResumenOrden[]> {
  if (!esUuid(negocioId)) return [];
  await barrer();
  const db = await clienteSesion();
  const { data, error } = await db
    .from('ordenes')
    .select(COLUMNAS_ORDEN)
    .eq('negocio_id', negocioId)
    .order('creada_en', { ascending: false })
    .limit(500);
  if (error) throw new Error(`No pudimos leer las ventas: ${error.message}`);
  return resumenes((data ?? []) as unknown as FilaOrden[], 'vendedor');
}

/** Midnight in El Salvador (UTC-6 all year) as an instant, for "today" queries. */
function inicioDeHoyEnSalvador(ahora: Date = new Date()): string {
  const dia = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'America/El_Salvador',
  }).format(ahora);
  return `${dia}T00:00:00-06:00`;
}

/** What the shop collected today: orders whose payment arrived today, in sats and USD. */
export async function cobradoHoy(
  negocioId: string,
): Promise<{ sats: number; usdCentavos: number; cantidad: number }> {
  const total = { sats: 0, usdCentavos: 0, cantidad: 0 };
  if (!esUuid(negocioId)) return total;
  const db = await clienteSesion();
  const { data, error } = await db
    .from('ordenes')
    .select('total_sats, total_usd_centavos')
    .eq('negocio_id', negocioId)
    .gte('pagada_en', inicioDeHoyEnSalvador());
  if (error) throw new Error(`No pudimos leer los cobros de hoy: ${error.message}`);
  for (const fila of data ?? []) {
    total.sats += fila.total_sats;
    total.usdCentavos += fila.total_usd_centavos;
    total.cantidad += 1;
  }
  return total;
}

function rolEn(orden: Pick<FilaOrden, 'comprador_id' | 'negocio_id'>, sesion: Sesion): RolOrden | null {
  if (orden.comprador_id === sesion.usuario.id) return 'comprador';
  if (sesion.negocio && sesion.negocio.id === orden.negocio_id) return 'vendedor';
  return null;
}

/**
 * The viewer's role in one order, or null when they are neither the buyer nor the shop owner.
 * Admins are not parties here: they use /admin.
 */
export async function accesoAOrden(ordenId: string, sesion: Sesion): Promise<RolOrden | null> {
  if (!esUuid(ordenId)) return null;
  const db = await clienteSesion();
  const { data, error } = await db
    .from('ordenes')
    .select('comprador_id, negocio_id')
    .eq('id', ordenId)
    .maybeSingle();
  if (error) throw new Error(`No pudimos leer la orden: ${error.message}`);
  if (!data) return null;
  return rolEn(data, sesion);
}

/**
 * Whether a shop is a demo profile (a real business from BTC Map shown as an example). Read with the
 * service role, the same way the shop's name is read, so the order can say so to either party.
 */
export async function esNegocioDemo(negocioId: string): Promise<boolean> {
  if (!esUuid(negocioId)) return false;
  const { data, error } = await clienteServicio()
    .from('negocios')
    .select('btcmap_id')
    .eq('id', negocioId)
    .maybeSingle();
  if (error) throw new Error(`No pudimos leer el negocio: ${error.message}`);
  return esDemo(data?.btcmap_id ?? null);
}

/** Whether an order was placed with a demo seller. Used by the checkout screen, which reads the order first. */
export async function esOrdenDemo(ordenId: string): Promise<boolean> {
  if (!esUuid(ordenId)) return false;
  const { data, error } = await clienteServicio().from('ordenes').select('negocio_id').eq('id', ordenId).maybeSingle();
  if (error) throw new Error(`No pudimos leer la orden: ${error.message}`);
  return data ? esNegocioDemo(data.negocio_id) : false;
}

/** One order for its parties. Null for anyone else, so the page can answer "not found". */
export async function detalleDeOrden(ordenId: string, sesion: Sesion): Promise<DetalleOrden | null> {
  if (!esUuid(ordenId)) return null;
  await barrer();
  const db = await clienteSesion();

  const { data: fila, error } = await db
    .from('ordenes')
    .select(COLUMNAS_ORDEN)
    .eq('id', ordenId)
    .maybeSingle();
  if (error) throw new Error(`No pudimos leer la orden: ${error.message}`);
  if (!fila) return null;

  const orden = fila as unknown as FilaOrden;
  const rol = rolEn(orden, sesion);
  if (!rol) return null;

  const [lineas, cobro, resena, disputa, nombres] = await Promise.all([
    db.from('lineas_orden').select('id, nombre, unidad, cantidad, precio_usd_centavos').eq('orden_id', ordenId).order('nombre'),
    db.from('cobros').select('proveedor, estado').eq('orden_id', ordenId).maybeSingle(),
    db.from('resenas').select('puntuacion, comentario, creada_en').eq('orden_id', ordenId).maybeSingle(),
    db
      .from('disputas')
      .select('orden_id, estado, resultado, motivo, evidencia, nota_resolucion, creada_en, resuelta_en, reembolso_marcado_en, reembolso_confirmado_en')
      .eq('orden_id', ordenId)
      .maybeSingle(),
    rol === 'comprador' ? nombresNegocios([orden.negocio_id]) : nombresUsuarios([orden.comprador_id]),
  ]);
  for (const r of [lineas, cobro, resena, disputa]) {
    if (r.error) throw new Error(`No pudimos leer la orden: ${r.error.message}`);
  }

  const lineasOrden: LineaOrden[] = (lineas.data ?? []).map((l) => ({
    id: l.id,
    nombre: l.nombre,
    unidad: l.unidad,
    cantidad: l.cantidad,
    precioUsdCentavos: l.precio_usd_centavos,
  }));

  const pago: PagoOrden | null = cobro.data
    ? { proveedor: cobro.data.proveedor, estado: cobro.data.estado }
    : null;

  const resenaOrden: ResenaOrden | null = resena.data
    ? {
        puntuacion: resena.data.puntuacion,
        comentario: resena.data.comentario,
        creadaEn: resena.data.creada_en,
      }
    : null;

  const disputaOrden: DisputaOrden | null = disputa.data
    ? {
        estado: disputa.data.estado,
        resultado: disputa.data.resultado,
        motivo: disputa.data.motivo,
        evidencia: disputa.data.evidencia,
        notaResolucion: disputa.data.nota_resolucion,
        creadaEn: disputa.data.creada_en,
        resueltaEn: disputa.data.resuelta_en,
        reembolsoMarcadoEn: disputa.data.reembolso_marcado_en,
        reembolsoConfirmadoEn: disputa.data.reembolso_confirmado_en,
      }
    : null;

  const otraParte =
    rol === 'comprador'
      ? (nombres.get(orden.negocio_id) ?? 'Tienda')
      : (nombres.get(orden.comprador_id) ?? NOMBRE_SIN_DATO);

  const detalle: DetalleOrden = {
    id: orden.id,
    numero: orden.numero,
    tipo: orden.tipo,
    estado: orden.estado,
    rol,
    otraParte,
    demo: await esNegocioDemo(orden.negocio_id),
    totalUsdCentavos: orden.total_usd_centavos,
    totalSats: orden.total_sats,
    cotizacionUsdBtc: orden.cotizacion_usd_btc,
    modoEntrega: orden.modo_entrega,
    creadaEn: orden.creada_en,
    pagadaEn: orden.pagada_en,
    listaEn: orden.lista_en,
    entregadaEn: orden.entregada_en,
    cerradaEn: orden.cerrada_en,
    expiradaEn: orden.expirada_en,
    disputadaEn: orden.disputada_en,
    resueltaEn: orden.resuelta_en,
    hechaEn: orden.hecha_en,
    canceladaEn: orden.cancelada_en,
    motivoCancelacion: orden.motivo_cancelacion,
    lineas: lineasOrden,
    pago,
    resena: resenaOrden,
    disputa: disputaOrden,
  };

  // The delivery code proves the buyer has the goods, so only the buyer gets it, and only
  // while the order can still be delivered. A job has no code: the payment is the confirmation.
  // Read with the service role after the role check.
  if (
    rol === 'comprador' &&
    orden.tipo === 'productos' &&
    (orden.estado === 'pagada' || orden.estado === 'lista')
  ) {
    const { data, error: errorCodigo } = await clienteServicio()
      .from('ordenes')
      .select('codigo_entrega')
      .eq('id', ordenId)
      .maybeSingle();
    if (errorCodigo) throw new Error(`No pudimos leer el código: ${errorCodigo.message}`);
    if (data?.codigo_entrega) detalle.codigoEntrega = data.codigo_entrega;
  }

  return detalle;
}

/** The inputs the buttons are decided from, built from what the page shows. */
export function paraAcciones(detalle: DetalleOrden): OrdenParaAcciones {
  return {
    tipo: detalle.tipo,
    estado: detalle.estado,
    pagada: detalle.pagadaEn !== null,
    demo: detalle.demo,
    entregadaEn: detalle.entregadaEn ? new Date(detalle.entregadaEn) : null,
    tieneResena: detalle.resena !== null,
    disputa: detalle.disputa
      ? {
          estado: detalle.disputa.estado,
          resultado: detalle.disputa.resultado,
          reembolsoMarcado: detalle.disputa.reembolsoMarcadoEn !== null,
          reembolsoConfirmado: detalle.disputa.reembolsoConfirmadoEn !== null,
        }
      : null,
    proveedor: detalle.pago?.proveedor ?? 'manual',
  };
}

/** Runs a database function and turns its error into a Resultado. */
export async function ejecutarRpc(llamada: PromiseLike<{ error: unknown }>): Promise<Resultado<null>> {
  const { error } = await llamada;
  if (error) return desdeError(error);
  return exito(null);
}

// Transitions. Each one passes the signed-in user as p_actor; the database checks the role and state.

/** The seller confirms a payment received by hand (a manual Lightning Address). */
export async function confirmarPagoManual(ordenId: string, usuarioId: string): Promise<Resultado<null>> {
  if (!esUuid(ordenId) || !esUuid(usuarioId)) return NO_ENCONTRADA();
  const error = await confirmarPagoEnBD(ordenId, usuarioId, null);
  return error ? desdeError(error) : exito(null);
}

/** Demo sellers only: the buyer settles a pickup order as delivered. The database refuses any other order. */
export async function simularEntregaDemo(ordenId: string, usuarioId: string): Promise<Resultado<null>> {
  if (!esUuid(ordenId) || !esUuid(usuarioId)) return NO_ENCONTRADA();
  return ejecutarRpc(clienteServicio().rpc('simular_entrega_demo', { p_orden: ordenId, p_actor: usuarioId }));
}

export async function marcarLista(ordenId: string, usuarioId: string): Promise<Resultado<null>> {
  if (!esUuid(ordenId) || !esUuid(usuarioId)) return NO_ENCONTRADA();
  return ejecutarRpc(clienteServicio().rpc('marcar_lista', { p_orden: ordenId, p_actor: usuarioId }));
}

/** The shop says an agreed job is done. From then on the client can pay it. */
export async function marcarHecha(ordenId: string, usuarioId: string): Promise<Resultado<null>> {
  if (!esUuid(ordenId) || !esUuid(usuarioId)) return NO_ENCONTRADA();
  const { error } = await clienteServicio().rpc('marcar_hecha', { p_orden: ordenId, p_actor: usuarioId });
  if (error) return desdeError(error);
  await registrarEvento({
    nombre: 'trabajo_hecho',
    sesion: await sesionDeVisitaCreando(),
    usuarioId,
    ruta: `/ordenes/${ordenId}`,
    objeto: ordenId,
    valorUsdCentavos: null,
  });
  return exito(null);
}

/**
 * Cancels with a short reason. Either party cancels an agreed job; the buyer cancels a product order
 * before it is paid. The database checks the role, the state and the same limits.
 */
export async function cancelarOrden(
  ordenId: string,
  usuarioId: string,
  motivo: string,
): Promise<Resultado<null>> {
  if (!esUuid(ordenId) || !esUuid(usuarioId)) return NO_ENCONTRADA();
  const texto = motivo.trim();
  if (largo(texto) < 4 || largo(texto) > 300) {
    return fallo('DATOS_INVALIDOS', 'El motivo tiene que tener entre 4 y 300 caracteres.');
  }
  // A product order's CacaoPay charge is cancelled first: a charge already paid stops the cancel.
  const cobroPay = await cancelarCobroEnPay(ordenId);
  if (!cobroPay.ok) return cobroPay;
  return ejecutarRpc(
    clienteServicio().rpc('cancelar_orden', { p_orden: ordenId, p_actor: usuarioId, p_motivo: texto }),
  );
}

/**
 * The reference of a payment request, for the receipt. Service role: the browser never reads the
 * payment columns. Call only after the role check of detalleDeOrden.
 */
export async function referenciaDeCobro(ordenId: string): Promise<string | null> {
  if (!esUuid(ordenId)) return null;
  const { data, error } = await clienteServicio()
    .from('cobros')
    .select('referencia_externa')
    .eq('orden_id', ordenId)
    .maybeSingle();
  if (error) throw new Error(`No pudimos leer el pago: ${error.message}`);
  return data?.referencia_externa ?? null;
}

/** The buyer confirms delivery. No code is needed on this side. */
export async function marcarEntregada(ordenId: string, usuarioId: string): Promise<Resultado<null>> {
  if (!esUuid(ordenId) || !esUuid(usuarioId)) return NO_ENCONTRADA();
  return ejecutarRpc(
    clienteServicio().rpc('marcar_entregada', { p_orden: ordenId, p_actor: usuarioId, p_codigo: '' }),
  );
}

/** The seller confirms delivery with the six digits the buyer shows. Spaces are ignored. */
export async function entregarConCodigo(
  ordenId: string,
  usuarioId: string,
  codigo: string,
): Promise<Resultado<null>> {
  if (!esUuid(ordenId) || !esUuid(usuarioId)) return NO_ENCONTRADA();
  const limpio = codigo.replace(/\s/g, '');
  if (!/^\d{6}$/.test(limpio)) {
    return fallo('CODIGO_INCORRECTO', 'El código de entrega tiene seis números.');
  }
  return ejecutarRpc(
    clienteServicio().rpc('marcar_entregada', { p_orden: ordenId, p_actor: usuarioId, p_codigo: limpio }),
  );
}

export async function crearResena(
  ordenId: string,
  usuarioId: string,
  puntuacion: number,
  comentario: string,
): Promise<Resultado<null>> {
  if (!esUuid(ordenId) || !esUuid(usuarioId)) return NO_ENCONTRADA();
  // A demo order (or one whose delivery was simulated) is not a real sale, so it takes no review.
  if (await esOrdenDemo(ordenId)) {
    return fallo('NO_PERMITIDO', 'Los pedidos de demostración no admiten reseñas.');
  }
  if (!Number.isInteger(puntuacion) || puntuacion < 1 || puntuacion > 5) {
    return fallo('DATOS_INVALIDOS', 'Elegí una puntuación de 1 a 5.');
  }
  const texto = comentario.trim();
  // Stricter than the database (600), to match the limit shown on this form.
  if (largo(texto) > 500) {
    return fallo('DATOS_INVALIDOS', 'El comentario no puede pasar de 500 caracteres.');
  }
  return ejecutarRpc(
    clienteServicio().rpc('crear_resena', {
      p_orden: ordenId,
      p_actor: usuarioId,
      p_puntuacion: puntuacion,
      p_comentario: texto,
    }),
  );
}
