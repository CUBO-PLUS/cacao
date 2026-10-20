import type { Entrega, Moneda } from './cotizacion';

// Rules for a transfer that the screens show and the server checks: plain words for each state,
// what each role may do, and the formats of codes and contacts. Pure, so it runs in Client
// Components too. The database checks the same rules again.

export type EstadoEnvio = 'creada' | 'procesando' | 'completada' | 'fallida' | 'cancelada';
export type RolEnvio = 'remitente' | 'destinatario' | 'admin';
export type AccionEnvio = 'cancelar' | 'procesar' | 'completar' | 'fallar';

export const ETIQUETA_ESTADO: Record<EstadoEnvio, string> = {
  creada: 'Sin enviar',
  procesando: 'En camino',
  completada: 'Entregado',
  fallida: 'No se pudo entregar',
  cancelada: 'Cancelado',
};

const DESCRIPCION_ESTADO: Record<EstadoEnvio, Record<'remitente' | 'destinatario', string>> = {
  creada: {
    remitente: 'Recibimos tu envío. Todavía no sale.',
    destinatario: 'Alguien te va a mandar dinero. Todavía no sale.',
  },
  procesando: {
    remitente: 'El dinero va en camino.',
    destinatario: 'El dinero va en camino.',
  },
  completada: {
    remitente: 'Tu destinatario ya recibió el dinero.',
    destinatario: 'Ya recibiste el dinero.',
  },
  fallida: {
    remitente: 'No se pudo entregar el dinero. Mirá el motivo abajo.',
    destinatario: 'El dinero no llegó. Consultá con quien te lo mandó.',
  },
  cancelada: {
    remitente: 'Cancelaste el envío antes de que saliera.',
    destinatario: 'Quien envió el dinero lo canceló. No te va a llegar.',
  },
};

/** One sentence for the state, written for the person who is looking at it. */
export function descripcionDeEstado(estado: EstadoEnvio, rol: 'remitente' | 'destinatario'): string {
  return DESCRIPCION_ESTADO[estado][rol];
}

// The steps of the timeline, in order. A fallida or cancelada transfer stops on the step it reached.
export const PASOS: readonly { estado: 'creada' | 'procesando' | 'completada'; titulo: string }[] = [
  { estado: 'creada', titulo: 'Recibimos tu envío' },
  { estado: 'procesando', titulo: 'Va en camino' },
  { estado: 'completada', titulo: 'Llegó al destinatario' },
];

/** Index of the state in PASOS, or -1 for a state that is not on the timeline. */
export function indicePaso(estado: EstadoEnvio): number {
  return PASOS.findIndex((paso) => paso.estado === estado);
}

export const ETIQUETA_ENTREGA: Record<Entrega, string> = {
  lightning: 'Bitcoin por Lightning',
  efectivo: 'Efectivo en un punto de pago',
  cuenta: 'Depósito a cuenta bancaria',
};

export const ETIQUETA_MONEDA: Record<Moneda, string> = {
  USD: 'Dólares',
  EUR: 'Euros',
  SATS: 'Sats de bitcoin',
};

/**
 * True when the demo simulator is on. Next.js inlines NEXT_PUBLIC_DEMO at build time, so the
 * literal access has to stay as it is.
 */
export function esDemo(): boolean {
  return process.env.NEXT_PUBLIC_DEMO === '1';
}

/**
 * What a person may do with a transfer in this state. The sender confirms or cancels before it
 * moves. An administrator moves it and can complete or fail it. The simulator adds complete and
 * fail for the sender, but only in the demo. A recipient never acts on a transfer. A lightning
 * transfer leaves "creada" only when its invoice is paid (BTCPay), and the recipient's claim completes
 * it; so nobody starts or completes it by hand.
 */
export function accionesPosibles(
  estado: EstadoEnvio,
  rol: RolEnvio,
  entrega?: Entrega,
  /** A paid transfer, or one with a live Lightning invoice, cannot be cancelled by its sender. */
  opciones: { pagada?: boolean; facturaViva?: boolean } = {},
): AccionEnvio[] {
  if (rol === 'destinatario') return [];
  const lightning = entrega === 'lightning';
  if (rol === 'remitente') {
    if (estado === 'creada') {
      const cancelable = !opciones.pagada && !opciones.facturaViva;
      const acciones: AccionEnvio[] = lightning ? [] : ['procesar'];
      if (cancelable) acciones.push('cancelar');
      if (esDemo() && !opciones.pagada) acciones.push('fallar');
      return acciones;
    }
    if (estado === 'procesando') return esDemo() && !lightning ? ['completar', 'fallar'] : [];
    return [];
  }
  if (estado === 'creada') return lightning ? ['fallar'] : ['procesar', 'fallar'];
  if (estado === 'procesando') return lightning ? ['fallar'] : ['completar', 'fallar'];
  return [];
}

// No 0, 1, I or O: they look like the digits and letters next to them.
const PATRON_CODIGO = /^CP-[23456789A-HJ-NP-Z]{4}-[23456789A-HJ-NP-Z]{4}$/;

/**
 * Brings a typed code to its written form: "cp2345abcd" becomes "CP-2345-ABCD". Spaces and dashes
 * are optional. Anything that is not ten characters after "CP" is returned upper-cased and trimmed.
 */
export function normalizarCodigo(texto: string): string {
  const limpio = texto.toUpperCase().replace(/[\s-]/g, '');
  if (limpio.length === 10 && limpio.startsWith('CP')) {
    return `CP-${limpio.slice(2, 6)}-${limpio.slice(6)}`;
  }
  return texto.trim().toUpperCase();
}

/** True when the text is a transfer code, in any case and with or without dashes. */
export function esCodigo(texto: string): boolean {
  return PATRON_CODIGO.test(normalizarCodigo(texto));
}

export type ContactoNormalizado = { tipo: 'telefono' | 'correo'; valor: string };

/**
 * Checks what the sender typed for the recipient. A phone is eight digits of El Salvador, with or
 * without +503; it is stored as "+503 7000 0002", which is how the database matches it to a
 * registered phone. An email is stored in lower case. Returns null when neither fits.
 */
export function normalizarContacto(texto: string): ContactoNormalizado | null {
  const limpio = texto.trim();
  if (limpio.includes('@')) {
    const correo = limpio.toLowerCase();
    if (correo.length > 120 || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(correo)) return null;
    return { tipo: 'correo', valor: correo };
  }
  if (!/^\+?[\d\s()-]+$/.test(limpio)) return null;
  const digitos = limpio.replace(/\D/g, '');
  let local: string;
  if (digitos.length === 8) local = digitos;
  else if (digitos.length === 11 && digitos.startsWith('503')) local = digitos.slice(3);
  else return null;
  return { tipo: 'telefono', valor: `+503 ${local.slice(0, 4)} ${local.slice(4)}` };
}

/**
 * Hides most of a contact: "•••• ••07" for a phone, "ma•••@gmail.com" for an email. The domain
 * stays so a person can tell the address apart.
 */
export function enmascararContacto(contacto: string): string {
  const texto = contacto.trim();
  const arroba = texto.indexOf('@');
  if (arroba > 0) {
    return `${texto.slice(0, Math.min(2, arroba))}•••${texto.slice(arroba)}`;
  }
  const digitos = texto.replace(/\D/g, '');
  return `•••• ••${digitos.slice(-2)}`;
}

// Scale of the rate once it is stored: eight decimals.
const ESCALA_TASA = 100_000_000;

/**
 * The value of an amount in US cents, rounded down, for the funnel and the summaries. EUR uses the
 * rate of the day, the same way pay_resumen does.
 */
export function aUsdCentavos(monto: number, moneda: 'USD' | 'EUR', eurUsd: number): number {
  if (moneda === 'USD') return monto;
  return Number((BigInt(monto) * BigInt(Math.round(eurUsd * ESCALA_TASA))) / BigInt(ESCALA_TASA));
}
