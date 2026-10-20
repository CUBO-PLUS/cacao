import type { AlmacenTickets } from "../almacen/tipos.ts";
import { fechaHoraSalvador } from "../tiempo.ts";
import type { Ticket } from "../ticket.ts";

// Calendar helpers for the web app. El Salvador is UTC-6 all year, so local midnight is a fixed offset.

// Safety bound for the keyset loop: 40 pages of 500 tickets.
export const MAXIMO_PAGINAS = 40;

export function esDia(texto: string | undefined): texto is string {
  return typeof texto === "string" && /^\d{4}-\d{2}-\d{2}$/.test(texto) && !Number.isNaN(new Date(`${texto}T00:00:00-06:00`).getTime());
}

export function esMes(texto: string | undefined): texto is string {
  return typeof texto === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(texto);
}

// The first instant of an El Salvador calendar day.
export function inicioDia(dia: string): Date {
  return new Date(`${dia}T00:00:00-06:00`);
}

export function hoySv(ahora: Date): string {
  return fechaHoraSalvador(ahora).fecEmi;
}

export function mesDesplazado(mes: string, n: number): string {
  const [a, m] = mes.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function primerDiaDeMes(mes: string): string {
  return `${mes}-01`;
}

export function diaSvDe(instante: string): string {
  return fechaHoraSalvador(new Date(instante)).fecEmi;
}

// Reads every ticket created in [desde, hasta) by following the keyset cursor (creado), 500 per page.
// Stops at a short page or after MAXIMO_PAGINAS pages.
export async function todosEntre(almacen: AlmacenTickets, desde: Date, hasta: Date): Promise<Ticket[]> {
  const salida: Ticket[] = [];
  let despues: string | undefined;
  for (let pagina = 0; pagina < MAXIMO_PAGINAS; pagina++) {
    const lote = await almacen.listar({ desde, hasta, limite: 500, despues });
    salida.push(...lote);
    if (lote.length < 500) break;
    despues = lote[lote.length - 1]?.creado;
    if (despues === undefined) break;
  }
  return salida;
}
