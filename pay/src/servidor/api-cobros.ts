import 'server-only';

// The payments API (v1): the server side. Every request is authenticated with its own key and counted against that
// key's limit. A charge is created once per Idempotency-Key (pay_reservar_cobro), its invoice is made in BTCPay with
// the charge id as orderId, and its state changes only through database functions. BTCPay is asked for the state of
// a charge: a webhook or a read only says "look again". A notice is sent when a state changes; a failed notice never
// touches the charge.

import {
  claveCoincide,
  huellaCobro,
  leerBearer,
  LIMITES,
  prefijoDeClave,
  validarClaveIdempotencia,
  validarCuerpoCobro,
  type CuerpoCobro,
  type Moneda,
  type Producto,
} from '@/lib/api-cobros';
import { satsParaFactura } from '@/lib/lightning';
import { cotizacionUsdBtc } from '@/lib/precio/fuente';

import { comprobarAvisoGuardable, drenarAvisosDespues, esDesarrollo, programarAviso } from './avisos';
import {
  buscarFacturaDeCobro,
  configParaProducto,
  configPlataforma,
  crearFacturaCobro,
  invalidarFactura,
} from './api-cobros-btcpay';
import { ErrorBtcpay, leerFactura, type ConfigBtcpay, type Factura, type MetadatosCacao } from './btcpay';
import { desdeError, exito, fallo, type Resultado } from './resultado';
import { clienteServicio } from './supabase';

/** Requests per minute for one key. */
export const CUOTA_POR_MINUTO = 120;

const CLAVE_INVALIDA = 'La clave de la API no es válida o fue revocada.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_NULO = '0'.repeat(64);
const ESTADOS_BTCPAY_FINALES: readonly string[] = ['Settled', 'Expired', 'Invalid'];
const MSG_PAGADO = 'Este cobro ya está pagado: no se puede cancelar.';
const MSG_VENCIDO = 'Este cobro ya venció y no se puede cancelar.';

/** The client that made the request, as the server needs it. Never sent back to anyone. */
export type ClienteApi = {
  id: string;
  nombre: string;
  /** The product every charge of this client is labelled with. Set by the database, never by a request. */
  producto: Producto;
  tiendaPorDefecto: string;
  puedeElegirTienda: boolean;
  avisoSecreto: string;
};

/** A charge as the database has it (to_jsonb of pay_cobros). */
export type FilaCobro = {
  id: string;
  cliente_id: string;
  estado: 'pendiente' | 'pagado' | 'vencido' | 'cancelado';
  tienda_btcpay: string;
  moneda: Moneda;
  monto: number;
  sats: number;
  usd_centavos: number;
  cotizacion_usd_btc: number;
  descripcion: string;
  referencia: string;
  producto: string;
  aviso_url: string | null;
  vence_en_segundos: number;
  btcpay_factura_id: string | null;
  factura: string | null;
  expira_en: string | null;
  hash_pago: string | null;
  pagado_en: string | null;
  cancelado_en: string | null;
  pago_tardio_en: string | null;
  creado_en: string;
  actualizado_en: string;
  huella: string;
  clave_idempotencia: string;
  /** The client's datos as sent (canonical JSON text), or null. Returned to the client that made the charge only. */
  datos: string | null;
};

const ESTADO_HTTP: Record<string, number> = {
  NO_AUTORIZADO: 401,
  LIMITE: 429,
  DATOS_INVALIDOS: 400,
  NO_PERMITIDO: 403,
  NO_ENCONTRADA: 404,
  IDEMPOTENCIA_CONFLICTO: 409,
  IDEMPOTENCIA_EN_CURSO: 409,
  ESTADO_INVALIDO: 409,
  NO_DISPONIBLE: 503,
  SIN_COTIZACION: 503,
  BTCPAY: 502,
};

/** The HTTP answer for a failed result. The body names the code and gives the Spanish sentence. */
export function respuestaDeError(resultado: { codigo: string; mensaje: string }): Response {
  const estado = ESTADO_HTTP[resultado.codigo] ?? 500;
  const cabeceras: Record<string, string> = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  if (estado === 401) cabeceras['www-authenticate'] = 'Bearer';
  if (estado === 429) cabeceras['retry-after'] = '60';
  return new Response(JSON.stringify({ error: { codigo: resultado.codigo, mensaje: resultado.mensaje } }), {
    status: estado,
    headers: cabeceras,
  });
}

export function respuestaJson(estado: number, cuerpo: unknown, cabeceras: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cabeceras },
  });
}

// The database takes a null for an optional text parameter, but the generated types say string.
const NULO_TEXTO = null as unknown as string;

/**
 * Finds the client of a key and checks it: the key's prefix finds the row, then the whole key is compared with the
 * stored hash, in constant time. A revoked key is refused like an unknown one.
 */
export async function autenticar(cabecera: string | null): Promise<Resultado<ClienteApi>> {
  const clave = leerBearer(cabecera);
  if (!clave) return fallo('NO_AUTORIZADO', 'Falta la clave de la API: enviá "Authorization: Bearer cp_...".');

  const { data, error } = await clienteServicio()
    .from('pay_api_clientes')
    .select('id, nombre, producto, tienda_btcpay, puede_elegir_tienda, aviso_secreto, clave_hash, revocado_en')
    .eq('prefijo', prefijoDeClave(clave))
    .maybeSingle();
  if (error) return desdeError(error);

  const coincide = claveCoincide(clave, data?.clave_hash ?? HASH_NULO);
  if (!data || !coincide || data.revocado_en !== null) return fallo('NO_AUTORIZADO', CLAVE_INVALIDA);
  return exito({
    id: data.id,
    nombre: data.nombre,
    producto: data.producto as Producto,
    tiendaPorDefecto: data.tienda_btcpay,
    puedeElegirTienda: data.puede_elegir_tienda,
    avisoSecreto: data.aviso_secreto,
  });
}

/** Authenticates a request and counts it against the key's limit. */
export async function entrar(cabecera: string | null): Promise<Resultado<ClienteApi>> {
  const cliente = await autenticar(cabecera);
  if (!cliente.ok) return cliente;
  const { data, error } = await clienteServicio().rpc('pay_api_cuota', {
    p_cliente: cliente.dato.id,
    p_maximo: CUOTA_POR_MINUTO,
  });
  if (error) return desdeError(error);
  if (data !== true) return fallo('LIMITE', 'Demasiadas peticiones con esta clave. Probá de nuevo en un minuto.');
  drenarAvisosDespues();
  return cliente;
}

/** The public view of a charge: what a client may read. */
export function vistaCobro(cobro: FilaCobro, config: ConfigBtcpay | null) {
  return {
    id: cobro.id,
    estado: cobro.estado,
    factura: cobro.factura,
    sats: cobro.sats,
    usd_centavos: cobro.usd_centavos,
    expira_en: cobro.expira_en,
    enlace_pago: config && cobro.btcpay_factura_id ? `${config.url}/i/${cobro.btcpay_factura_id}` : null,
    pago_tardio: cobro.pago_tardio_en !== null,
    // The client's own datos, as it sent them. Only this view carries them: notices and BTCPay never do.
    datos: cobro.datos === null ? null : (JSON.parse(cobro.datos) as Record<string, unknown>),
  };
}

function metadatosDe(cobro: FilaCobro, cuerpo: CuerpoCobro, usdBtc: number): MetadatosCacao {
  return {
    producto: cobro.producto as MetadatosCacao['producto'],
    orderId: cuerpo.referencia,
    itemDesc: cuerpo.descripcion.slice(0, 200),
    usdCentavos: cobro.usd_centavos,
    cotizacionUsdBtc: usdBtc,
  };
}

async function liberarReserva(id: string): Promise<void> {
  const { error } = await clienteServicio().rpc('pay_liberar_reserva', { p_id: id });
  if (error) console.error('No pudimos liberar la reserva del cobro:', error.message);
}

/**
 * Creates a charge, once per Idempotency-Key. The store is the client's default, or another one the client may
 * charge. The sats and the US cents are computed here, from the BTC price now, and stored. The invoice is made after
 * the reservation: a refusal from BTCPay releases the reservation, and any other failure keeps it, so a retry finds
 * the invoice instead of making another.
 */
export async function crearCobro(
  cliente: ClienteApi,
  cabeceraClave: string | null,
  cuerpoCrudo: string,
): Promise<Resultado<{ cobro: FilaCobro; config: ConfigBtcpay; repetido: boolean }>> {
  if (Buffer.byteLength(cuerpoCrudo, 'utf8') > LIMITES.cuerpoMaxBytes) {
    return fallo('DATOS_INVALIDOS', 'El cuerpo es demasiado grande.');
  }
  let json: unknown;
  try {
    json = JSON.parse(cuerpoCrudo);
  } catch {
    return fallo('DATOS_INVALIDOS', 'El cuerpo no es JSON válido.');
  }
  const clave = validarClaveIdempotencia(cabeceraClave);
  if (!clave.ok) return clave;
  const entrada = validarCuerpoCobro(json, { desarrollo: esDesarrollo() });
  if (!entrada.ok) return entrada;
  const cuerpo = entrada.dato;
  if (cuerpo.aviso_url) {
    const direccion = await comprobarAvisoGuardable(cuerpo.aviso_url, { desarrollo: esDesarrollo() });
    if (!direccion.ok) return direccion;
  }

  const tienda = cuerpo.tienda ?? cliente.tiendaPorDefecto;
  if (tienda !== cliente.tiendaPorDefecto && !cliente.puedeElegirTienda) {
    return fallo('NO_PERMITIDO', 'Esta clave no puede cobrar en esa tienda.');
  }

  const config = await configParaProducto(cliente.producto);
  if (!config) return fallo('NO_DISPONIBLE', 'El cobro por Lightning no está disponible ahora. Probá más tarde.');

  let usdBtc: number;
  try {
    usdBtc = await cotizacionUsdBtc();
  } catch {
    return fallo('SIN_COTIZACION', 'No pudimos consultar el precio del bitcoin. Probá de nuevo en un momento.');
  }

  let usdCentavos: number;
  let sats: number;
  try {
    if (cuerpo.moneda === 'USD') {
      usdCentavos = cuerpo.monto;
      sats = satsParaFactura(usdCentavos, usdBtc);
    } else {
      sats = cuerpo.monto;
      usdCentavos = Math.max(1, Math.round((sats * usdBtc) / 1_000_000));
    }
  } catch {
    return fallo('DATOS_INVALIDOS', 'El monto no se puede cotizar en sats.');
  }

  const reserva = await clienteServicio().rpc('pay_reservar_cobro', {
    p_cliente: cliente.id,
    p_clave: clave.dato,
    p_huella: huellaCobro(cuerpo, tienda),
    p_tienda: tienda,
    p_moneda: cuerpo.moneda,
    p_monto: cuerpo.monto,
    p_sats: sats,
    p_usd_centavos: usdCentavos,
    p_cotizacion: usdBtc,
    p_descripcion: cuerpo.descripcion,
    p_referencia: cuerpo.referencia,
    p_aviso_url: cuerpo.aviso_url ?? NULO_TEXTO,
    p_vence_en_segundos: cuerpo.vence_en_segundos,
    p_datos: cuerpo.datos ?? NULO_TEXTO,
  });
  if (reserva.error) return desdeError(reserva.error);

  const { situacion, cobro: crudo } = reserva.data as unknown as { situacion: string; cobro: unknown };
  const cobro = crudo as FilaCobro;
  if (situacion === 'existente') return exito({ cobro, config, repetido: true });

  try {
    const existente = situacion === 'retomar' ? await buscarFacturaDeCobro(config, cobro.tienda_btcpay, cobro.id) : null;
    const factura: Factura = existente
      ? await leerFactura(config, cobro.tienda_btcpay, existente)
      : await crearFacturaCobro(config, {
          storeId: cobro.tienda_btcpay,
          cobroId: cobro.id,
          sats: cobro.sats,
          minutos: Math.max(1, Math.ceil(cobro.vence_en_segundos / 60)),
          metadata: metadatosDe(cobro, cuerpo, usdBtc),
        });
    if (!factura.bolt11) {
      await liberarReserva(cobro.id);
      return fallo('NO_DISPONIBLE', 'La tienda no tiene Lightning activado.');
    }
    const registro = await clienteServicio().rpc('pay_registrar_factura_cobro', {
      p_id: cobro.id,
      p_factura_id: factura.id,
      p_factura: factura.bolt11,
      p_expira: factura.expiraEn.toISOString(),
    });
    if (registro.error) return desdeError(registro.error);
    return exito({ cobro: registro.data as unknown as FilaCobro, config, repetido: false });
  } catch (error) {
    if (error instanceof ErrorBtcpay && error.estado >= 400 && error.estado < 500) {
      // BTCPay refused: no invoice exists, so the reservation is dropped and the same key may try again.
      await liberarReserva(cobro.id);
      console.error('BTCPay refusó la factura del cobro:', error.message);
      return fallo('BTCPAY', 'BTCPay no aceptó la factura. Revisá la tienda y probá de nuevo.');
    }
    // Unknown outcome (no answer, or a server error): the reservation stays, and a retry finds the invoice.
    console.error('BTCPay al crear la factura del cobro:', error instanceof Error ? error.message : error);
    return fallo('NO_DISPONIBLE', 'No pudimos crear la factura ahora. Repetí la misma petición en un minuto.');
  }
}

/** A charge of this client, or null. Only the client that created it can read it. */
export async function cobroDeCliente(clienteId: string, id: string): Promise<FilaCobro | null> {
  if (!UUID.test(id)) return null;
  const { data, error } = await clienteServicio().rpc('pay_leer_cobro', { p_cliente: clienteId, p_id: id });
  if (error) throw new Error(`No pudimos leer el cobro: ${error.message}`);
  return data === null ? null : (data as unknown as FilaCobro);
}

/**
 * Applies a state BTCPay reported for a charge. The database decides, under a row lock. Returns the charge as it now
 * is. When the state changed, its notice is sent in the background.
 */
async function aplicarEstadoBtcpay(factura: Factura): Promise<FilaCobro> {
  const hash = factura.paymentHash && /^[0-9a-f]{64}$/i.test(factura.paymentHash) ? factura.paymentHash.toLowerCase() : null;
  const { data, error } = await clienteServicio().rpc('pay_aplicar_btcpay', {
    p_factura_id: factura.id,
    p_estado: factura.estado,
    p_hash: hash ?? NULO_TEXTO,
  });
  if (error) throw new Error(`No pudimos aplicar el estado de BTCPay: ${error.message}`);
  const { cambio, cobro, aviso_id, aviso_ledger_id } = data as unknown as {
    cambio: boolean;
    cobro: FilaCobro;
    aviso_id: string | null;
    aviso_ledger_id: string | null;
  };
  // The client's notice and, for a paid business charge, the notice to CacaoLedger. Each is sent now, or by the queue.
  if (cambio) {
    for (const id of [aviso_id, aviso_ledger_id]) if (id) programarAviso(id);
  }
  return cobro;
}

/**
 * Asks BTCPay for a charge's invoice and applies what it says. A paid charge is not asked again. A cancelled or
 * expired charge is only changed by a payment BTCPay settles afterwards (a late payment). Throws when BTCPay cannot
 * be read, so the caller decides what to answer.
 */
async function sincronizarCobro(cobro: FilaCobro, config: ConfigBtcpay): Promise<FilaCobro> {
  if (cobro.estado === 'pagado' || !cobro.btcpay_factura_id) return cobro;
  if (cobro.estado === 'cancelado' && cobro.pago_tardio_en !== null) return cobro;
  const factura = await leerFactura(config, cobro.tienda_btcpay, cobro.btcpay_factura_id);
  if (cobro.estado !== 'pendiente' && factura.estado !== 'Settled') return cobro;
  if (!ESTADOS_BTCPAY_FINALES.includes(factura.estado)) return cobro;
  return aplicarEstadoBtcpay(factura);
}

/** Reads a charge, asks BTCPay for its live state, and answers. If BTCPay cannot be read, the stored state is returned. */
export async function leerCobro(
  cliente: ClienteApi,
  id: string,
): Promise<Resultado<{ cobro: FilaCobro; config: ConfigBtcpay | null }>> {
  const cobro = await cobroDeCliente(cliente.id, id);
  if (!cobro) return fallo('NO_ENCONTRADA', 'No encontramos ese cobro.');
  const config = await configParaProducto(cobro.producto);
  if (!config) return exito({ cobro, config: null });
  try {
    return exito({ cobro: await sincronizarCobro(cobro, config), config });
  } catch (error) {
    console.error('BTCPay al leer el cobro:', error instanceof Error ? error.message : error);
    return exito({ cobro, config });
  }
}

/**
 * Cancels a pending charge. BTCPay is told first, the invoice is read again, and only then is the charge cancelled
 * in the database. If the invoice was settled or expired meanwhile, its state is applied and the cancel is refused.
 * The database refuses a cancel of a paid charge too, so a payment that lands in between is never lost.
 */
export async function cancelarCobro(
  cliente: ClienteApi,
  id: string,
): Promise<Resultado<{ cobro: FilaCobro; config: ConfigBtcpay }>> {
  const cobro = await cobroDeCliente(cliente.id, id);
  if (!cobro) return fallo('NO_ENCONTRADA', 'No encontramos ese cobro.');
  if (cobro.estado === 'pagado') return fallo('ESTADO_INVALIDO', MSG_PAGADO);
  if (cobro.estado !== 'pendiente' && cobro.estado !== 'cancelado') return fallo('ESTADO_INVALIDO', MSG_VENCIDO);

  const config = await configParaProducto(cobro.producto);
  if (!config) return fallo('NO_DISPONIBLE', 'No pudimos cancelar el cobro ahora. Probá más tarde.');
  if (cobro.estado === 'cancelado') return exito({ cobro, config });
  if (!cobro.btcpay_factura_id) return fallo('NO_DISPONIBLE', 'No pudimos cancelar el cobro ahora. Probá más tarde.');

  const tienda = cobro.tienda_btcpay;
  const facturaId = cobro.btcpay_factura_id;
  const noSePudo = fallo('NO_DISPONIBLE', 'No pudimos cancelar el cobro ahora en BTCPay. Probá de nuevo en un momento.');
  const cerrado = (estado: string) => fallo('ESTADO_INVALIDO', estado === 'Settled' ? MSG_PAGADO : MSG_VENCIDO);

  try {
    const antes = await leerFactura(config, tienda, facturaId);
    if (antes.estado === 'Settled' || antes.estado === 'Expired') {
      await aplicarEstadoBtcpay(antes);
      return cerrado(antes.estado);
    }
    await invalidarFactura(config, tienda, facturaId);
    const despues = await leerFactura(config, tienda, facturaId);
    if (despues.estado === 'Settled' || despues.estado === 'Expired') {
      await aplicarEstadoBtcpay(despues);
      return cerrado(despues.estado);
    }
    if (despues.estado !== 'Invalid') return noSePudo;
  } catch (error) {
    console.error('BTCPay al cancelar el cobro:', error instanceof Error ? error.message : error);
    return noSePudo;
  }

  const { data, error } = await clienteServicio().rpc('pay_cancelar_cobro', { p_cliente: cliente.id, p_id: id });
  if (error) return desdeError(error);
  const { cambio, cobro: nuevo, aviso_id } = data as unknown as { cambio: boolean; cobro: FilaCobro; aviso_id: string | null };
  if (cambio && aviso_id) programarAviso(aviso_id);
  return exito({ cobro: nuevo, config });
}

/**
 * BTCPay called the webhook for an invoice. The body is not trusted: the invoice is read again and the state BTCPay
 * gives is applied. "ignorado": the invoice is not a charge of this store. "reintentar": BTCPay could not be read.
 */
export async function aplicarAvisoBtcpay(facturaId: string, tiendaId: string): Promise<'aplicado' | 'ignorado' | 'reintentar'> {
  const { data, error } = await clienteServicio()
    .from('pay_cobros')
    .select('id')
    .eq('btcpay_factura_id', facturaId)
    .eq('tienda_btcpay', tiendaId)
    .maybeSingle();
  if (error) throw new Error(`No pudimos leer el cobro: ${error.message}`);
  if (!data) return 'ignorado';

  const config = await configPlataforma();
  if (!config) return 'reintentar';
  try {
    const factura = await leerFactura(config, tiendaId, facturaId);
    if (!ESTADOS_BTCPAY_FINALES.includes(factura.estado)) return 'ignorado';
    await aplicarEstadoBtcpay(factura);
    return 'aplicado';
  } catch (error) {
    if (error instanceof ErrorBtcpay && error.estado === 404) return 'ignorado';
    console.error('BTCPay al leer la factura del aviso:', error instanceof Error ? error.message : error);
    return 'reintentar';
  }
}
