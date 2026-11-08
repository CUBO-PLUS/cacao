import { ivaSobreNeto } from "./dinero.ts";
import { fechaHoraSalvador } from "./tiempo.ts";

// The monthly plan a business pays for Ledger, with charging through CacaoPay included. Pure rules only: prices,
// the month in El Salvador time, and the 7-day grace period. Reading and writing them lives in servidor/planes.ts.
//
// The rule behind the grace period: a business must never be left unable to issue a DTE in the middle of the month,
// because a sale without its document is the very infraction Ledger exists to prevent. So a missed payment gives
// seven days; only after that are new hand-entered sales paused. Sales charged through CacaoPay keep getting their
// document, and the books always stay readable.

export const PLANES = {
  semilla: {
    nombre: "Comercio Semilla",
    netoCentavos: 900,
    para: "Un comercio con una caja",
    incluye: ["Hasta 300 DTE al mes", "Cierre del día y atestación de tasa", "Libros de IVA y cifras de F-07 y F-14", "Cobrar con CacaoPay sin comisión por venta"],
  },
  cosecha: {
    nombre: "Comercio Cosecha",
    netoCentavos: 2400,
    para: "Un comercio con varias cajas",
    incluye: ["Hasta 2,500 DTE al mes", "Varios puntos de venta", "Importación automática de CacaoMarket", "Exportación para el contador"],
  },
  despacho: {
    nombre: "Despacho Contable",
    netoCentavos: 6500,
    para: "Un contador con varios clientes",
    incluye: ["Hasta 15 comercios", "Una consola para todos", "Libros y cifras por comercio", "Todo lo de Cosecha"],
  },
} as const;

export type IdPlan = keyof typeof PLANES;

export const DIAS_DE_GRACIA = 7;

export function esPlan(valor: unknown): valor is IdPlan {
  return typeof valor === "string" && Object.prototype.hasOwnProperty.call(PLANES, valor);
}

/** What the business pays each month: the plan price plus 13 % IVA, in cents. */
export function totalConIva(plan: IdPlan): { neto: number; iva: number; total: number } {
  const neto = PLANES[plan].netoCentavos;
  const iva = ivaSobreNeto(neto);
  return { neto, iva, total: neto + iva };
}

/** The month a moment belongs to, in El Salvador time: "2026-11". */
export function periodoDe(ahora: Date): string {
  return fechaHoraSalvador(ahora).fecEmi.slice(0, 7);
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** "2026-11" as people say it: "noviembre de 2026". */
export function nombrePeriodo(periodo: string): string {
  const [anio, mes] = periodo.split("-");
  return `${MESES[Number(mes) - 1] ?? mes} de ${anio}`;
}

/** The last moment of the grace period of a month: the end of day 7, El Salvador time (UTC-6 all year). */
export function finDeGracia(periodo: string): Date {
  return new Date(`${periodo}-${String(DIAS_DE_GRACIA + 1).padStart(2, "0")}T00:00:00-06:00`);
}

export type EstadoPlan =
  | { tipo: "sin_plan" }
  | { tipo: "al_dia"; plan: IdPlan }
  | { tipo: "en_gracia"; plan: IdPlan; diasRestantes: number; hasta: Date }
  | { tipo: "suspendido"; plan: IdPlan };

/**
 * The state of a business this month. Without a plan the account is in its free trial and nothing is blocked.
 * With a plan: paid this month is up to date; unpaid is in grace until the end of day 7; after that, suspended.
 * A plan chosen after the grace period of the current month starts with its own seven days from that moment.
 */
export function estadoDelPlan(entrada: { plan: IdPlan | null; elegidoEn: Date | null; pagadoEstePeriodo: boolean; ahora: Date }): EstadoPlan {
  const { plan, elegidoEn, pagadoEstePeriodo, ahora } = entrada;
  if (plan === null) return { tipo: "sin_plan" };
  if (pagadoEstePeriodo) return { tipo: "al_dia", plan };
  const finDelMes = finDeGracia(periodoDe(ahora));
  const desdeEleccion = elegidoEn === null ? null : new Date(elegidoEn.getTime() + DIAS_DE_GRACIA * 86_400_000);
  const hasta = desdeEleccion !== null && desdeEleccion > finDelMes ? desdeEleccion : finDelMes;
  if (ahora < hasta) {
    const diasRestantes = Math.max(1, Math.ceil((hasta.getTime() - ahora.getTime()) / 86_400_000));
    return { tipo: "en_gracia", plan, diasRestantes, hasta };
  }
  return { tipo: "suspendido", plan };
}

/** True when the business may issue new documents. Only a suspended plan stops it. */
export function puedeEmitir(estado: EstadoPlan): boolean {
  return estado.tipo !== "suspendido";
}

export const MENSAJE_SUSPENDIDO =
  "La cuota de este mes no está pagada y pasaron los 7 días de gracia. Pagala en Plan para volver a registrar ventas a mano. Las ventas cobradas por CacaoPay siguen recibiendo su documento, y tus libros siguen disponibles.";
