import 'server-only';

import type { EstadoPago, ProveedorCobro } from '@/app/ordenes/[id]/pagar/tipos';
import { usdCentavosASats } from '@/lib/dinero';
import type { EstadoOrden } from '@/lib/estados';
import { configDesdeEntorno, enlaceBilleteraDePrueba } from '@/lib/pagos/btcpay-api';
import { proveedorPara } from '@/lib/pagos';
import type { Cobro } from '@/lib/pagos';
import { cotizacionUsdBtc } from '@/lib/precio/fuente';

import { registrarEvento, sesionDePago, sesionDeVisita } from './eventos';
import { barrer } from './mantenimiento';
import { desdeError, exito, fallo, type Resultado } from './resultado';
import { clienteServicio } from './supabase';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esUuid = (id: string) => UUID.test(id);

const MENSAJE_NO_ENCONTRADA = 'No encontramos esa orden.';
// Spec: a payment request lives 600 seconds, then the order expires and stock returns.
const SEGUNDOS_COBRO = 600;
// The database takes NULL for these parameters, but the generated types say string.
const NULO = null as unknown as string;

type Servicio = ReturnType<typeof clienteServicio>;

const COLUMNAS_ORDEN =
  'id, numero, tipo, estado, comprador_id, negocio_id, total_sats, total_usd_centavos, cotizacion_usd_btc';
const COLUMNAS_COBRO =
  'id, orden_id, estado, proveedor, referencia_externa, bolt11, destino, verificar_url, expira_en';

// Service-role reads: the payment columns (referencia_externa, verificar_url) never reach a browser.
async function leerOrden(servicio: Servicio, ordenId: string) {
  const { data, error } = await servicio
    .from('ordenes')
    .select(COLUMNAS_ORDEN)
    .eq('id', ordenId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function leerCobro(servicio: Servicio, ordenId: string) {
  const { data, error } = await servicio
    .from('cobros')
    .select(COLUMNAS_COBRO)
    .eq('orden_id', ordenId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function leerNegocio(servicio: Servicio, negocioId: string) {
  const { data, error } = await servicio
    .from('negocios')
    .select('nombre, tipo_proveedor_pago, lightning_address, btcpay_tienda_id')
    .eq('id', negocioId)
    .single();
  if (error) throw error;
  return data;
}

type NegocioLeido = Awaited<ReturnType<typeof leerNegocio>>;

/**
 * The one place a payment is confirmed. The buyer's screen, the buyer's demo button and the seller's
 * manual confirmation all come through here, so the database call and the funnel event stay together.
 * Returns the database error, if any. Product and job payments each record their own funnel step.
 */
export async function confirmarPagoEnBD(
  ordenId: string,
  actorId: string | null,
  sesion: string | null,
): Promise<{ message: string } | null> {
  const { data, error } = await clienteServicio().rpc('confirmar_pago', {
    p_orden: ordenId,
    p_actor: actorId ?? NULO,
  });
  if (error) return error;
  const sesionPago = sesionDePago(sesion, ordenId);
  const ruta = `/ordenes/${ordenId}/pagar`;
  if (data?.tipo === 'productos') {
    await registrarEvento({
      nombre: 'pago',
      sesion: sesionPago,
      usuarioId: data.comprador_id,
      ruta,
      objeto: ordenId,
      valorUsdCentavos: data.total_usd_centavos,
    });
  } else if (data?.tipo === 'servicio') {
    await registrarEvento({
      nombre: 'pago_trabajo',
      sesion: sesionPago,
      usuarioId: data.comprador_id,
      ruta,
      objeto: ordenId,
      valorUsdCentavos: data.total_usd_centavos,
    });
  }
  return null;
}

// BTCPay settings come from the environment here, not in the lib. Null when BTCPay is not configured.
function proveedorDe(negocio: NegocioLeido) {
  return proveedorPara(
    {
      tipoProveedorPago: negocio.tipo_proveedor_pago,
      lightningAddress: negocio.lightning_address,
      btcpayTiendaId: negocio.btcpay_tienda_id,
    },
    { btcpay: configDesdeEntorno(process.env) },
  );
}

/**
 * What the payer sees in the wallet: the invoice's text and the business name, so the BTCPay ticket
 * (CacaoLedger) can say what was bought. The product id is the order id.
 */
function metadatosDeCobro(
  orden: FilaOrdenCobro,
  negocioNombre: string,
  cotizacionUsdBtc: number,
  etiqueta: 'Orden' | 'Trabajo',
) {
  return {
    orderId: orden.id,
    itemDesc: `${etiqueta} ${orden.numero} · ${negocioNombre}`,
    usdCentavos: orden.total_usd_centavos,
    cotizacionUsdBtc,
  };
}

type FilaOrdenCobro = NonNullable<Awaited<ReturnType<typeof leerOrden>>>;

/**
 * A job's request is made once the work is marked done, with the quote of that moment. It is made from
 * 'hecha' (or returned as is while live). An expired request has already sent the job back to 'hecha',
 * so a new one is made here. The order stays 'hecha' when the provider or the quote fails.
 */
async function asegurarCobroDeTrabajo(servicio: Servicio, orden: FilaOrdenCobro): Promise<Resultado<null>> {
  const ordenId = orden.id;
  const actual = await leerCobro(servicio, ordenId);
  const vigente = actual !== null && actual.estado === 'pendiente' && Date.parse(actual.expira_en) > Date.now();
  if (orden.estado === 'esperando_pago' && vigente) return exito(null);
  if (orden.estado === 'esperando_pago') {
    return fallo('ESTADO_INVALIDO', 'Se venció la solicitud de pago. Pedí una nueva desde la pantalla de pago.');
  }
  if (orden.estado !== 'hecha') {
    return fallo('ESTADO_INVALIDO', 'Este trabajo todavía no está hecho, así que no se puede pedir el pago.');
  }

  let cotizacionRaw: number;
  try {
    cotizacionRaw = await cotizacionUsdBtc();
  } catch {
    return fallo('SIN_COTIZACION', 'No pudimos obtener el precio del bitcoin. Probá de nuevo en un momento.');
  }
  // Rounded to cents, as the database stores it, so the sats sent to the provider are the sats stored.
  const cotizacion = Math.round(cotizacionRaw * 100) / 100;
  const sats = usdCentavosASats(orden.total_usd_centavos, cotizacion);

  const negocio = await leerNegocio(servicio, orden.negocio_id);
  let cobro: Cobro;
  try {
    cobro = await proveedorDe(negocio).crearCobro({
      sats,
      memo: `CacaoMarket trabajo ${orden.numero}`,
      expiraEnSeg: SEGUNDOS_COBRO,
      metadatos: metadatosDeCobro(orden, negocio.nombre, cotizacion, 'Trabajo'),
    });
  } catch (error) {
    // The job stays 'hecha': the client can ask for a new request once the provider works.
    return desdeError(error);
  }

  const { error } = await servicio.rpc('registrar_cobro_servicio', {
    p_orden: ordenId,
    p_proveedor: negocio.tipo_proveedor_pago,
    p_referencia: cobro.referencia ?? NULO,
    p_bolt11: cobro.bolt11 ?? NULO,
    p_destino: cobro.destino ?? NULO,
    p_verificar_url: cobro.verificarUrl ?? NULO,
    p_expira_en: cobro.expiraEn.toISOString(),
    p_cotizacion_btc: cotizacion,
  });
  if (error) {
    // A double tap registered a live request first: that one is the request of this job.
    if (error.message.startsWith('ESTADO_INVALIDO')) {
      const otro = await leerCobro(servicio, ordenId);
      if (otro && otro.estado === 'pendiente' && Date.parse(otro.expira_en) > Date.now()) return exito(null);
    }
    return desdeError(error);
  }
  return exito(null);
}

/**
 * Creates the payment request for an order that has none yet. A request that already exists is
 * returned untouched, so calling this twice is safe.
 */
export async function asegurarCobro(ordenId: string): Promise<Resultado<null>> {
  if (!esUuid(ordenId)) return fallo('NO_ENCONTRADA', MENSAJE_NO_ENCONTRADA);
  try {
    const servicio = clienteServicio();
    const orden = await leerOrden(servicio, ordenId);
    if (!orden) return fallo('NO_ENCONTRADA', MENSAJE_NO_ENCONTRADA);

    if (orden.tipo === 'servicio') return await asegurarCobroDeTrabajo(servicio, orden);

    if (await leerCobro(servicio, ordenId)) return exito(null);
    if (orden.estado !== 'creada') {
      return fallo('ESTADO_INVALIDO', 'Esta orden ya no está esperando pago.');
    }

    const negocio = await leerNegocio(servicio, orden.negocio_id);
    let cobro: Cobro;
    try {
      cobro = await proveedorDe(negocio).crearCobro({
        sats: orden.total_sats,
        memo: `CacaoMarket orden ${orden.numero}`,
        expiraEnSeg: SEGUNDOS_COBRO,
        metadatos: metadatosDeCobro(orden, negocio.nombre, orden.cotizacion_usd_btc, 'Orden'),
      });
    } catch (error) {
      // The order stays creada; it expires by itself and the stock comes back.
      return desdeError(error);
    }

    const { error } = await servicio.rpc('registrar_cobro', {
      p_orden: ordenId,
      p_proveedor: negocio.tipo_proveedor_pago,
      p_referencia: cobro.referencia ?? NULO,
      p_bolt11: cobro.bolt11 ?? NULO,
      p_destino: cobro.destino ?? NULO,
      p_verificar_url: cobro.verificarUrl ?? NULO,
      p_expira_en: cobro.expiraEn.toISOString(),
    });
    if (error) {
      // Another call (a double tap, or the order and the payment screen) registered first.
      if (error.message.startsWith('ESTADO_INVALIDO') && (await leerCobro(servicio, ordenId))) {
        return exito(null);
      }
      return desdeError(error);
    }
    return exito(null);
  } catch (error) {
    return desdeError(error);
  }
}

// Asks the seller's provider whether the request was paid. Errors count as "not paid yet":
// the next poll asks again.
async function consultarPago(
  negocio: NegocioLeido,
  cobro: { referencia_externa: string | null; verificar_url: string | null; expira_en: string },
): Promise<boolean> {
  try {
    const estado = await proveedorDe(negocio).consultarCobro({
      referencia: cobro.referencia_externa,
      verificarUrl: cobro.verificar_url,
      expiraEn: new Date(cobro.expira_en),
    });
    return estado === 'pagado';
  } catch (error) {
    console.error('consultarCobro:', error instanceof Error ? error.message : error);
    return false;
  }
}

/** The payment screen's view of an order. Only the buyer gets it; everyone else sees "not found". */
export async function estadoDePago(ordenId: string, usuarioId: string): Promise<Resultado<EstadoPago>> {
  if (!esUuid(ordenId)) return fallo('NO_ENCONTRADA', MENSAJE_NO_ENCONTRADA);
  try {
    // Expires stale orders first, so the screen never offers to pay a lapsed request.
    await barrer();

    const servicio = clienteServicio();
    let orden = await leerOrden(servicio, ordenId);
    if (!orden || orden.comprador_id !== usuarioId) return fallo('NO_ENCONTRADA', MENSAJE_NO_ENCONTRADA);

    const negocio = await leerNegocio(servicio, orden.negocio_id);
    let cobro = await leerCobro(servicio, ordenId);

    if (
      orden.estado === 'esperando_pago' &&
      cobro &&
      cobro.estado === 'pendiente' &&
      cobro.proveedor !== 'falso' &&
      Date.parse(cobro.expira_en) > Date.now() &&
      (await consultarPago(negocio, cobro))
    ) {
      // The database refuses a payment after expira_en (FUERA_DE_PLAZO), so a late payment
      // never marks the order paid. A concurrent poll may have confirmed first; both are fine.
      const error = await confirmarPagoEnBD(ordenId, null, await sesionDeVisita());
      if (error && !error.message.startsWith('ESTADO_INVALIDO')) {
        console.warn('confirmar_pago:', error.message);
      }
      const relectura = await leerOrden(servicio, ordenId);
      if (relectura) orden = relectura;
      cobro = await leerCobro(servicio, ordenId);
    }

    let estado: EstadoOrden = orden.estado;
    const expiraEn = cobro?.expira_en ?? null;
    if (estado === 'esperando_pago' && expiraEn !== null && Date.parse(expiraEn) <= Date.now()) {
      estado = 'expirada';
    }
    // The invoice and the address are only useful while the buyer can still pay them.
    const pagable = estado === 'esperando_pago';

    return exito({
      estado,
      tipo: orden.tipo,
      numero: orden.numero,
      totalSats: orden.total_sats,
      totalUsdCentavos: orden.total_usd_centavos,
      cotizacion: orden.cotizacion_usd_btc,
      negocioNombre: negocio.nombre,
      proveedor: (cobro?.proveedor ?? null) as ProveedorCobro | null,
      bolt11: pagable ? (cobro?.bolt11 ?? null) : null,
      destino: pagable ? (cobro?.destino ?? null) : null,
      expiraEn: pagable ? expiraEn : null,
      segundosRestantes:
        pagable && expiraEn !== null
          ? Math.max(0, Math.floor((Date.parse(expiraEn) - Date.now()) / 1000))
          : null,
    });
  } catch (error) {
    return desdeError(error);
  }
}

/**
 * The regtest test-wallet link for a BTCPay invoice, or null. Only for demo invoices (lnbcrt...) and
 * only when BTCPay is configured. Read on the server so the URL never depends on client code.
 */
export function enlaceBilleteraDePruebaDe(bolt11: string | null): string | null {
  const config = configDesdeEntorno(process.env);
  if (!config || !bolt11) return null;
  return enlaceBilleteraDePrueba(config, bolt11);
}

/** Payment screen retry: creates the missing request, then reads the order again. */
export async function reintentarCobro(ordenId: string, usuarioId: string): Promise<Resultado<EstadoPago>> {
  const previo = await estadoDePago(ordenId, usuarioId);
  if (!previo.ok || previo.dato.estado !== 'creada') return previo;
  const cobro = await asegurarCobro(ordenId);
  if (!cobro.ok) return cobro;
  return estadoDePago(ordenId, usuarioId);
}

/**
 * "Generar otra solicitud": a job whose request lapsed is back at 'hecha', and its client makes a new one.
 * Only the client gets past estadoDePago. Products keep reintentarCobro.
 */
export async function reiniciarCobro(ordenId: string, usuarioId: string): Promise<Resultado<EstadoPago>> {
  const previo = await estadoDePago(ordenId, usuarioId);
  if (!previo.ok || previo.dato.tipo !== 'servicio' || previo.dato.estado !== 'hecha') return previo;
  const cobro = await asegurarCobro(ordenId);
  if (!cobro.ok) return cobro;
  return estadoDePago(ordenId, usuarioId);
}

/** Demo only: confirms the payment of an order whose request uses the fake provider. */
export async function simularPago(ordenId: string, usuarioId: string): Promise<Resultado<null>> {
  if (!esUuid(ordenId)) return fallo('NO_ENCONTRADA', MENSAJE_NO_ENCONTRADA);
  try {
    const servicio = clienteServicio();
    const orden = await leerOrden(servicio, ordenId);
    if (!orden || orden.comprador_id !== usuarioId) return fallo('NO_ENCONTRADA', MENSAJE_NO_ENCONTRADA);

    const cobro = await leerCobro(servicio, ordenId);
    if (!cobro || cobro.proveedor !== 'falso') {
      return fallo('NO_PERMITIDO', 'Esta orden no se puede simular. Su pago es real.');
    }

    const error = await confirmarPagoEnBD(ordenId, null, await sesionDeVisita());
    if (error) return desdeError(error);
    return exito(null);
  } catch (error) {
    return desdeError(error);
  }
}
