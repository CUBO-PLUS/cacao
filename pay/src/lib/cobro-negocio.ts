// CacaoPay para negocios: the rules a business's sale must pass, and the dates of its panel. Pure, so the browser and the
// server read the same limits. Money is in US cents everywhere here, never in floats.

import { exito, fallo, type Resultado } from '@/servidor/resultado';

/** The kinds of business. The key is stored; the label is shown. */
export const TIPOS_NEGOCIO = [
  { clave: 'cafeteria', etiqueta: 'Cafetería' },
  { clave: 'restaurante', etiqueta: 'Restaurante' },
  { clave: 'tienda', etiqueta: 'Tienda' },
  { clave: 'servicios', etiqueta: 'Servicios' },
  { clave: 'otro', etiqueta: 'Otro' },
] as const;

export type TipoNegocio = (typeof TIPOS_NEGOCIO)[number]['clave'];

export function esTipoNegocio(valor: unknown): valor is TipoNegocio {
  return TIPOS_NEGOCIO.some((t) => t.clave === valor);
}

export function etiquetaTipo(clave: string | null | undefined): string {
  return TIPOS_NEGOCIO.find((t) => t.clave === clave)?.etiqueta ?? 'Otro';
}

/**
 * A test business, made to try the flow and not a real shop: its name starts with "Prueba", in any case or accent.
 * There is no flag for it in the database, so the name is the rule. Public lists leave these out.
 */
export function esNegocioDePrueba(nombre: string): boolean {
  const sinAcentos = nombre.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim();
  return /^prueba\b/i.test(sinAcentos);
}

/** A counter sale: one US cent is the smallest amount, $10,000 the largest. Same as the payments API. */
export const COBRO_MIN_CENTAVOS = 100;
export const COBRO_MAX_CENTAVOS = 1_000_000;

/** Counter invoices stay payable for 15 minutes; the public page uses the same time. */
export const VENCE_COBRO_SEGUNDOS = 900;

/** The business name and the place: the same size limits as the database. */
export const LIMITE_NOMBRE = { min: 2, max: 80 } as const;
export const LIMITE_UBICACION = { min: 1, max: 160 } as const;

/** "12", "12.5", "12.50" or "$12.50" to US cents. Never more than two decimals. */
export function centavosDesdeTexto(texto: string): Resultado<number> {
  const limpio = texto.trim().replace(/^\$/, '').replace(/,/g, '');
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(limpio);
  if (!m) return fallo('DATOS_INVALIDOS', 'Escribí el monto en dólares, por ejemplo 3.50.');
  const centavos = Number(m[1]) * 100 + Number((m[2] ?? '0').padEnd(2, '0'));
  return validarCentavosCobro(centavos);
}

/** Checks a charge amount in US cents: whole cents, inside the limits. */
export function validarCentavosCobro(centavos: unknown): Resultado<number> {
  if (typeof centavos !== 'number' || !Number.isSafeInteger(centavos)) {
    return fallo('DATOS_INVALIDOS', 'El monto tiene que ser un número entero de centavos.');
  }
  if (centavos < COBRO_MIN_CENTAVOS) return fallo('DATOS_INVALIDOS', 'El cobro mínimo es $1.00.');
  if (centavos > COBRO_MAX_CENTAVOS) return fallo('DATOS_INVALIDOS', 'El cobro máximo es $10,000.00.');
  return exito(centavos);
}

/** Adds one typed digit to an amount in cents, as a cashier types a keypad: "35" then "0" is 350 (= $3.50). */
export function agregarDigito(centavos: number, digito: number): number {
  if (!Number.isInteger(digito) || digito < 0 || digito > 9) return centavos;
  const siguiente = centavos * 10 + digito;
  return siguiente > COBRO_MAX_CENTAVOS ? centavos : siguiente;
}

/** Dollars with two decimals and a thousands comma: 350 is "$3.50", 1000000 is "$10,000.00". */
export function formatoDolares(centavos: number): string {
  const enteros = Math.floor(Math.abs(centavos) / 100);
  const cents = String(Math.abs(centavos) % 100).padStart(2, '0');
  const con = enteros.toLocaleString('en-US');
  return `${centavos < 0 ? '-' : ''}$${con}.${cents}`;
}

export function validarNombreNegocio(valor: unknown): Resultado<string> {
  const texto = typeof valor === 'string' ? valor.trim() : '';
  if (texto.length < LIMITE_NOMBRE.min || texto.length > LIMITE_NOMBRE.max) {
    return fallo('DATOS_INVALIDOS', `El nombre del negocio tiene que tener entre ${LIMITE_NOMBRE.min} y ${LIMITE_NOMBRE.max} caracteres.`);
  }
  return exito(texto);
}

export function validarUbicacion(valor: unknown): Resultado<string> {
  const texto = typeof valor === 'string' ? valor.trim() : '';
  if (texto.length < LIMITE_UBICACION.min || texto.length > LIMITE_UBICACION.max) {
    return fallo('DATOS_INVALIDOS', 'Escribí dónde está el negocio, por ejemplo "Colonia Escalón, San Salvador".');
  }
  return exito(texto);
}

/**
 * El Salvador keeps UTC-6 all year (no daylight time). The panel's "today" and "this month" start at local midnight.
 * Returns the instant, in UTC, when the local day (or month) that contains `ahora` starts.
 */
const DESFASE_SV_MS = 6 * 60 * 60 * 1000;

export function inicioDelDiaSV(ahora: Date): Date {
  const local = new Date(ahora.getTime() - DESFASE_SV_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 6));
}

export function inicioDelMesSV(ahora: Date): Date {
  const local = new Date(ahora.getTime() - DESFASE_SV_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1, 6));
}

/** A local time for a list: "14:05", in El Salvador. */
export function horaSV(instante: Date): string {
  return new Intl.DateTimeFormat('es-SV', { timeZone: 'America/El_Salvador', hour: '2-digit', minute: '2-digit', hour12: false }).format(instante);
}

/** Words for each charge state, as the people at the counter read them. */
export const ETIQUETA_ESTADO: Record<string, string> = {
  pendiente: 'Esperando el pago',
  pagado: 'Pagado',
  vencido: 'Vencido',
  cancelado: 'Cancelado',
};

/**
 * A charge nobody paid stays "pendiente" in the database until someone tries it again. Once its time has run
 * out it reads as "vencido", so the list never shows a charge that can no longer be paid as waiting.
 */
export function estadoAMostrar(estado: string, expiraEn: string | null, ahora: Date): string {
  if (estado === 'pendiente' && expiraEn !== null && Date.parse(expiraEn) <= ahora.getTime()) return 'vencido';
  return estado;
}

/** Public address of the business's QR page. The id is a UUID, so it cannot be guessed from another business. */
export function rutaPagarNegocio(negocioId: string): string {
  return `/pagar/${negocioId}`;
}
