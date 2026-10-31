import 'server-only';

// CacaoPay para negocios: a business charges at its counter with the payments API, through its own client. The
// business is found from the account (one business per account), never from a request. The page calls these functions
// after it has checked the session, and every charge of a business goes through the same functions as the API
// (crearCobro, leerCobro, cancelarCobro), so the rules, the idempotency and the states are the same.

import { randomBytes } from 'node:crypto';

import { hashClave, LIMITES, type Producto } from '@/lib/api-cobros';
import {
  inicioDelDiaSV,
  inicioDelMesSV,
  validarCentavosCobro,
  VENCE_COBRO_SEGUNDOS,
} from '@/lib/cobro-negocio';
import { exito, desdeError, fallo, type Resultado } from './resultado';
import { clienteServicio } from './supabase';
import { configTiendas } from './api-cobros-btcpay';
import {
  cancelarCobro,
  crearCobro,
  leerCobro,
  type ClienteApi,
  type FilaCobro,
} from './api-cobros';
import { enlaceBilleteraDePrueba, ErrorBtcpay, type ConfigBtcpay } from './btcpay';
import { buscarTiendaPorNombre, crearTiendaNegocio, habilitarLightning } from './negocios-btcpay';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLAVE_IDEMPOTENCIA = /^[A-Za-z0-9_-]{8,100}$/;

/** Requests per minute on the public page: per visitor address, and per business. */
const CUOTA_PUBLICA_IP = 20;
const CUOTA_PUBLICA_NEGOCIO = 120;

/** The business of an account, as the screens need it. The payments API client is never sent to a browser. */
export type NegocioDeCuenta = {
  id: string;
  nombre: string;
  ubicacion: string;
  tipo: string | null;
  activo: boolean;
  tiendaBtcpay: string | null;
  clienteId: string | null;
};

/** A charge as the screens show it. */
export type CobroNegocio = {
  id: string;
  estado: FilaCobro['estado'];
  factura: string | null;
  usd_centavos: number;
  expira_en: string | null;
  pago_tardio: boolean;
  /** The test wallet's link. Only for demo invoices (regtest); null on any real invoice. */
  enlace_billetera: string | null;
};

export type CobroResumen = { id: string; estado: string; usd_centavos: number; creado_en: string; pagado_en: string | null };

export type ResumenNegocio = {
  hoy: { centavos: number; cuenta: number };
  mes: { centavos: number; cuenta: number };
  recientes: CobroResumen[];
};

/** The text a Supabase error carries, as an Error to throw. */
function textoDe(error: { message: string }): Error {
  return new Error(error.message);
}

type FilaNegocio = { id: string; nombre: string; ubicacion: string; tipo_negocio: string | null };

// The business with its CacaoPay state. The state comes from its own row (pay_negocios), read with the service role.
async function armarNegocio(negocio: FilaNegocio): Promise<NegocioDeCuenta> {
  const { data: activacion, error } = await clienteServicio()
    .from('pay_negocios')
    .select('estado, tienda_btcpay, cliente_id')
    .eq('negocio_id', negocio.id)
    .maybeSingle();
  if (error) throw textoDe(error);
  return {
    id: negocio.id,
    nombre: negocio.nombre,
    ubicacion: negocio.ubicacion,
    tipo: negocio.tipo_negocio,
    activo: activacion?.estado === 'activo',
    tiendaBtcpay: activacion?.tienda_btcpay ?? null,
    clienteId: activacion?.cliente_id ?? null,
  };
}

/** The business of an account, or null. Only the account's own id is ever passed in. */
export async function negocioDeCuenta(usuarioId: string): Promise<NegocioDeCuenta | null> {
  const { data, error } = await clienteServicio()
    .from('negocios')
    .select('id, nombre, ubicacion, tipo_negocio')
    .eq('usuario_id', usuarioId)
    .maybeSingle();
  if (error) throw textoDe(error);
  return data ? armarNegocio(data) : null;
}

/** A business by its id, for the public page. The caller reads only its name and charges through its client. */
async function negocioPorId(negocioId: string): Promise<NegocioDeCuenta | null> {
  if (!UUID.test(negocioId)) return null;
  const { data, error } = await clienteServicio()
    .from('negocios')
    .select('id, nombre, ubicacion, tipo_negocio')
    .eq('id', negocioId)
    .maybeSingle();
  if (error) throw textoDe(error);
  return data ? armarNegocio(data) : null;
}

/** The payments API client of an active business, read from the database with its product. */
async function clienteDeNegocio(negocio: NegocioDeCuenta): Promise<Resultado<ClienteApi>> {
  if (!negocio.activo || !negocio.clienteId || !negocio.tiendaBtcpay) {
    return fallo('NO_PERMITIDO', 'Tu negocio todavía no cobra con CacaoPay. Activalo primero.');
  }
  const { data, error } = await clienteServicio()
    .from('pay_api_clientes')
    .select('id, nombre, producto, tienda_btcpay, revocado_en')
    .eq('id', negocio.clienteId)
    .maybeSingle();
  if (error) return desdeError(error);
  if (!data || data.revocado_en !== null || data.tienda_btcpay !== negocio.tiendaBtcpay) {
    return fallo('NO_PERMITIDO', 'Tu negocio no puede cobrar ahora. Escribinos para revisarlo.');
  }
  return exito({
    id: data.id,
    nombre: data.nombre,
    producto: data.producto as Producto,
    tiendaPorDefecto: data.tienda_btcpay,
    puedeElegirTienda: false,
    avisoSecreto: '',
  });
}

/** The active business of an account, with its client. Used by every counter page and action. */
async function cuentaActiva(usuarioId: string): Promise<Resultado<{ negocio: NegocioDeCuenta; cliente: ClienteApi }>> {
  const negocio = await negocioDeCuenta(usuarioId);
  if (!negocio) return fallo('NO_ENCONTRADA', 'Todavía no tenés un negocio para cobrar.');
  const cliente = await clienteDeNegocio(negocio);
  if (!cliente.ok) return cliente;
  return exito({ negocio, cliente: cliente.dato });
}

export type DatosActivacion = { nombre: string; tipo: string; ubicacion: string };

/** The business ids that already have a store, so a stored name cannot be claimed twice. */
async function tiendasReclamadas(): Promise<Set<string>> {
  const { data, error } = await clienteServicio().from('pay_negocios').select('tienda_btcpay').not('tienda_btcpay', 'is', null);
  if (error) throw textoDe(error);
  return new Set((data ?? []).map((f) => f.tienda_btcpay as string));
}

async function soltarActivacion(negocioId: string): Promise<void> {
  const { error } = await clienteServicio().rpc('pay_negocio_soltar', { p_negocio: negocioId });
  if (error) console.error('No pudimos soltar la activación del negocio:', error.message);
}

/**
 * Activates the account's business for CacaoPay. The database takes the claim first, so a second request while the
 * first one runs gets "en_curso" and makes nothing. Then, in order, each step is recorded before the next:
 *   1. the store (its id is saved at once; a lost id is found again by its name, so no second store is made);
 *   2. its Lightning;
 *   3. its payments API client, with the business marked active, in one database step.
 * A failed step releases the claim. The next try resumes at the step that was not recorded.
 */
export async function activarNegocio(usuarioId: string, datos: DatosActivacion): Promise<Resultado<{ negocioId: string }>> {
  const servicio = clienteServicio();
  const { data, error } = await servicio.rpc('pay_negocio_reclamar', {
    p_usuario: usuarioId,
    p_nombre: datos.nombre,
    p_tipo: datos.tipo,
    p_ubicacion: datos.ubicacion,
  });
  if (error) return desdeError(error);

  const reclamo = data as unknown as {
    situacion: 'activo' | 'en_curso' | 'reclamado';
    negocio: { id: string; nombre: string };
    activacion: { tienda_btcpay: string | null };
  };
  const negocioId = reclamo.negocio.id;
  if (reclamo.situacion === 'activo') return exito({ negocioId });
  if (reclamo.situacion === 'en_curso') {
    return fallo('EN_CURSO', 'Ya estamos preparando tu negocio. Esperá un momento y recargá la página.');
  }

  const config = await configTiendas();
  if (!config) {
    await soltarActivacion(negocioId);
    return fallo('NO_DISPONIBLE', 'El cobro con bitcoin no está disponible ahora. Probá más tarde.');
  }

  try {
    let tienda = reclamo.activacion.tienda_btcpay;
    if (!tienda) {
      const reclamadas = await tiendasReclamadas();
      tienda =
        (await buscarTiendaPorNombre(config, reclamo.negocio.nombre, reclamadas)) ??
        (await crearTiendaNegocio(config, reclamo.negocio.nombre));
      const { error: errorTienda } = await servicio.rpc('pay_negocio_guardar_tienda', { p_negocio: negocioId, p_tienda: tienda });
      if (errorTienda) throw textoDe(errorTienda);
    }

    await habilitarLightning(config, tienda);

    const clave = `cp_${randomBytes(24).toString('base64url')}`;
    const { error: errorCliente } = await servicio.rpc('pay_negocio_crear_cliente', {
      p_negocio: negocioId,
      p_prefijo: clave.slice(0, 11),
      p_clave_hash: hashClave(clave),
      p_aviso_secreto: randomBytes(32).toString('hex'),
    });
    if (errorCliente) throw textoDe(errorCliente);
    return exito({ negocioId });
  } catch (caught) {
    await soltarActivacion(negocioId);
    if (caught instanceof ErrorBtcpay) {
      console.error('BTCPay al activar el negocio:', caught.message);
      return fallo('BTCPAY', 'No pudimos preparar tu negocio en el cobro con bitcoin. Probá de nuevo en un momento.');
    }
    console.error('Al activar el negocio:', caught instanceof Error ? caught.message : caught);
    return fallo('ERROR', 'Algo falló de nuestro lado. Probá de nuevo en un momento.');
  }
}

function vista(cobro: FilaCobro, config: ConfigBtcpay | null): CobroNegocio {
  return {
    id: cobro.id,
    estado: cobro.estado,
    factura: cobro.factura,
    usd_centavos: cobro.usd_centavos,
    expira_en: cobro.expira_en,
    pago_tardio: cobro.pago_tardio_en !== null,
    enlace_billetera: config && cobro.factura ? enlaceBilleteraDePrueba(config, cobro.factura) : null,
  };
}

function claveValida(clave: string): Resultado<string> {
  if (!CLAVE_IDEMPOTENCIA.test(clave)) return fallo('DATOS_INVALIDOS', 'La venta no es válida. Empezá el cobro de nuevo.');
  return exito(clave);
}

/** One charge through the payments API functions: the same idempotency, body and state rules as the API. */
async function cobrarCon(
  cliente: ClienteApi,
  clave: string,
  descripcion: string,
  referencia: string,
  centavos: number,
): Promise<Resultado<CobroNegocio>> {
  const cuerpo = JSON.stringify({
    monto: centavos,
    moneda: 'USD',
    descripcion: descripcion.slice(0, LIMITES.descripcionMax),
    referencia: referencia.slice(0, LIMITES.referenciaMax),
    vence_en_segundos: VENCE_COBRO_SEGUNDOS,
  });
  const creado = await crearCobro(cliente, clave, cuerpo);
  if (!creado.ok) return creado;
  return exito(vista(creado.dato.cobro, creado.dato.config));
}

/**
 * A sale at the counter. The key is the attempt's: a double tap sends the same key and gets the same charge. The
 * amount is checked here, in US cents, between $1.00 and $10,000.00.
 */
export async function cobrarEnCaja(usuarioId: string, centavos: unknown, clave: string): Promise<Resultado<CobroNegocio>> {
  const valida = claveValida(clave);
  if (!valida.ok) return valida;
  const monto = validarCentavosCobro(centavos);
  if (!monto.ok) return monto;
  const cuenta = await cuentaActiva(usuarioId);
  if (!cuenta.ok) return cuenta;
  return cobrarCon(cuenta.dato.cliente, `caja-${valida.dato}`, `Venta en ${cuenta.dato.negocio.nombre}`, `caja-${valida.dato}`, monto.dato);
}

/** The live state of a counter charge. Only a charge of this business can be read. */
export async function estadoEnCaja(usuarioId: string, cobroId: string): Promise<Resultado<CobroNegocio>> {
  if (!UUID.test(cobroId)) return fallo('NO_ENCONTRADA', 'No encontramos ese cobro.');
  const cuenta = await cuentaActiva(usuarioId);
  if (!cuenta.ok) return cuenta;
  const leido = await leerCobro(cuenta.dato.cliente, cobroId);
  if (!leido.ok) return leido;
  return exito(vista(leido.dato.cobro, leido.dato.config));
}

/** Cancels a pending counter charge of this business. */
export async function cancelarEnCaja(usuarioId: string, cobroId: string): Promise<Resultado<CobroNegocio>> {
  if (!UUID.test(cobroId)) return fallo('NO_ENCONTRADA', 'No encontramos ese cobro.');
  const cuenta = await cuentaActiva(usuarioId);
  if (!cuenta.ok) return cuenta;
  const cancelado = await cancelarCobro(cuenta.dato.cliente, cobroId);
  if (!cancelado.ok) return cancelado;
  return exito(vista(cancelado.dato.cobro, cancelado.dato.config));
}

/** Today's and this month's sales (paid charges only), and the latest charges. Dates are El Salvador days. */
export async function resumenNegocio(usuarioId: string, ahora: Date = new Date()): Promise<Resultado<ResumenNegocio>> {
  const cuenta = await cuentaActiva(usuarioId);
  if (!cuenta.ok) return cuenta;
  const servicio = clienteServicio();
  const clienteId = cuenta.dato.cliente.id;

  const { data: pagados, error: errorPagados } = await servicio
    .from('pay_cobros')
    .select('usd_centavos, pagado_en')
    .eq('cliente_id', clienteId)
    .eq('estado', 'pagado')
    .gte('pagado_en', inicioDelMesSV(ahora).toISOString());
  if (errorPagados) return desdeError(errorPagados);

  const { data: recientes, error: errorRecientes } = await servicio
    .from('pay_cobros')
    .select('id, estado, usd_centavos, creado_en, pagado_en')
    .eq('cliente_id', clienteId)
    .order('creado_en', { ascending: false })
    .limit(20);
  if (errorRecientes) return desdeError(errorRecientes);

  const desdeHoy = inicioDelDiaSV(ahora).getTime();
  const sumar = (filas: { usd_centavos: number }[]) => filas.reduce((total, f) => total + f.usd_centavos, 0);
  const deHoy = (pagados ?? []).filter((p) => p.pagado_en !== null && new Date(p.pagado_en).getTime() >= desdeHoy);
  return exito({
    hoy: { centavos: sumar(deHoy), cuenta: deHoy.length },
    mes: { centavos: sumar(pagados ?? []), cuenta: (pagados ?? []).length },
    recientes: recientes ?? [],
  });
}

/** The public name of an active business, or null. The public page shows nothing else. */
export async function nombrePublico(negocioId: string): Promise<string | null> {
  if (!UUID.test(negocioId)) return null;
  const { data, error } = await clienteServicio()
    .from('pay_negocios')
    .select('negocios(nombre)')
    .eq('negocio_id', negocioId)
    .eq('estado', 'activo')
    .maybeSingle();
  if (error) throw textoDe(error);
  const negocio = data?.negocios as { nombre: string } | { nombre: string }[] | null | undefined;
  if (!negocio) return null;
  return Array.isArray(negocio) ? (negocio[0]?.nombre ?? null) : negocio.nombre;
}

/** The businesses that charge with CacaoPay, for the "Dónde gastar" list. */
export async function negociosQueCobran(): Promise<{ id: string; nombre: string; ubicacion: string; tipo: string | null }[]> {
  const { data, error } = await clienteServicio()
    .from('pay_negocios')
    .select('negocios(id, nombre, ubicacion, tipo_negocio)')
    .eq('estado', 'activo');
  if (error) throw textoDe(error);
  const lista: { id: string; nombre: string; ubicacion: string; tipo: string | null }[] = [];
  for (const fila of data ?? []) {
    const n = fila.negocios as
      | { id: string; nombre: string; ubicacion: string; tipo_negocio: string | null }
      | { id: string; nombre: string; ubicacion: string; tipo_negocio: string | null }[]
      | null;
    const uno = Array.isArray(n) ? n[0] : n;
    if (uno) lista.push({ id: uno.id, nombre: uno.nombre, ubicacion: uno.ubicacion, tipo: uno.tipo_negocio });
  }
  return lista.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

/** The visitor's address, from the proxy header. Unknown when none is sent. */
export function ipDeCabeceras(cabeceras: Headers): string {
  const primera = cabeceras.get('x-forwarded-for')?.split(',')[0]?.trim();
  return primera || cabeceras.get('x-real-ip') || 'desconocida';
}

async function dentroDeCuota(clave: string, maximo: number): Promise<boolean> {
  const { data, error } = await clienteServicio().rpc('pay_cuota_publica', {
    p_clave: clave,
    p_maximo: maximo,
    p_ventana_segundos: 60,
  });
  if (error) throw textoDe(error);
  return data === true;
}

const MSG_LIMITE = 'Hiciste demasiadas pruebas seguidas. Esperá un minuto y probá de nuevo.';

/** The public page's charge: a visitor pays a business with an amount in dollars. Rate limited per address and business. */
export async function cobrarPublico(
  negocioId: string,
  centavos: unknown,
  clave: string,
  ip: string,
): Promise<Resultado<CobroNegocio>> {
  if (!UUID.test(negocioId)) return fallo('NO_ENCONTRADA', 'Este negocio no acepta pagos por CacaoPay.');
  const valida = claveValida(clave);
  if (!valida.ok) return valida;
  if (!(await dentroDeCuota(`pagar-ip:${ip}`, CUOTA_PUBLICA_IP)) || !(await dentroDeCuota(`pagar-negocio:${negocioId}`, CUOTA_PUBLICA_NEGOCIO))) {
    return fallo('LIMITE', MSG_LIMITE);
  }
  const monto = validarCentavosCobro(centavos);
  if (!monto.ok) return monto;
  const negocio = await negocioPorId(negocioId);
  if (!negocio) return fallo('NO_ENCONTRADA', 'Este negocio no acepta pagos por CacaoPay.');
  const cliente = await clienteDeNegocio(negocio);
  if (!cliente.ok) return cliente;
  return cobrarCon(cliente.dato, `pagina-${valida.dato}`, `Pago en ${negocio.nombre}`, `pagina-${valida.dato}`, monto.dato);
}

/** The state of a visitor's charge on the public page. Only a charge of this business can be read. */
export async function estadoPublico(negocioId: string, cobroId: string, ip: string): Promise<Resultado<CobroNegocio>> {
  if (!UUID.test(negocioId) || !UUID.test(cobroId)) return fallo('NO_ENCONTRADA', 'No encontramos ese cobro.');
  if (!(await dentroDeCuota(`pagar-ip:${ip}`, CUOTA_PUBLICA_IP * 6))) return fallo('LIMITE', MSG_LIMITE);
  const negocio = await negocioPorId(negocioId);
  if (!negocio) return fallo('NO_ENCONTRADA', 'Este negocio no acepta pagos por CacaoPay.');
  const cliente = await clienteDeNegocio(negocio);
  if (!cliente.ok) return cliente;
  const leido = await leerCobro(cliente.dato, cobroId);
  if (!leido.ok) return leido;
  return exito(vista(leido.dato.cobro, leido.dato.config));
}
