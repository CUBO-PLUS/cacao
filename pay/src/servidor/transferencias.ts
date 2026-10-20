import 'server-only';

import { TARIFAS, type Entrega, type Tarifa } from '@/lib/cotizacion';
import {
  aUsdCentavos,
  enmascararContacto,
  esCodigo,
  esDemo,
  normalizarCodigo,
  normalizarContacto,
  type EstadoEnvio,
  type RolEnvio,
} from '@/lib/transferencias';

import { cotizacionUsdBtc } from '@/lib/precio/fuente';
import { satsParaFactura, type PagoLightning } from '@/lib/lightning';

import {
  configDesdeEntorno,
  crearFactura,
  enlaceBilleteraDePrueba,
  ErrorBtcpay,
  leerFactura,
  type ConfigBtcpay,
} from './btcpay';
import { registrarEvento } from './eventos';
import { desdeError, exito, fallo, type Resultado } from './resultado';
import { clienteServicio } from './supabase';
import { cotizarEnServidor, tarifas, tasaEurUsd } from './tasas';

// Transfers. Every change names the acting user first, checks the input here, and then calls a
// database function with the service role. A stranger gets the same answer as a missing transfer.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esUuid = (valor: string) => UUID.test(valor);

export const POR_PAGINA = 20;
const ENTREGAS = Object.keys(TARIFAS) as Entrega[];
const MENSAJE_NO_ENCONTRADA = 'No encontramos esa transferencia.';
// The database takes a null for these parameters, but the database types say string.
const NULO = null as unknown as string;

export type Envio = {
  id: string;
  codigo: string;
  estado: EstadoEnvio;
  monedaOrigen: 'USD' | 'EUR';
  montoOrigenCentavos: number;
  comisionCentavos: number;
  netoCentavos: number;
  tasa: number;
  tasaFuente: string;
  monedaDestino: 'USD' | 'SATS';
  montoDestino: number;
  entrega: Entrega;
  minutosEstimados: number;
  destinatarioNombre: string;
  /** Never the whole contact: "•••• ••07" or "ma•••@gmail.com". */
  destinatarioContactoEnmascarado: string;
  /** The sender's first name only. */
  remitenteNombre: string;
  nota: string;
  creadaEn: string;
  procesandoEn: string | null;
  completadaEn: string | null;
  fallidaEn: string | null;
  canceladaEn: string | null;
  motivo: string | null;
};

export type PasoHistorial = { estado: EstadoEnvio; detalle: string; cuando: string };

/** One transfer for the people in it. The full contact is only for the sender and the admin. */
export type EnvioDetalle = Envio & {
  rol: RolEnvio;
  destinatarioContacto: string | null;
  historial: PasoHistorial[];
};

export type PaginaEnvios = { envios: Envio[]; total: number; pagina: number; porPagina: number };

/** What anyone with the code may see. No sender, no contact, no fee, no note. */
export type RastreoPublico = {
  codigo: string;
  estado: EstadoEnvio;
  monedaDestino: 'USD' | 'SATS';
  montoDestino: number;
  entrega: Entrega;
  minutosEstimados: number;
  /** The recipient's first name only. */
  destinatarioNombre: string;
  creadaEn: string;
  historial: PasoHistorial[];
};

export type DatosNuevoEnvio = {
  destinatarioNombre: string;
  destinatarioContacto: string;
  monedaOrigen: 'USD' | 'EUR';
  montoOrigenCentavos: number;
  entrega: Entrega;
  nota: string;
  /** Made once per form, so a double tap creates one transfer. Up to 100 characters. */
  clave: string;
};

/** The state a mutation leaves the transfer in. */
export type CambioEnvio = { id: string; estado: EstadoEnvio };

// The columns a list or a detail needs. The sender's first name comes from the usuarios table.
export const COLUMNAS_ENVIO =
  'id, codigo, remitente_id, destinatario_nombre, destinatario_contacto, destinatario_id, moneda_origen, monto_origen_centavos, comision_centavos, neto_centavos, tasa, tasa_fuente, moneda_destino, monto_destino, entrega, estado, nota, creada_en, procesando_en, completada_en, fallida_en, cancelada_en, motivo, remitente:usuarios!pay_transferencias_remitente_id_fkey(nombre)';

// Only what the public view may show. Nothing else is selected, so nothing can leak by mistake.
const COLUMNAS_RASTREO = 'id, codigo, estado, moneda_destino, monto_destino, entrega, creada_en, destinatario_nombre';

const COLUMNAS_CAMBIO = 'id, codigo, remitente_id, estado, moneda_origen, monto_origen_centavos';

// What the Lightning payment needs: the sender, the state, the amount and the invoice of the transfer.
const COLUMNAS_PAGO =
  'id, codigo, remitente_id, estado, moneda_origen, monto_origen_centavos, btcpay_factura_id, btcpay_tienda_id, factura, factura_sats, factura_usd_centavos, factura_expira';

// Lightning through BTCPay Server. The invoice is valid for this long.
const FACTURA_MINUTOS = 15;
const SIN_PRECIO_BTC = 'No pudimos obtener el precio del bitcoin. Probá de nuevo en un momento.';
const SIN_FACTURA = 'No pudimos crear la factura Lightning. Probá de nuevo en un momento.';

type FilaPago = Pick<FilaEnvio, 'id' | 'codigo' | 'remitente_id' | 'estado' | 'moneda_origen' | 'monto_origen_centavos'> & {
  btcpay_factura_id: string | null;
  btcpay_tienda_id: string | null;
  factura: string | null;
  factura_sats: number | null;
  factura_usd_centavos: number | null;
  factura_expira: string | null;
};

export type FilaEnvio = {
  id: string;
  codigo: string;
  remitente_id: string;
  destinatario_nombre: string;
  destinatario_contacto: string;
  destinatario_id: string | null;
  moneda_origen: 'USD' | 'EUR';
  monto_origen_centavos: number;
  comision_centavos: number;
  neto_centavos: number;
  tasa: number;
  tasa_fuente: string;
  moneda_destino: 'USD' | 'SATS';
  monto_destino: number;
  entrega: Entrega;
  estado: EstadoEnvio;
  nota: string;
  creada_en: string;
  procesando_en: string | null;
  completada_en: string | null;
  fallida_en: string | null;
  cancelada_en: string | null;
  motivo: string | null;
  remitente: { nombre: string } | null;
};

// Length in characters, as the database counts them.
function largo(texto: string): number {
  return Array.from(texto).length;
}

function primerNombre(nombre: string | null | undefined): string {
  return (nombre ?? '').trim().split(/\s+/)[0] ?? '';
}

/** A page number from the URL: anything that is not a whole number from 1 up means the first page. */
export function paginaValida(pagina?: number): number {
  return pagina !== undefined && Number.isInteger(pagina) && pagina >= 1 ? pagina : 1;
}

export function aEnvio(fila: FilaEnvio, tarifasLeidas: Record<Entrega, Tarifa>): Envio {
  return {
    id: fila.id,
    codigo: fila.codigo,
    estado: fila.estado,
    monedaOrigen: fila.moneda_origen,
    montoOrigenCentavos: fila.monto_origen_centavos,
    comisionCentavos: fila.comision_centavos,
    netoCentavos: fila.neto_centavos,
    tasa: Number(fila.tasa),
    tasaFuente: fila.tasa_fuente,
    monedaDestino: fila.moneda_destino,
    montoDestino: Number(fila.monto_destino),
    entrega: fila.entrega,
    minutosEstimados: tarifasLeidas[fila.entrega].minutosEstimados,
    destinatarioNombre: fila.destinatario_nombre,
    destinatarioContactoEnmascarado: enmascararContacto(fila.destinatario_contacto),
    remitenteNombre: primerNombre(fila.remitente?.nombre),
    nota: fila.nota,
    creadaEn: fila.creada_en,
    procesandoEn: fila.procesando_en,
    completadaEn: fila.completada_en,
    fallidaEn: fila.fallida_en,
    canceladaEn: fila.cancelada_en,
    motivo: fila.motivo,
  };
}

/** The admin flag, read from the database. The session flag is never enough for a write. */
export async function esAdministrador(usuarioId: string): Promise<boolean> {
  if (!esUuid(usuarioId)) return false;
  const { data, error } = await clienteServicio()
    .from('usuarios')
    .select('es_admin')
    .eq('id', usuarioId)
    .maybeSingle();
  if (error) throw new Error(`No pudimos revisar tu cuenta: ${error.message}`);
  return data?.es_admin === true;
}

async function historialDe(envioId: string): Promise<PasoHistorial[]> {
  const { data, error } = await clienteServicio()
    .from('pay_historial')
    .select('estado, detalle, creado_en')
    .eq('transferencia_id', envioId)
    .order('id');
  if (error) throw new Error(`No pudimos leer el historial: ${error.message}`);
  return (data ?? []).map((paso) => ({ estado: paso.estado, detalle: paso.detalle, cuando: paso.creado_en }));
}

async function paginaDe(
  consulta: PromiseLike<{
    data: unknown[] | null;
    count: number | null;
    error: { message: string; code?: string } | null;
  }>,
  pagina: number,
  mensaje: string,
): Promise<PaginaEnvios> {
  const { data, count, error } = await consulta;
  // A page past the last one is not a failure: the database refuses the range, the list is empty.
  if (error?.code === 'PGRST103') return { envios: [], total: 0, pagina, porPagina: POR_PAGINA };
  if (error) throw new Error(`${mensaje}: ${error.message}`);
  const tarifasLeidas = await tarifas();
  const filas = (data ?? []) as unknown as FilaEnvio[];
  return {
    envios: filas.map((f) => aEnvio(f, tarifasLeidas)),
    total: count ?? 0,
    pagina,
    porPagina: POR_PAGINA,
  };
}

function rangoDe(pagina: number): [number, number] {
  const desde = (pagina - 1) * POR_PAGINA;
  return [desde, desde + POR_PAGINA - 1];
}

function paginaVacia(pagina?: number): PaginaEnvios {
  return { envios: [], total: 0, pagina: paginaValida(pagina), porPagina: POR_PAGINA };
}

/** The transfers this user sent, newest first. */
export async function misEnvios(usuarioId: string, opciones: { pagina?: number } = {}): Promise<PaginaEnvios> {
  if (!esUuid(usuarioId)) return paginaVacia(opciones.pagina);
  const pagina = paginaValida(opciones.pagina);
  const [desde, hasta] = rangoDe(pagina);
  return paginaDe(
    clienteServicio()
      .from('pay_transferencias')
      .select(COLUMNAS_ENVIO, { count: 'exact' })
      .eq('remitente_id', usuarioId)
      .order('creada_en', { ascending: false })
      .order('id', { ascending: false })
      .range(desde, hasta),
    pagina,
    'No pudimos leer tus envíos',
  );
}

/** The transfers addressed to this user: their phone or email was the recipient's contact. */
export async function recibidos(usuarioId: string, opciones: { pagina?: number } = {}): Promise<PaginaEnvios> {
  if (!esUuid(usuarioId)) return paginaVacia(opciones.pagina);
  const pagina = paginaValida(opciones.pagina);
  const [desde, hasta] = rangoDe(pagina);
  return paginaDe(
    clienteServicio()
      .from('pay_transferencias')
      .select(COLUMNAS_ENVIO, { count: 'exact' })
      .eq('destinatario_id', usuarioId)
      .order('creada_en', { ascending: false })
      .order('id', { ascending: false })
      .range(desde, hasta),
    pagina,
    'No pudimos leer los envíos que recibiste',
  );
}

/**
 * One transfer, if the user sent it, is its recipient, or is an administrator. Anyone else gets null.
 * The role is the first of these that fits: sender, recipient, admin.
 */
export async function envioPara(
  usuario: { id: string; esAdmin: boolean },
  envioId: string,
): Promise<EnvioDetalle | null> {
  if (!esUuid(usuario.id) || !esUuid(envioId)) return null;
  const { data, error } = await clienteServicio()
    .from('pay_transferencias')
    .select(COLUMNAS_ENVIO)
    .eq('id', envioId)
    .maybeSingle();
  if (error) throw new Error(`No pudimos leer la transferencia: ${error.message}`);
  if (!data) return null;

  const fila = data as unknown as FilaEnvio;
  let rol: RolEnvio | null = null;
  if (fila.remitente_id === usuario.id) rol = 'remitente';
  else if (fila.destinatario_id === usuario.id) rol = 'destinatario';
  else if (usuario.esAdmin && (await esAdministrador(usuario.id))) rol = 'admin';
  if (!rol) return null;

  const [tarifasLeidas, historial] = await Promise.all([tarifas(), historialDe(envioId)]);
  return {
    ...aEnvio(fila, tarifasLeidas),
    rol,
    destinatarioContacto: rol === 'destinatario' ? null : fila.destinatario_contacto,
    historial,
  };
}

/**
 * The public tracking view. Anyone with the code gets the state, the timeline, what the recipient
 * receives and how. A malformed or unknown code gets null.
 */
export async function rastreo(codigo: string): Promise<RastreoPublico | null> {
  if (!esCodigo(codigo)) return null;
  const forma = normalizarCodigo(codigo);
  const { data, error } = await clienteServicio()
    .from('pay_transferencias')
    .select(COLUMNAS_RASTREO)
    .eq('codigo', forma)
    .maybeSingle();
  if (error) throw new Error(`No pudimos rastrear el envío: ${error.message}`);
  if (!data) return null;

  const fila = data as unknown as Pick<
    FilaEnvio,
    'codigo' | 'estado' | 'moneda_destino' | 'monto_destino' | 'entrega' | 'creada_en' | 'destinatario_nombre'
  >;
  const [tarifasLeidas, historial] = await Promise.all([tarifas(), historialDe(data.id)]);
  return {
    codigo: fila.codigo,
    estado: fila.estado,
    monedaDestino: fila.moneda_destino,
    montoDestino: Number(fila.monto_destino),
    entrega: fila.entrega,
    minutosEstimados: tarifasLeidas[fila.entrega].minutosEstimados,
    destinatarioNombre: primerNombre(fila.destinatario_nombre),
    creadaEn: fila.creada_en,
    historial,
  };
}

// Value in US cents of a transfer's amount, for the funnel. EUR uses the stored rate.
async function valorUsdDe(monto: number, moneda: 'USD' | 'EUR' | 'SATS'): Promise<number> {
  if (moneda !== 'EUR') return monto;
  return aUsdCentavos(monto, 'EUR', (await tasaEurUsd()).tasa);
}

// Server events have no browser visit, so each transfer is its own session.
function sesionDelEnvio(envioId: string): string {
  return `envio-${envioId}`;
}

/**
 * Creates a transfer. The amounts are quoted here, from the database rates, and the database checks
 * them again. A repeated clave returns the transfer it made the first time.
 */
export async function crearEnvio(
  usuarioId: string,
  datos: DatosNuevoEnvio,
): Promise<Resultado<{ id: string; codigo: string }>> {
  try {
    if (!esUuid(usuarioId)) return fallo('NO_ENCONTRADA', 'No encontramos tu cuenta.');

    const nombre = datos.destinatarioNombre.trim();
    if (largo(nombre) < 2 || largo(nombre) > 80) {
      return fallo('DATOS_INVALIDOS', 'El nombre del destinatario tiene que tener entre 2 y 80 caracteres.');
    }
    const contacto = normalizarContacto(datos.destinatarioContacto);
    if (!contacto) {
      return fallo('DATOS_INVALIDOS', 'Escribí un celular de 8 dígitos o un correo válido.');
    }
    const nota = datos.nota.trim();
    if (largo(nota) > 200) return fallo('DATOS_INVALIDOS', 'La nota no puede pasar de 200 caracteres.');
    if (largo(datos.clave.trim()) < 1 || largo(datos.clave) > 100) {
      return fallo('DATOS_INVALIDOS', 'Falta la clave del envío. Recargá la pantalla.');
    }
    if (datos.monedaOrigen !== 'USD' && datos.monedaOrigen !== 'EUR') {
      return fallo('DATOS_INVALIDOS', 'La moneda de origen tiene que ser USD o EUR.');
    }
    if (!ENTREGAS.includes(datos.entrega)) {
      return fallo('DATOS_INVALIDOS', 'Elegí cómo se entrega el dinero.');
    }

    const cotizado = await cotizarEnServidor({
      monedaOrigen: datos.monedaOrigen,
      montoOrigenCentavos: datos.montoOrigenCentavos,
      entrega: datos.entrega,
    });
    if (!cotizado.ok) return cotizado;
    const c = cotizado.dato;

    const { data, error } = await clienteServicio().rpc('pay_crear_transferencia', {
      p_remitente: usuarioId,
      p_destinatario_nombre: nombre,
      p_destinatario_contacto: contacto.valor,
      p_moneda_origen: c.monedaOrigen,
      p_monto_origen: c.montoOrigenCentavos,
      p_moneda_destino: c.monedaDestino,
      p_entrega: c.entrega,
      p_tasa: c.tasa,
      p_tasa_fuente: c.tasaFuente,
      p_comision: c.comisionCentavos,
      p_monto_destino: c.montoDestino,
      p_nota: nota,
      p_clave: datos.clave,
    });
    if (error) return desdeError(error);

    await registrarEvento({
      nombre: 'creo_envio',
      sesion: sesionDelEnvio(data.id),
      usuarioId,
      ruta: '/enviar',
      objeto: data.codigo,
      valorUsdCentavos: await valorUsdDe(c.montoOrigenCentavos, c.monedaOrigen),
    });
    return exito({ id: data.id, codigo: data.codigo });
  } catch (error) {
    return desdeError(error);
  }
}

async function cargarCambio(envioId: string) {
  const { data, error } = await clienteServicio()
    .from('pay_transferencias')
    .select(COLUMNAS_CAMBIO)
    .eq('id', envioId)
    .maybeSingle();
  if (error) throw new Error(`No pudimos leer la transferencia: ${error.message}`);
  return data as unknown as Pick<FilaEnvio, 'id' | 'codigo' | 'remitente_id' | 'estado' | 'moneda_origen' | 'monto_origen_centavos'> | null;
}

// The sender may change their own transfer, and an administrator may change any. Anyone else is
// told the transfer is not found, so existence is not revealed.
async function puedeCambiar(usuarioId: string, fila: { remitente_id: string }): Promise<boolean> {
  if (fila.remitente_id === usuarioId) return true;
  return esAdministrador(usuarioId);
}

// BTCPay is used only when the server has its address, its key and the store of Cacao Pay.
// Without it, the sender's "Enviar ahora" works as it did before.
function configuracionBtcpay(): { config: ConfigBtcpay; tienda: string } | null {
  const config = configDesdeEntorno(process.env);
  const tienda = (process.env.BTCPAY_STORE_ID ?? '').trim();
  if (!config || !/^[A-Za-z0-9]{10,64}$/.test(tienda)) return null;
  return { config, tienda };
}

/** True when the sender pays with Lightning: BTCPay is set up on this server. */
export function pagoLightningActivo(): boolean {
  return configuracionBtcpay() !== null;
}

function aPagoLightning(
  envioId: string,
  config: ConfigBtcpay,
  factura: { bolt11: string; sats: number; usdCentavos: number; expiraEn: string },
): PagoLightning {
  return {
    envioId,
    sats: factura.sats,
    usdCentavos: factura.usdCentavos,
    bolt11: factura.bolt11,
    expiraEn: factura.expiraEn,
    enlaceBilleteraDePrueba: enlaceBilleteraDePrueba(config, factura.bolt11),
  };
}

// The sender pays the whole amount, so the invoice is for the origin amount in US cents.
async function cargarPago(envioId: string): Promise<FilaPago | null> {
  const { data, error } = await clienteServicio()
    .from('pay_transferencias')
    .select(COLUMNAS_PAGO)
    .eq('id', envioId)
    .maybeSingle();
  if (error) throw new Error(`No pudimos leer la transferencia: ${error.message}`);
  return data as unknown as FilaPago | null;
}

/**
 * The Lightning invoice the sender pays for a transfer that is only created. A live invoice is
 * returned again; otherwise BTCPay makes one for the exact amount in sats at the current BTC price.
 */
export async function pagarEnvio(usuarioId: string, envioId: string): Promise<Resultado<PagoLightning>> {
  try {
    if (!esUuid(usuarioId) || !esUuid(envioId)) return fallo('NO_ENCONTRADA', MENSAJE_NO_ENCONTRADA);
    const btc = configuracionBtcpay();
    if (!btc) return fallo('NO_DISPONIBLE', 'El pago con Lightning no está activo en este servidor.');

    const fila = await cargarPago(envioId);
    if (!fila || fila.remitente_id !== usuarioId) return fallo('NO_ENCONTRADA', MENSAJE_NO_ENCONTRADA);
    if (fila.estado !== 'creada') return fallo('ESTADO_INVALIDO', 'Este envío ya no se puede pagar.');

    const vigente =
      fila.factura !== null &&
      fila.factura_sats !== null &&
      fila.factura_usd_centavos !== null &&
      fila.factura_expira !== null &&
      Date.parse(fila.factura_expira) > Date.now();
    if (vigente && fila.factura) {
      return exito(
        aPagoLightning(envioId, btc.config, {
          bolt11: fila.factura,
          sats: Number(fila.factura_sats),
          usdCentavos: Number(fila.factura_usd_centavos),
          expiraEn: fila.factura_expira ?? '',
        }),
      );
    }

    const usdCentavos = await valorUsdDe(fila.monto_origen_centavos, fila.moneda_origen);
    let usdBtc: number;
    try {
      usdBtc = await cotizacionUsdBtc();
    } catch {
      return fallo('SIN_COTIZACION', SIN_PRECIO_BTC);
    }
    const sats = satsParaFactura(usdCentavos, usdBtc);

    const factura = await crearFactura(btc.config, {
      storeId: btc.tienda,
      sats,
      minutos: FACTURA_MINUTOS,
      metadata: {
        producto: 'pay',
        orderId: fila.codigo,
        itemDesc: `Envío ${fila.codigo}`,
        usdCentavos,
        cotizacionUsdBtc: usdBtc,
      },
    });
    if (!factura.bolt11) return fallo('SIN_LIGHTNING', 'La tienda de BTCPay no tiene Lightning activado.');
    const expiraEn = factura.expiraEn.toISOString();

    const { error } = await clienteServicio().rpc('pay_registrar_factura', {
      p_transferencia: envioId,
      p_actor: usuarioId,
      p_factura_id: factura.id,
      p_tienda: btc.tienda,
      p_factura: factura.bolt11,
      p_sats: sats,
      p_expira: expiraEn,
      p_usd_centavos: usdCentavos,
    });
    if (error) return desdeError(error);

    return exito(aPagoLightning(envioId, btc.config, { bolt11: factura.bolt11, sats, usdCentavos, expiraEn }));
  } catch (error) {
    if (error instanceof ErrorBtcpay) {
      console.error('BTCPay al pagar envío:', error.message);
      return fallo('BTCPAY', SIN_FACTURA);
    }
    return desdeError(error);
  }
}

/**
 * The state of a transfer the sender is paying in Lightning. While it is only created and has an
 * invoice, BTCPay is asked whether the invoice is Settled; if it is, the transfer moves on.
 * Anyone but the sender gets null. If BTCPay cannot be reached, the stored state is returned.
 */
export async function estadoDePagoEnvio(usuarioId: string, envioId: string): Promise<EstadoEnvio | null> {
  if (!esUuid(usuarioId) || !esUuid(envioId)) return null;
  const fila = await cargarPago(envioId);
  if (!fila || fila.remitente_id !== usuarioId) return null;
  const btc = configuracionBtcpay();
  if (!btc || fila.estado !== 'creada' || !fila.btcpay_factura_id || !fila.btcpay_tienda_id) return fila.estado;

  try {
    const factura = await leerFactura(btc.config, fila.btcpay_tienda_id, fila.btcpay_factura_id);
    if (factura.estado !== 'Settled') return fila.estado;
  } catch (error) {
    console.error('BTCPay al revisar factura:', error instanceof Error ? error.message : error);
    return fila.estado;
  }
  const cambio = await confirmarPagoBtcpay(fila.btcpay_factura_id);
  return cambio.ok ? cambio.dato.estado : fila.estado;
}

/**
 * Moves a transfer to processing once its invoice is paid. Call it only after BTCPay said Settled.
 * Repeating it changes nothing.
 */
export async function confirmarPagoBtcpay(facturaId: string): Promise<Resultado<CambioEnvio>> {
  try {
    if (!/^[A-Za-z0-9]{10,64}$/.test(facturaId)) return fallo('NO_ENCONTRADA', 'No encontramos esa factura.');
    const { data, error } = await clienteServicio().rpc('pay_confirmar_btcpay', { p_factura_id: facturaId });
    if (error) return desdeError(error);
    return exito({ id: data.id, estado: data.estado });
  } catch (error) {
    return desdeError(error);
  }
}

/** The sender confirms, or an administrator starts it, and the transfer goes on its way. */
export async function procesarEnvio(usuarioId: string, envioId: string): Promise<Resultado<CambioEnvio>> {
  try {
    if (!esUuid(usuarioId) || !esUuid(envioId)) return fallo('NO_ENCONTRADA', MENSAJE_NO_ENCONTRADA);
    const fila = await cargarCambio(envioId);
    if (!fila || !(await puedeCambiar(usuarioId, fila))) return fallo('NO_ENCONTRADA', MENSAJE_NO_ENCONTRADA);
    // With BTCPay on, the sender starts the transfer by paying its invoice, not by this button.
    if (fila.remitente_id === usuarioId && pagoLightningActivo()) {
      return fallo('NO_PERMITIDO', 'Pagá el envío con Lightning para que salga.');
    }

    const { data, error } = await clienteServicio().rpc('pay_procesar', {
      p_transferencia: envioId,
      p_actor: usuarioId,
    });
    if (error) return desdeError(error);
    return exito({ id: data.id, estado: data.estado });
  } catch (error) {
    return desdeError(error);
  }
}

/** The sender cancels a transfer that has not started moving. */
export async function cancelarEnvio(usuarioId: string, envioId: string): Promise<Resultado<CambioEnvio>> {
  try {
    if (!esUuid(usuarioId) || !esUuid(envioId)) return fallo('NO_ENCONTRADA', MENSAJE_NO_ENCONTRADA);
    const fila = await cargarCambio(envioId);
    if (!fila || !(await puedeCambiar(usuarioId, fila))) return fallo('NO_ENCONTRADA', MENSAJE_NO_ENCONTRADA);

    const { data, error } = await clienteServicio().rpc('pay_cancelar', {
      p_transferencia: envioId,
      p_actor: usuarioId,
    });
    if (error) return desdeError(error);
    return exito({ id: data.id, estado: data.estado });
  } catch (error) {
    return desdeError(error);
  }
}

/**
 * The actor the database should see for a simulator step. An administrator passes their own id.
 * The sender passes null, which the database takes as the simulator, and only in the demo.
 */
async function actorDelSimulador(
  actor: { id: string; esAdmin: boolean },
  fila: { remitente_id: string },
): Promise<Resultado<string | null>> {
  if (actor.esAdmin && (await esAdministrador(actor.id))) return exito(actor.id);
  if (fila.remitente_id !== actor.id) return fallo('NO_ENCONTRADA', MENSAJE_NO_ENCONTRADA);
  if (!esDemo()) return fallo('NO_PERMITIDO', 'Solo en la demostración se completa o se falla un envío a mano.');
  return exito(null);
}

/** Completes a transfer that is processing: an administrator, or the sender in the demo. */
export async function simularCompletar(
  actor: { id: string; esAdmin: boolean },
  envioId: string,
): Promise<Resultado<CambioEnvio>> {
  try {
    if (!esUuid(actor.id) || !esUuid(envioId)) return fallo('NO_ENCONTRADA', MENSAJE_NO_ENCONTRADA);
    const fila = await cargarCambio(envioId);
    if (!fila) return fallo('NO_ENCONTRADA', MENSAJE_NO_ENCONTRADA);
    const quien = await actorDelSimulador(actor, fila);
    if (!quien.ok) return quien;

    const { data, error } = await clienteServicio().rpc('pay_completar', {
      p_transferencia: envioId,
      p_actor: quien.dato ?? NULO,
    });
    if (error) return desdeError(error);

    await registrarEvento({
      nombre: 'envio_completado',
      sesion: sesionDelEnvio(envioId),
      usuarioId: data.remitente_id,
      ruta: `/envios/${data.codigo}`,
      objeto: data.codigo,
      valorUsdCentavos: await valorUsdDe(data.monto_origen_centavos, data.moneda_origen),
    });
    return exito({ id: data.id, estado: data.estado });
  } catch (error) {
    return desdeError(error);
  }
}

/** Fails a transfer with a reason, as the simulator does. Same people as simularCompletar. */
export async function simularFallar(
  actor: { id: string; esAdmin: boolean },
  envioId: string,
  motivo: string,
): Promise<Resultado<CambioEnvio>> {
  try {
    if (!esUuid(actor.id) || !esUuid(envioId)) return fallo('NO_ENCONTRADA', MENSAJE_NO_ENCONTRADA);
    const fila = await cargarCambio(envioId);
    if (!fila) return fallo('NO_ENCONTRADA', MENSAJE_NO_ENCONTRADA);
    const quien = await actorDelSimulador(actor, fila);
    if (!quien.ok) return quien;

    const limpio = motivo.trim();
    if (largo(limpio) < 4 || largo(limpio) > 200) {
      return fallo('DATOS_INVALIDOS', 'El motivo tiene que tener entre 4 y 200 caracteres.');
    }

    const { data, error } = await clienteServicio().rpc('pay_fallar', {
      p_transferencia: envioId,
      p_actor: quien.dato ?? NULO,
      p_motivo: limpio,
    });
    if (error) return desdeError(error);
    return exito({ id: data.id, estado: data.estado });
  } catch (error) {
    return desdeError(error);
  }
}
