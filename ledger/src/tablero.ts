import { fechaHoraSalvador } from "./tiempo.ts";
import { productoDeTicket, type Ticket } from "./ticket.ts";

// Figures for the web dashboard. Pure: the tickets and the clock come in as arguments.
// A sale counts once it has a payment (pago). Days are El Salvador days, as in cierre.ts.
// A payment counts on the day it settled (pago.momento).

export type Cifras = { tickets: number; centavos: number; sats: number };

export type FilaProducto = Cifras & { producto: string };

export type Resumen = {
  hoy: Cifras;
  // The seven El Salvador days ending today, today included.
  semana: Cifras;
  // The calendar month of today.
  mes: Cifras;
  // The current month, by product. A ticket without origin is "manual". Sorted by centavos, largest first.
  porProducto: FilaProducto[];
  // The current month, by rail.
  porRiel: { lightning: Cifras; efectivo: Cifras };
  // Thirty El Salvador days ending today, oldest first, with days without sales at 0.
  porDia: { dia: string; centavos: number }[];
};

function diaSv(ahora: Date): string {
  return fechaHoraSalvador(ahora).fecEmi;
}

function vacio(): Cifras {
  return { tickets: 0, centavos: 0, sats: 0 };
}

function sumar(c: Cifras, t: Ticket): void {
  if (t.pago === null) return;
  c.tickets += 1;
  c.centavos += t.pago.montoCentavos;
  c.sats += t.pago.rail === "lightning" ? t.pago.sats : 0;
}

// "YYYY-MM-DD" moved by n days. Works on calendar dates only, so it is not affected by the machine's zone.
export function diaDesplazado(dia: string, n: number): string {
  const [a, m, d] = dia.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

export function resumen(tickets: Ticket[], ahora: Date): Resumen {
  const hoy = diaSv(ahora);
  const inicioSemana = diaDesplazado(hoy, -6);
  const inicioDias = diaDesplazado(hoy, -29);
  const mesActual = hoy.slice(0, 7);

  const r: Resumen = {
    hoy: vacio(),
    semana: vacio(),
    mes: vacio(),
    porProducto: [],
    porRiel: { lightning: vacio(), efectivo: vacio() },
    porDia: [],
  };
  const porDia = new Map<string, number>();
  const porProducto = new Map<string, Cifras>();

  for (const t of tickets) {
    if (t.pago === null) continue;
    const dia = diaSv(new Date(t.pago.momento));
    if (dia === hoy) sumar(r.hoy, t);
    if (dia >= inicioSemana && dia <= hoy) sumar(r.semana, t);
    if (dia.slice(0, 7) === mesActual) {
      sumar(r.mes, t);
      const clave = productoDeTicket(t) ?? "manual";
      const acumulado = porProducto.get(clave) ?? vacio();
      sumar(acumulado, t);
      porProducto.set(clave, acumulado);
      sumar(t.pago.rail === "lightning" ? r.porRiel.lightning : r.porRiel.efectivo, t);
    }
    if (dia >= inicioDias && dia <= hoy) porDia.set(dia, (porDia.get(dia) ?? 0) + t.pago.montoCentavos);
  }

  r.porProducto = [...porProducto.entries()]
    .map(([producto, c]) => ({ producto, ...c }))
    .sort((a, b) => b.centavos - a.centavos || a.producto.localeCompare(b.producto));

  for (let i = -29; i <= 0; i++) {
    const dia = diaDesplazado(hoy, i);
    r.porDia.push({ dia, centavos: porDia.get(dia) ?? 0 });
  }
  return r;
}
