import type { Entrega } from '@/lib/cotizacion';
import { formatoUsd } from '@/lib/dinero';
import type { EstadoEnvio } from '@/lib/transferencias';

// Plain words and dates for the screens people read: the tracking page, the recipient's pages and
// the monitor. Every date is shown in El Salvador time.

const FORMATO_FECHA = new Intl.DateTimeFormat('es-SV', {
  timeZone: 'America/El_Salvador',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

/** "12 oct, 3:40 p. m." */
export function fechaSv(iso: string): string {
  return FORMATO_FECHA.format(new Date(iso));
}

// What the recipient needs to do, for each way the money arrives. Short, for a basic phone.
export const TEXTO_ENTREGA_DESTINATARIO: Record<Entrega, string> = {
  efectivo: 'En efectivo: llevá tu DUI al punto de pago',
  cuenta: 'A tu cuenta bancaria: no tenés que hacer nada',
  lightning: 'Por Lightning: llega a tu billetera de bitcoin',
};

/** "cerca de un minuto", "cerca de 30 minutos", "cerca de una hora". */
export function tiempoEstimado(minutos: number): string {
  if (minutos < 60) return minutos === 1 ? 'cerca de un minuto' : `cerca de ${minutos} minutos`;
  const horas = minutos / 60;
  return horas === 1 ? 'cerca de una hora' : `cerca de ${horas} horas`;
}

/** True once the state can no longer change. */
export function esEstadoFinal(estado: EstadoEnvio): boolean {
  return estado === 'completada' || estado === 'fallida' || estado === 'cancelada' || estado === 'devuelta';
}

/** The USD value of a sats amount at the given BTC price, as "$96.50", or null without a price. */
export function dolaresDeSats(sats: number, usdBtc: number | null): string | null {
  if (usdBtc === null) return null;
  // sats / 100,000,000 BTC times the USD price, kept in cents.
  return formatoUsd(Math.round((sats * usdBtc) / 1_000_000));
}

/**
 * "Mamá, te mandaron dinero" from the recipient's name. A missing name or a one-letter first word
 * falls back to "Te mandaron dinero", so the greeting never reads ", te mandaron dinero".
 */
export function saludoDestinatario(nombre: string | null | undefined): string {
  const primero = (nombre ?? '').trim().split(/\s+/)[0] ?? '';
  return Array.from(primero).length >= 2 ? `${primero}, te mandaron dinero` : 'Te mandaron dinero';
}

/** The first word of a name, or a plain fallback when there is no name. */
export function primerNombre(nombre: string | null | undefined, sinNombre = 'alguien'): string {
  return (nombre ?? '').trim().split(/\s+/)[0] || sinNombre;
}
