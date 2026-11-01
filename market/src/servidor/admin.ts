import 'server-only';

import { notFound } from 'next/navigation';

import {
  type EstadoNegocio,
  ESTADOS_ORDEN,
  detalleLegible,
  etiquetaAccion,
} from '@/app/admin/etiquetas';
import {
  type EstadoOrden,
  type ResultadoDisputa,
  resultadosPosibles,
  type TipoOrden,
  TODOS_LOS_RESULTADOS,
} from '@/lib/estados';

import { cotizacionSegura } from './catalogo';
import { barrer } from './mantenimiento';
import { desdeError, exito, fallo, type Resultado } from './resultado';
import { clienteServicio } from './supabase';

// Administration reads everything with the service role, so every function here takes the
// admin's user id and checks the role in the database first. A bug in a page cannot expose data.

export const POR_PAGINA = 50;
const AUDITORIA_LIMITE = 100;
const LOTE = 1000;

// "Paid" in the circularity metric and in the commission total.
const ESTADOS_PAGADOS: EstadoOrden[] = ['pagada', 'lista', 'entregada', 'cerrada', 'resuelta'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esUuid = (valor: string) => UUID.test(valor);

type Db = ReturnType<typeof clienteServicio>;

// ---------------------------------------------------------------------------------------------
// Role checks and small helpers

async function esAdminEnBaseDatos(actorId: string): Promise<boolean> {
  if (!esUuid(actorId)) return false;
  const { data, error } = await clienteServicio()
    .from('usuarios')
    .select('es_admin')
    .eq('id', actorId)
    .maybeSingle();
  if (error) throw new Error(`No pudimos verificar el rol: ${error.message}`);
  return data?.es_admin === true;
}

// Loaders answer "not found" to anyone who is not an admin, as the session check does.
async function exigirAdminBD(actorId: string): Promise<void> {
  if (!(await esAdminEnBaseDatos(actorId))) notFound();
}

const NO_ADMIN = () => fallo('NO_PERMITIDO', 'Solo un administrador puede hacer esto.');

function numeroONull(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function numero(valor: unknown): number {
  return numeroONull(valor) ?? 0;
}

type ConteoBD = PromiseLike<{ count: number | null; error: { message: string } | null }>;

async function contar(consulta: ConteoBD): Promise<number> {
  const { count, error } = await consulta;
  if (error) throw new Error(`No pudimos contar: ${error.message}`);
  return count ?? 0;
}

// Midnight in El Salvador, as an instant. The date comes from the zone, not from the server clock.
export function inicioDeHoy(ahora: Date = new Date()): string {
  const fecha = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/El_Salvador',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ahora);
  return `${fecha}T00:00:00-06:00`;
}

// Query-string values come from the URL: never trust them.
export function paginaDesde(valor: string | undefined): number {
  if (!valor || !/^\d{1,6}$/.test(valor)) return 1;
  const n = Number(valor);
  return n >= 1 ? n : 1;
}

export function estadoDesde(valor: string | undefined): EstadoOrden | null {
  return ESTADOS_ORDEN.includes(valor as EstadoOrden) ? (valor as EstadoOrden) : null;
}

// ---------------------------------------------------------------------------------------------
// Resumen

export type FilaCircularidad = {
  negocioId: string;
  nombre: string;
  satsCobrados: number;
  satsRegastados: number;
  indice: number | null;
};

export type ResumenAdmin = {
  negociosPorAprobar: number;
  disputasAbiertas: number;
  pedidosHoy: number;
  esperandoPago: number;
  circularidad: {
    satsCobrados: number;
    satsRegastados: number;
    indice: number | null;
    negocios: number;
    negociosQueCompran: number;
    porcentajeCompran: number | null;
    porNegocio: FilaCircularidad[];
  };
  comisionTeoricaSats: number;
  cotizacionUsdBtc: number | null;
};

async function circularidadRed(db: Db) {
  const { data, error } = await db.rpc('circularidad_red');
  if (error) throw new Error(`No pudimos leer la circularidad: ${error.message}`);
  return data?.[0] ?? null;
}

async function circularidadPorNegocio(db: Db): Promise<FilaCircularidad[]> {
  const { data, error } = await db
    .from('circularidad_negocios')
    .select('negocio_id, nombre, sats_cobrados, sats_regastados, indice');
  if (error) throw new Error(`No pudimos leer la circularidad por negocio: ${error.message}`);

  const filas: FilaCircularidad[] = (data ?? []).map((f) => ({
    negocioId: f.negocio_id ?? '',
    nombre: f.nombre ?? '',
    satsCobrados: numero(f.sats_cobrados),
    satsRegastados: numero(f.sats_regastados),
    indice: numeroONull(f.indice),
  }));

  // Highest index first, shops with no sales last.
  return filas.sort((a, b) => {
    if (a.indice === null && b.indice === null) {
      return b.satsCobrados - a.satsCobrados || a.nombre.localeCompare(b.nombre, 'es');
    }
    if (a.indice === null) return 1;
    if (b.indice === null) return -1;
    return b.indice - a.indice || a.nombre.localeCompare(b.nombre, 'es');
  });
}

// Sums the commission over every paid order. Pages through the rows because one request
// returns at most 1000.
async function sumarComision(db: Db): Promise<number> {
  let total = 0;
  for (let desde = 0; ; desde += LOTE) {
    const { data, error } = await db
      .from('ordenes')
      .select('comision_teorica_sats')
      .in('estado', ESTADOS_PAGADOS)
      .order('numero', { ascending: true })
      .range(desde, desde + LOTE - 1);
    if (error) throw new Error(`No pudimos sumar la comisión: ${error.message}`);
    const filas = data ?? [];
    for (const fila of filas) total += numero(fila.comision_teorica_sats);
    if (filas.length < LOTE) return total;
  }
}

export async function resumenAdmin(actorId: string): Promise<ResumenAdmin> {
  await exigirAdminBD(actorId);
  await barrer();
  const db = clienteServicio();

  const [negociosPorAprobar, disputasAbiertas, pedidosHoy, esperandoPago, red, porNegocio, comision, cotizacion] =
    await Promise.all([
      contar(db.from('negocios').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente')),
      contar(db.from('disputas').select('id', { count: 'exact', head: true }).eq('estado', 'abierta')),
      contar(db.from('ordenes').select('id', { count: 'exact', head: true }).gte('creada_en', inicioDeHoy())),
      contar(db.from('ordenes').select('id', { count: 'exact', head: true }).eq('estado', 'esperando_pago')),
      circularidadRed(db),
      circularidadPorNegocio(db),
      sumarComision(db),
      cotizacionSegura(),
    ]);

  return {
    negociosPorAprobar,
    disputasAbiertas,
    pedidosHoy,
    esperandoPago,
    circularidad: {
      satsCobrados: numero(red?.sats_cobrados),
      satsRegastados: numero(red?.sats_regastados),
      indice: numeroONull(red?.indice),
      negocios: numero(red?.negocios),
      negociosQueCompran: numero(red?.negocios_que_compran),
      porcentajeCompran: numeroONull(red?.porcentaje),
      porNegocio,
    },
    comisionTeoricaSats: comision,
    cotizacionUsdBtc: cotizacion,
  };
}

// ---------------------------------------------------------------------------------------------
// Negocios

export type NegocioAdmin = {
  id: string;
  nombre: string;
  descripcion: string;
  ubicacion: string;
  estado: EstadoNegocio;
  lightningAddress: string | null;
  tipoProveedorPago: string;
  creadoEn: string;
  dueno: string;
  // The owner's phone or email, as stored, for the admin screen. Sessions never see it.
  contacto: string;
};

type FilaNegocioBD = {
  id: string;
  nombre: string;
  descripcion: string;
  ubicacion: string;
  estado: EstadoNegocio;
  lightning_address: string | null;
  tipo_proveedor_pago: string;
  creado_en: string;
  dueno: { nombre: string; telefono: string } | null;
};

// With demo access on, anyone can sign in as the sample admin, so real people's contacts are
// never shown whole: only enough to recognise them.
function contactoVisible(contacto: string): string {
  if (process.env.NEXT_PUBLIC_DEMO !== '1' || contacto === '') return contacto;
  const arroba = contacto.indexOf('@');
  if (arroba > 0) return `${contacto.slice(0, 2)}•••${contacto.slice(arroba)}`;
  return `•••• ••${contacto.slice(-2)}`;
}

export async function negociosAdmin(actorId: string): Promise<NegocioAdmin[]> {
  await exigirAdminBD(actorId);
  const { data, error } = await clienteServicio()
    .from('negocios')
    .select(
      'id, nombre, descripcion, ubicacion, estado, lightning_address, tipo_proveedor_pago, creado_en, dueno:usuarios!negocios_usuario_id_fkey(nombre, telefono)',
    )
    .order('creado_en', { ascending: false });
  if (error) throw new Error(`No pudimos leer los negocios: ${error.message}`);

  return ((data ?? []) as unknown as FilaNegocioBD[]).map((f) => ({
    id: f.id,
    nombre: f.nombre,
    descripcion: f.descripcion,
    ubicacion: f.ubicacion,
    estado: f.estado,
    lightningAddress: f.lightning_address,
    tipoProveedorPago: f.tipo_proveedor_pago,
    creadoEn: f.creado_en,
    dueno: f.dueno?.nombre ?? '',
    contacto: contactoVisible(f.dueno?.telefono ?? ''),
  }));
}

export async function cambiarEstadoNegocio(
  actorId: string,
  negocioId: string,
  estado: 'aprobado' | 'suspendido',
): Promise<Resultado<null>> {
  if (!esUuid(negocioId)) return fallo('NO_ENCONTRADA', 'No encontramos ese negocio.');
  try {
    if (!(await esAdminEnBaseDatos(actorId))) return NO_ADMIN();
    const { error } = await clienteServicio().rpc('cambiar_estado_negocio', {
      p_negocio: negocioId,
      p_actor: actorId,
      p_estado: estado,
    });
    if (error) return desdeError(error);
    return exito(null);
  } catch (error) {
    return desdeError(error);
  }
}

// ---------------------------------------------------------------------------------------------
// Órdenes

export type FilaOrdenAdmin = {
  id: string;
  numero: number;
  tipo: TipoOrden;
  estado: EstadoOrden;
  creadaEn: string;
  negocio: string;
  comprador: string;
  totalSats: number;
  totalUsdCentavos: number;
};

export type PaginaOrdenes = {
  filas: FilaOrdenAdmin[];
  total: number;
  pagina: number;
  porPagina: number;
};

type FilaOrdenListaBD = {
  id: string;
  numero: number;
  tipo: TipoOrden;
  estado: EstadoOrden;
  creada_en: string;
  total_usd_centavos: number;
  total_sats: number;
  negocios: { nombre: string } | null;
  comprador: { nombre: string } | null;
};

export async function ordenesAdmin(
  actorId: string,
  filtro: { pagina: number; estado: EstadoOrden | null; tipo?: TipoOrden | null },
): Promise<PaginaOrdenes> {
  await exigirAdminBD(actorId);
  await barrer();

  // Count first: the database answers an out-of-range page with an error, not an empty list.
  let conteo = clienteServicio().from('ordenes').select('id', { count: 'exact', head: true });
  if (filtro.estado) conteo = conteo.eq('estado', filtro.estado);
  if (filtro.tipo) conteo = conteo.eq('tipo', filtro.tipo);
  const { count: total, error: errorConteo } = await conteo;
  if (errorConteo) throw new Error(`No pudimos contar las órdenes: ${errorConteo.message}`);

  // A page past the last one shows the last page.
  const ultima = Math.max(1, Math.ceil((total ?? 0) / POR_PAGINA));
  const pagina = Math.min(filtro.pagina, ultima);
  const desde = (pagina - 1) * POR_PAGINA;

  let lista = clienteServicio()
    .from('ordenes')
    .select(
      'id, numero, tipo, estado, creada_en, total_usd_centavos, total_sats, negocios(nombre), comprador:usuarios!ordenes_comprador_id_fkey(nombre)',
    );
  if (filtro.estado) lista = lista.eq('estado', filtro.estado);
  if (filtro.tipo) lista = lista.eq('tipo', filtro.tipo);
  const { data, error } = await lista.order('numero', { ascending: false }).range(desde, desde + POR_PAGINA - 1);
  if (error) throw new Error(`No pudimos leer las órdenes: ${error.message}`);

  return {
    filas: ((data ?? []) as unknown as FilaOrdenListaBD[]).map((f) => ({
      id: f.id,
      numero: f.numero,
      tipo: f.tipo,
      estado: f.estado,
      creadaEn: f.creada_en,
      negocio: f.negocios?.nombre ?? '',
      comprador: f.comprador?.nombre ?? '',
      totalSats: f.total_sats,
      totalUsdCentavos: f.total_usd_centavos,
    })),
    total: total ?? 0,
    pagina,
    porPagina: POR_PAGINA,
  };
}

// A job marked done and still unpaid after this many hours is listed for the admin.
const HORAS_SIN_PAGAR = 48;
const MS_HORA = 60 * 60 * 1000;

export type TrabajoSinPagar = {
  id: string;
  numero: number;
  comprador: string;
  negocio: string;
  totalUsdCentavos: number;
  totalSats: number;
  hechaEn: string;
  horasEsperando: number;
};

type FilaTrabajoSinPagarBD = {
  id: string;
  numero: number;
  hecha_en: string;
  total_usd_centavos: number;
  total_sats: number;
  negocios: { nombre: string } | null;
  comprador: { nombre: string } | null;
};

/** Jobs marked done more than 48 hours ago that nobody has paid. The oldest comes first. */
export async function trabajosSinPagar(actorId: string): Promise<TrabajoSinPagar[]> {
  await exigirAdminBD(actorId);
  await barrer();

  const ahora = Date.now();
  const corte = new Date(ahora - HORAS_SIN_PAGAR * MS_HORA).toISOString();
  const { data, error } = await clienteServicio()
    .from('ordenes')
    .select(
      'id, numero, hecha_en, total_usd_centavos, total_sats, negocios(nombre), comprador:usuarios!ordenes_comprador_id_fkey(nombre)',
    )
    .eq('tipo', 'servicio')
    .eq('estado', 'hecha')
    .lt('hecha_en', corte)
    .order('hecha_en', { ascending: true })
    .limit(500);
  if (error) throw new Error(`No pudimos leer los trabajos sin pagar: ${error.message}`);

  return ((data ?? []) as unknown as FilaTrabajoSinPagarBD[]).map((f) => ({
    id: f.id,
    numero: f.numero,
    comprador: f.comprador?.nombre ?? '',
    negocio: f.negocios?.nombre ?? '',
    totalUsdCentavos: f.total_usd_centavos,
    totalSats: f.total_sats,
    hechaEn: f.hecha_en,
    horasEsperando: Math.floor((ahora - Date.parse(f.hecha_en)) / MS_HORA),
  }));
}

export type FilaAuditoria = {
  id: number;
  accion: string;
  etiqueta: string;
  // Null when the database wrote the row without an actor.
  quien: string | null;
  creadoEn: string;
  referencia: string | null;
  detalle: { clave: string; valor: string }[];
};

export type DetalleOrdenAdmin = {
  id: string;
  numero: number;
  tipo: TipoOrden;
  estado: EstadoOrden;
  // Null for a job: it has no delivery mode.
  modoEntrega: string | null;
  totalUsdCentavos: number;
  totalSats: number;
  cotizacionUsdBtc: number;
  comisionTeoricaSats: number;
  creadaEn: string;
  pagadaEn: string | null;
  listaEn: string | null;
  entregadaEn: string | null;
  cerradaEn: string | null;
  expiradaEn: string | null;
  disputadaEn: string | null;
  resueltaEn: string | null;
  hechaEn: string | null;
  canceladaEn: string | null;
  motivoCancelacion: string | null;
  negocio: string;
  vendedor: string;
  comprador: string;
  lineas: { nombre: string; unidad: string; cantidad: number; precioUsdCentavos: number }[];
  // The payment request, without the verify URL and without the invoice.
  cobro: { proveedor: string; estado: string; expiraEn: string; pagadoEn: string | null } | null;
  mensajes: { id: string; autor: string; rol: 'Comprador' | 'Vendedor'; texto: string; creadoEn: string }[];
  disputa: {
    motivo: string;
    evidencia: string;
    estado: 'abierta' | 'resuelta';
    resultado: ResultadoDisputa | null;
    notaResolucion: string;
    creadaEn: string;
    resueltaEn: string | null;
    resueltaPor: string | null;
    reembolsoMarcadoEn: string | null;
    reembolsoConfirmadoEn: string | null;
  } | null;
  auditoria: FilaAuditoria[];
};

type FilaOrdenDetalleBD = {
  id: string;
  numero: number;
  tipo: TipoOrden;
  estado: EstadoOrden;
  modo_entrega: string | null;
  total_usd_centavos: number;
  total_sats: number;
  cotizacion_usd_btc: number;
  comision_teorica_sats: number;
  comprador_id: string;
  creada_en: string;
  pagada_en: string | null;
  lista_en: string | null;
  entregada_en: string | null;
  cerrada_en: string | null;
  expirada_en: string | null;
  disputada_en: string | null;
  resuelta_en: string | null;
  hecha_en: string | null;
  cancelada_en: string | null;
  motivo_cancelacion: string | null;
  comprador: { nombre: string } | null;
  negocios: { nombre: string; usuario_id: string; dueno: { nombre: string } | null } | null;
};

// The order number, the shop or the order named in an audit row, looked up in one query each.
async function referenciasAuditoria(
  db: Db,
  filas: { entidad: string; entidad_id: string }[],
): Promise<Map<string, string>> {
  const nombres = new Map<string, string>();
  const ordenes = [...new Set(filas.filter((f) => f.entidad === 'orden' && esUuid(f.entidad_id)).map((f) => f.entidad_id))];
  const negocios = [...new Set(filas.filter((f) => f.entidad === 'negocio' && esUuid(f.entidad_id)).map((f) => f.entidad_id))];

  if (ordenes.length > 0) {
    const { data, error } = await db.from('ordenes').select('id, numero').in('id', ordenes);
    if (error) throw new Error(`No pudimos leer las órdenes de la auditoría: ${error.message}`);
    for (const o of data ?? []) nombres.set(o.id, `Orden ${o.numero}`);
  }
  if (negocios.length > 0) {
    const { data, error } = await db.from('negocios').select('id, nombre').in('id', negocios);
    if (error) throw new Error(`No pudimos leer los negocios de la auditoría: ${error.message}`);
    for (const n of data ?? []) nombres.set(n.id, `Negocio ${n.nombre}`);
  }
  return nombres;
}

type FilaAuditoriaBD = {
  id: number;
  accion: string;
  entidad: string;
  entidad_id: string;
  detalle: unknown;
  creado_en: string;
  actor: { nombre: string } | null;
  actor_id: string | null;
};

function filaAuditoria(f: FilaAuditoriaBD, referencia: string | null): FilaAuditoria {
  return {
    id: f.id,
    accion: f.accion,
    etiqueta: etiquetaAccion(f.accion),
    quien: f.actor_id === null ? null : (f.actor?.nombre ?? ''),
    creadoEn: f.creado_en,
    referencia,
    detalle: detalleLegible(f.detalle),
  };
}

export async function ordenDetalleAdmin(actorId: string, ordenId: string): Promise<DetalleOrdenAdmin | null> {
  await exigirAdminBD(actorId);
  if (!esUuid(ordenId)) return null;
  await barrer();

  const db = clienteServicio();
  // codigo_entrega is left out on purpose: only the buyer sees it.
  const { data: fila, error } = await db
    .from('ordenes')
    .select(
      'id, numero, tipo, estado, modo_entrega, total_usd_centavos, total_sats, cotizacion_usd_btc, comision_teorica_sats, comprador_id, creada_en, pagada_en, lista_en, entregada_en, cerrada_en, expirada_en, disputada_en, resuelta_en, hecha_en, cancelada_en, motivo_cancelacion, comprador:usuarios!ordenes_comprador_id_fkey(nombre), negocios(nombre, usuario_id, dueno:usuarios!negocios_usuario_id_fkey(nombre))',
    )
    .eq('id', ordenId)
    .maybeSingle();
  if (error) throw new Error(`No pudimos leer la orden: ${error.message}`);
  if (!fila) return null;
  const orden = fila as unknown as FilaOrdenDetalleBD;

  const [lineas, cobro, mensajes, disputa, auditoria] = await Promise.all([
    db.from('lineas_orden').select('nombre, unidad, cantidad, precio_usd_centavos').eq('orden_id', ordenId),
    db.from('cobros').select('proveedor, estado, expira_en, pagado_en').eq('orden_id', ordenId).maybeSingle(),
    db
      .from('mensajes')
      .select('id, autor_id, texto, creado_en, autor:usuarios!mensajes_autor_id_fkey(nombre)')
      .eq('orden_id', ordenId)
      .order('creado_en', { ascending: true })
      .limit(500),
    db
      .from('disputas')
      .select(
        'motivo, evidencia, estado, resultado, nota_resolucion, creada_en, resuelta_en, reembolso_marcado_en, reembolso_confirmado_en, resolutor:usuarios!disputas_resuelta_por_fkey(nombre)',
      )
      .eq('orden_id', ordenId)
      .maybeSingle(),
    db
      .from('auditoria')
      .select('id, accion, entidad, entidad_id, detalle, creado_en, actor_id, actor:usuarios!auditoria_actor_id_fkey(nombre)')
      .eq('entidad', 'orden')
      .eq('entidad_id', ordenId)
      .order('creado_en', { ascending: true })
      .order('id', { ascending: true }),
  ]);

  for (const r of [lineas, cobro, mensajes, disputa, auditoria]) {
    if (r.error) throw new Error(`No pudimos leer el detalle de la orden: ${r.error.message}`);
  }

  const d = disputa.data as unknown as
    | {
        motivo: string;
        evidencia: string;
        estado: 'abierta' | 'resuelta';
        resultado: ResultadoDisputa | null;
        nota_resolucion: string;
        creada_en: string;
        resuelta_en: string | null;
        reembolso_marcado_en: string | null;
        reembolso_confirmado_en: string | null;
        resolutor: { nombre: string } | null;
      }
    | null;

  const referencias = await referenciasAuditoria(db, (auditoria.data ?? []).map((a) => ({ entidad: a.entidad, entidad_id: a.entidad_id })));

  return {
    id: orden.id,
    numero: orden.numero,
    tipo: orden.tipo,
    estado: orden.estado,
    modoEntrega: orden.modo_entrega,
    totalUsdCentavos: orden.total_usd_centavos,
    totalSats: orden.total_sats,
    cotizacionUsdBtc: orden.cotizacion_usd_btc,
    comisionTeoricaSats: orden.comision_teorica_sats,
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
    negocio: orden.negocios?.nombre ?? '',
    vendedor: orden.negocios?.dueno?.nombre ?? '',
    comprador: orden.comprador?.nombre ?? '',
    lineas: (lineas.data ?? []).map((l) => ({
      nombre: l.nombre,
      unidad: l.unidad,
      cantidad: l.cantidad,
      precioUsdCentavos: l.precio_usd_centavos,
    })),
    cobro: cobro.data
      ? {
          proveedor: cobro.data.proveedor,
          estado: cobro.data.estado,
          expiraEn: cobro.data.expira_en,
          pagadoEn: cobro.data.pagado_en,
        }
      : null,
    mensajes: ((mensajes.data ?? []) as unknown as {
      id: string;
      autor_id: string;
      texto: string;
      creado_en: string;
      autor: { nombre: string } | null;
    }[]).map((m) => ({
      id: m.id,
      autor: m.autor?.nombre ?? '',
      rol: m.autor_id === orden.comprador_id ? 'Comprador' : 'Vendedor',
      texto: m.texto,
      creadoEn: m.creado_en,
    })),
    disputa: d
      ? {
          motivo: d.motivo,
          evidencia: d.evidencia,
          estado: d.estado,
          resultado: d.resultado,
          notaResolucion: d.nota_resolucion,
          creadaEn: d.creada_en,
          resueltaEn: d.resuelta_en,
          resueltaPor: d.resolutor?.nombre ?? null,
          reembolsoMarcadoEn: d.reembolso_marcado_en,
          reembolsoConfirmadoEn: d.reembolso_confirmado_en,
        }
      : null,
    auditoria: ((auditoria.data ?? []) as unknown as (FilaAuditoriaBD & { entidad_id: string })[]).map((a) =>
      filaAuditoria(a, referencias.get(a.entidad_id) ?? null),
    ),
  };
}

export async function resolverDisputa(
  actorId: string,
  ordenId: string,
  resultado: ResultadoDisputa,
  nota: string,
): Promise<Resultado<null>> {
  if (!esUuid(ordenId)) return fallo('NO_ENCONTRADA', 'No encontramos esa orden.');
  if (!TODOS_LOS_RESULTADOS.includes(resultado)) {
    return fallo('DATOS_INVALIDOS', 'Elegí un resultado para la disputa.');
  }
  try {
    if (!(await esAdminEnBaseDatos(actorId))) return NO_ADMIN();

    // Each result is checked against the order it is for: a job never paid takes the two
    // "owed" results, every other order takes the money results.
    const { data: orden, error: errorOrden } = await clienteServicio()
      .from('ordenes')
      .select('tipo, pagada_en')
      .eq('id', ordenId)
      .maybeSingle();
    if (errorOrden) throw new Error(`No pudimos leer la orden: ${errorOrden.message}`);
    if (!orden) return fallo('NO_ENCONTRADA', 'No encontramos esa orden.');
    const pagada = orden.pagada_en !== null;
    if (!resultadosPosibles({ tipo: orden.tipo, pagada }).includes(resultado)) {
      return fallo(
        'DATOS_INVALIDOS',
        orden.tipo === 'servicio' && !pagada
          ? 'Un trabajo sin pagar solo puede resolverse como corresponde pagar o no corresponde pagar.'
          : 'Ese resultado solo sirve para un trabajo sin pagar.',
      );
    }

    const { error } = await clienteServicio().rpc('resolver_disputa', {
      p_orden: ordenId,
      p_actor: actorId,
      p_resultado: resultado,
      p_nota: nota,
    });
    if (error) return desdeError(error);
    return exito(null);
  } catch (error) {
    return desdeError(error);
  }
}

// ---------------------------------------------------------------------------------------------
// Disputas

export type DisputaAdmin = {
  id: string;
  ordenId: string;
  numero: number;
  totalSats: number;
  totalUsdCentavos: number;
  comprador: string;
  negocio: string;
  motivo: string;
  evidencia: string;
  estado: 'abierta' | 'resuelta';
  resultado: ResultadoDisputa | null;
  notaResolucion: string;
  creadaEn: string;
  resueltaEn: string | null;
  reembolsoMarcadoEn: string | null;
  reembolsoConfirmadoEn: string | null;
};

type FilaDisputaBD = {
  id: string;
  orden_id: string;
  motivo: string;
  evidencia: string;
  estado: 'abierta' | 'resuelta';
  resultado: ResultadoDisputa | null;
  nota_resolucion: string;
  creada_en: string;
  resuelta_en: string | null;
  reembolso_marcado_en: string | null;
  reembolso_confirmado_en: string | null;
  orden: {
    numero: number;
    total_sats: number;
    total_usd_centavos: number;
    negocios: { nombre: string } | null;
    comprador: { nombre: string } | null;
  } | null;
};

export async function disputasAdmin(actorId: string): Promise<DisputaAdmin[]> {
  await exigirAdminBD(actorId);
  const { data, error } = await clienteServicio()
    .from('disputas')
    .select(
      'id, orden_id, motivo, evidencia, estado, resultado, nota_resolucion, creada_en, resuelta_en, reembolso_marcado_en, reembolso_confirmado_en, orden:ordenes!disputas_orden_id_fkey(numero, total_sats, total_usd_centavos, negocios(nombre), comprador:usuarios!ordenes_comprador_id_fkey(nombre))',
    );
  if (error) throw new Error(`No pudimos leer las disputas: ${error.message}`);

  const filas = ((data ?? []) as unknown as FilaDisputaBD[]).map((f) => ({
    id: f.id,
    ordenId: f.orden_id,
    numero: f.orden?.numero ?? 0,
    totalSats: f.orden?.total_sats ?? 0,
    totalUsdCentavos: f.orden?.total_usd_centavos ?? 0,
    comprador: f.orden?.comprador?.nombre ?? '',
    negocio: f.orden?.negocios?.nombre ?? '',
    motivo: f.motivo,
    evidencia: f.evidencia,
    estado: f.estado,
    resultado: f.resultado,
    notaResolucion: f.nota_resolucion,
    creadaEn: f.creada_en,
    resueltaEn: f.resuelta_en,
    reembolsoMarcadoEn: f.reembolso_marcado_en,
    reembolsoConfirmadoEn: f.reembolso_confirmado_en,
  }));

  // Open disputes first, oldest first so the longest wait is at the top. Then resolved, newest first.
  return filas.sort((a, b) => {
    if (a.estado !== b.estado) return a.estado === 'abierta' ? -1 : 1;
    if (a.estado === 'abierta') return a.creadaEn.localeCompare(b.creadaEn);
    return (b.resueltaEn ?? '').localeCompare(a.resueltaEn ?? '');
  });
}

// ---------------------------------------------------------------------------------------------
// Auditoría

// ---------------------------------------------------------------------------------------------
// Servicios y necesidades: moderation. Names only, never a phone or an email.

export type ServicioAdmin = {
  id: string;
  titulo: string;
  negocio: string;
  dueno: string;
  zona: string;
  tipoPrecio: 'fijo' | 'cotizar';
  precioUsdCentavos: number | null;
  unidad: string | null;
  activo: boolean;
  oculto: boolean;
  creadoEn: string;
};

type FilaServicioBD = {
  id: string;
  titulo: string;
  zona: string;
  tipo_precio: 'fijo' | 'cotizar';
  precio_usd_centavos: number | null;
  unidad: string | null;
  activo: boolean;
  oculto: boolean;
  creado_en: string;
  negocios: { nombre: string; dueno: { nombre: string } | null } | null;
};

export async function serviciosAdmin(actorId: string): Promise<ServicioAdmin[]> {
  await exigirAdminBD(actorId);
  const { data, error } = await clienteServicio()
    .from('servicios')
    .select(
      'id, titulo, zona, tipo_precio, precio_usd_centavos, unidad, activo, oculto, creado_en, negocios(nombre, dueno:usuarios!negocios_usuario_id_fkey(nombre))',
    )
    .order('creado_en', { ascending: false });
  if (error) throw new Error(`No pudimos leer los servicios: ${error.message}`);

  return ((data ?? []) as unknown as FilaServicioBD[]).map((f) => ({
    id: f.id,
    titulo: f.titulo,
    negocio: f.negocios?.nombre ?? '',
    dueno: f.negocios?.dueno?.nombre ?? '',
    zona: f.zona,
    tipoPrecio: f.tipo_precio,
    precioUsdCentavos: f.precio_usd_centavos,
    unidad: f.unidad,
    activo: f.activo,
    oculto: f.oculto,
    creadoEn: f.creado_en,
  }));
}

export type NecesidadAdmin = {
  id: string;
  titulo: string;
  autor: string;
  zona: string;
  presupuestoUsdCentavos: number | null;
  estado: 'abierta' | 'asignada' | 'cancelada' | 'vencida';
  oculta: boolean;
  creadaEn: string;
  venceEn: string;
};

type FilaNecesidadBD = {
  id: string;
  titulo: string;
  zona: string;
  presupuesto_usd_centavos: number | null;
  estado: NecesidadAdmin['estado'];
  oculta: boolean;
  creada_en: string;
  vence_en: string;
  autor: { nombre: string } | null;
};

export async function necesidadesAdmin(actorId: string): Promise<NecesidadAdmin[]> {
  await exigirAdminBD(actorId);
  const { data, error } = await clienteServicio()
    .from('necesidades')
    .select('id, titulo, zona, presupuesto_usd_centavos, estado, oculta, creada_en, vence_en, autor:usuarios!necesidades_usuario_id_fkey(nombre)')
    .order('creada_en', { ascending: false });
  if (error) throw new Error(`No pudimos leer las necesidades: ${error.message}`);

  return ((data ?? []) as unknown as FilaNecesidadBD[]).map((f) => ({
    id: f.id,
    titulo: f.titulo,
    autor: f.autor?.nombre ?? '',
    zona: f.zona,
    presupuestoUsdCentavos: f.presupuesto_usd_centavos,
    estado: f.estado,
    oculta: f.oculta,
    creadaEn: f.creada_en,
    venceEn: f.vence_en,
  }));
}

/** Hides a service from the catalogue, or shows it again. The database writes the audit row. */
export async function ocultarServicio(actorId: string, servicioId: string, oculto: boolean): Promise<Resultado<null>> {
  if (!esUuid(servicioId)) return fallo('NO_ENCONTRADA', 'No encontramos ese servicio.');
  try {
    if (!(await esAdminEnBaseDatos(actorId))) return NO_ADMIN();
    const { error } = await clienteServicio().rpc('ocultar_servicio', {
      p_servicio: servicioId,
      p_actor: actorId,
      p_oculto: oculto,
    });
    if (error) return desdeError(error);
    return exito(null);
  } catch (error) {
    return desdeError(error);
  }
}

/** Hides a need from the board, or shows it again. The database writes the audit row. */
export async function ocultarNecesidad(actorId: string, necesidadId: string, oculta: boolean): Promise<Resultado<null>> {
  if (!esUuid(necesidadId)) return fallo('NO_ENCONTRADA', 'No encontramos esa necesidad.');
  try {
    if (!(await esAdminEnBaseDatos(actorId))) return NO_ADMIN();
    const { error } = await clienteServicio().rpc('ocultar_necesidad', {
      p_necesidad: necesidadId,
      p_actor: actorId,
      p_oculta: oculta,
    });
    if (error) return desdeError(error);
    return exito(null);
  } catch (error) {
    return desdeError(error);
  }
}

export async function auditoriaAdmin(actorId: string): Promise<FilaAuditoria[]> {
  await exigirAdminBD(actorId);
  const db = clienteServicio();
  const { data, error } = await db
    .from('auditoria')
    .select('id, accion, entidad, entidad_id, detalle, creado_en, actor_id, actor:usuarios!auditoria_actor_id_fkey(nombre)')
    .order('creado_en', { ascending: false })
    .order('id', { ascending: false })
    .limit(AUDITORIA_LIMITE);
  if (error) throw new Error(`No pudimos leer la auditoría: ${error.message}`);

  const filas = (data ?? []) as unknown as (FilaAuditoriaBD & { entidad: string; entidad_id: string })[];
  const referencias = await referenciasAuditoria(db, filas);
  return filas.map((f) => filaAuditoria(f, referencias.get(f.entidad_id) ?? null));
}

// ---------------------------------------------------------------------------------------------
// Embudo de compra

export type PasoEmbudo = {
  nombre: string;
  etiqueta: string;
  orden: number;
  sesiones: number;
  eventos: number;
  valorUsdCentavos: number;
};

/** The purchase funnel of CacaoMarket for [desde, hasta), one row per step in order. */
export async function embudoAdmin(actorId: string, desde: string, hasta: string): Promise<PasoEmbudo[]> {
  await exigirAdminBD(actorId);
  const { data, error } = await clienteServicio().rpc('embudo', {
    p_sitio: 'market',
    p_desde: desde,
    p_hasta: hasta,
  });
  if (error) throw new Error(`No pudimos leer el embudo: ${error.message}`);
  return (data ?? []).map((f) => ({
    nombre: f.nombre,
    etiqueta: f.etiqueta,
    orden: f.orden,
    sesiones: numero(f.sesiones),
    eventos: numero(f.eventos),
    valorUsdCentavos: numero(f.valor_usd_centavos),
  }));
}

/** One product as the admin inventory shows it. Stock is the theoretical count the database keeps. */
export type ProductoInventarioAdmin = {
  id: string;
  nombre: string;
  negocio: string;
  unidad: string;
  precioUsdCentavos: number;
  stock: number;
  activo: boolean;
};

type FilaInventarioBD = {
  id: string;
  nombre: string;
  unidad: string;
  precio_usd_centavos: number;
  stock: number;
  activo: boolean;
  negocios: { nombre: string } | null;
};

/** The products of every shop, sold-out first. Stock falls when an order is placed and comes back when it lapses or is cancelled. */
export async function inventarioAdmin(actorId: string): Promise<ProductoInventarioAdmin[]> {
  await exigirAdminBD(actorId);
  const { data, error } = await clienteServicio()
    .from('productos')
    .select('id, nombre, unidad, precio_usd_centavos, stock, activo, negocios(nombre)')
    .order('stock', { ascending: true })
    .order('nombre', { ascending: true })
    .limit(1000);
  if (error) throw new Error(`No pudimos leer el inventario: ${error.message}`);

  return ((data ?? []) as unknown as FilaInventarioBD[]).map((f) => ({
    id: f.id,
    nombre: f.nombre,
    negocio: f.negocios?.nombre ?? '',
    unidad: f.unidad,
    precioUsdCentavos: f.precio_usd_centavos,
    stock: f.stock,
    activo: f.activo,
  }));
}
