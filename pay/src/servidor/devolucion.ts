import 'server-only';

// The sender takes back a paid Lightning transfer that nobody claimed in time. The sender pastes an invoice for
// the sats that were paid, the database reserves the transfer (pay_iniciar_devolucion), and the store's BTCPay
// wallet pays the invoice. Money moves only here; the database records the outcome. The reservation is the same
// kind as a claim's: a payout that is still unclear keeps the transfer reserved until BTCPay says how it ended, and
// a claim and a refund cannot both hold it.

import { configDePago, ESPERA_SIN_PAGO_MS, estadoDeCobro, hashDeFactura, leerFacturaDePago, MOTIVO_SIN_PAGO, type EstadoDevolucion } from './cobro';
import { consultarPago, pagarFactura, type ResultadoPago } from './btcpay-pagos';
import { desdeError, exito, fallo, type Resultado } from './resultado';
import { clienteServicio } from './supabase';
import { esPausaBtcpay, MENSAJE_PAUSA } from './url-btcpay';

export type ResultadoDevolver = {
  /** pagado: the money went back. pendiente: BTCPay has not answered yet. fallido: try again. */
  estado: 'pagado' | 'pendiente' | 'fallido';
  motivo: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The database takes a null for the optional parameters, but the generated types say string.
const NULO = null as unknown as string;
const MENSAJE_NO_ENCONTRADA = 'No encontramos esa transferencia.';
const SIN_BTCPAY = 'La devolución por Lightning no está disponible ahora. Probá más tarde.';

type FilaDevolucion = {
  id: string;
  remitente_id: string;
  cobro_token: string | null;
  cobro_estado: string | null;
  devolucion_estado: EstadoDevolucion | null;
  devolucion_factura: string | null;
  devolucion_hash: string | null;
  devolucion_intento_en: string | null;
};

// The transfer, read with the service role. Only the sender's own calls reach the fields it returns.
async function filaDeDevolucion(envioId: string): Promise<FilaDevolucion | null> {
  const { data, error } = await clienteServicio()
    .from('pay_transferencias')
    .select('id, remitente_id, cobro_token, cobro_estado, devolucion_estado, devolucion_factura, devolucion_hash, devolucion_intento_en')
    .eq('id', envioId)
    .maybeSingle();
  if (error) throw new Error(`No pudimos leer la devolución: ${error.message}`);
  return data as unknown as FilaDevolucion | null;
}

// Records how a refund ended. Only a pagado or fallido result reaches the database; pendiente waits.
async function cerrarDevolucion(envioId: string, resultado: ResultadoPago): Promise<Resultado<ResultadoDevolver>> {
  if (resultado.estado === 'pendiente') return exito({ estado: 'pendiente', motivo: null });
  const { error } = await clienteServicio().rpc('pay_terminar_devolucion', {
    p_transferencia: envioId,
    p_ok: resultado.estado === 'pagado',
    p_hash: resultado.hash ?? NULO,
    p_motivo: resultado.motivo ?? NULO,
  });
  if (error) return desdeError(error);
  return exito({ estado: resultado.estado, motivo: resultado.motivo });
}

/**
 * The sender takes the money back. Only the sender may, and the database refuses it until the claim window has
 * closed. The invoice must be for exactly the sats the sender paid. A claim that is still being paid is settled
 * first, so a refund never starts over it.
 */
export async function devolverEnvio(usuarioId: string, envioId: string, facturaCruda: string): Promise<Resultado<ResultadoDevolver>> {
  try {
    if (!UUID.test(usuarioId) || !UUID.test(envioId)) return fallo('NO_ENCONTRADA', MENSAJE_NO_ENCONTRADA);
    const leida = leerFacturaDePago(facturaCruda);
    if (!leida.ok) return leida;
    const { factura, sats, hash } = leida.dato;

    // Anyone else gets the same answer as a missing transfer.
    const fila = await filaDeDevolucion(envioId);
    if (!fila || fila.remitente_id !== usuarioId) return fallo('NO_ENCONTRADA', MENSAJE_NO_ENCONTRADA);

    // A claim that was still being paid is checked against BTCPay before the refund asks for the transfer.
    if (fila.cobro_estado === 'pagando' && fila.cobro_token) await estadoDeCobro(fila.cobro_token);

    const pago = await configDePago();
    if (!pago) return fallo('NO_DISPONIBLE', SIN_BTCPAY);

    const { error } = await clienteServicio().rpc('pay_iniciar_devolucion', {
      p_transferencia: envioId,
      p_actor: usuarioId,
      p_factura: factura,
      p_sats: sats,
      p_hash: hash,
    });
    if (error) return desdeError(error);

    let resultado: ResultadoPago;
    try {
      resultado = await pagarFactura(pago.config, pago.tienda, factura);
    } catch (e) {
      // BTCPay did not answer clearly. The money may have left, so the transfer stays reserved ("pagando") and
      // a later check settles it with BTCPay (estadoDeDevolucion). Nobody can reserve it again meanwhile.
      console.error('BTCPay al devolver:', e instanceof Error ? e.message : e);
      if (esPausaBtcpay(e)) return fallo('NO_DISPONIBLE', MENSAJE_PAUSA);
      return exito({ estado: 'pendiente', motivo: null });
    }
    return cerrarDevolucion(envioId, resultado);
  } catch (e) {
    return desdeError(e);
  }
}

/**
 * The state of a refund that is being paid. While it is "pagando", BTCPay is asked for the payment by its hash,
 * and a Complete or Failed answer closes it. A payment BTCPay does not know, after the waiting time, is failed.
 * Anything unclear leaves it "pagando". Only the sender gets an answer.
 */
export async function estadoDeDevolucion(
  usuarioId: string,
  envioId: string,
): Promise<Resultado<{ devolucion: EstadoDevolucion | null }>> {
  try {
    if (!UUID.test(usuarioId) || !UUID.test(envioId)) return fallo('NO_ENCONTRADA', MENSAJE_NO_ENCONTRADA);
    const fila = await filaDeDevolucion(envioId);
    if (!fila || fila.remitente_id !== usuarioId) return fallo('NO_ENCONTRADA', MENSAJE_NO_ENCONTRADA);
    if (fila.devolucion_estado !== 'pagando') return exito({ devolucion: fila.devolucion_estado });

    const pago = await configDePago();
    const hash = fila.devolucion_hash ?? (fila.devolucion_factura ? hashDeFactura(fila.devolucion_factura) : null);
    if (!pago || !hash) return exito({ devolucion: 'pagando' });

    let resultado: ResultadoPago | null;
    try {
      resultado = await consultarPago(pago.config, pago.tienda, hash);
    } catch (e) {
      console.error('BTCPay al revisar la devolución:', e instanceof Error ? e.message : e);
      return exito({ devolucion: 'pagando' });
    }
    if (resultado?.estado === 'pendiente') return exito({ devolucion: 'pagando' });
    if (!resultado) {
      // BTCPay does not know this payment. Only after the waiting time is it counted as failed.
      const intentoEn = fila.devolucion_intento_en;
      const esperado = intentoEn === null || Date.now() - Date.parse(intentoEn) > ESPERA_SIN_PAGO_MS;
      if (!esperado) return exito({ devolucion: 'pagando' });
      resultado = { estado: 'fallido', hash: null, motivo: MOTIVO_SIN_PAGO };
    }

    const cerrada = await cerrarDevolucion(envioId, resultado);
    if (!cerrada.ok) {
      // Another request closed it first: the state in the database is the answer.
      const ahora = await filaDeDevolucion(envioId);
      return exito({ devolucion: ahora?.devolucion_estado ?? 'pagando' });
    }
    return exito({ devolucion: resultado.estado === 'pagado' ? 'pagado' : 'fallido' });
  } catch (e) {
    return desdeError(e);
  }
}
