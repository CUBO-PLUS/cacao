import type { AlmacenTickets } from "../almacen/tipos.ts";
import { totalDeTicket, type Ticket } from "../ticket.ts";
import { informeMes, type DocumentoMes, type InformeMes } from "../mes.ts";
import { clasificarCierre, type InformeCierre } from "../cierre.ts";
import { fechaHoraSalvador } from "../tiempo.ts";
import { inicioDia, MAXIMO_PAGINAS, mesDesplazado, primerDiaDeMes, todosEntre } from "./tiempo-sv.ts";

// The month's books, built from the tickets in Supabase. The stored DTE files stay in the CLI's data folder,
// so a ticket counts when its state is "emitido" and it holds the document references and the seal.
// The figures are the same ones the CLI's mes command prints (documentoDesde in mes.ts reads the same totals).

const MARGEN_DIAS = 3;
const VENTANA_CIERRE_DIAS = 60;
const DIA_MS = 86_400_000;

// Document of one emitted ticket, from its lines. Mirrors documentoDesde in mes.ts.
export function documentoDeTicket(t: Ticket): DocumentoMes | null {
  if (t.estado !== "emitido" || !t.dte || t.pago === null) return null;
  const total = totalDeTicket(t);
  const fecha = fechaHoraSalvador(new Date(t.pago.momento)).fecEmi;
  const base = {
    fecha,
    numeroControl: t.dte.numeroControl,
    codigoGeneracion: t.dte.codigoGeneracion,
    selloRecepcion: t.sello?.valor ?? null,
    ticket: t.id,
  };
  if (t.dte.tipoDte === "01") {
    // 01: the price includes IVA. totalCentavos is the gross amount, the net is what is left after the IVA.
    return {
      ...base,
      tipoDte: "01",
      receptorNombre: null,
      receptorNrc: null,
      receptorNit: null,
      netoCentavos: total.totalCentavos - total.ivaCentavos,
      ivaCentavos: total.ivaCentavos,
      totalCentavos: total.totalCentavos,
    };
  }
  return {
    ...base,
    tipoDte: "03",
    receptorNombre: t.receptor?.nombre ?? "",
    receptorNrc: t.receptor?.nrc ?? "",
    receptorNit: t.receptor?.nit ?? null,
    netoCentavos: total.gravadoCentavos,
    ivaCentavos: total.ivaCentavos,
    totalCentavos: total.totalCentavos,
  };
}

// Tickets are read with a margin of days on each side: a payment at the month's edge can be created the day before.
export async function informeDelMes(almacen: AlmacenTickets, mes: string): Promise<InformeMes> {
  const desde = new Date(inicioDia(primerDiaDeMes(mes)).getTime() - MARGEN_DIAS * DIA_MS);
  const siguiente = mesDesplazado(mes, 1);
  const hasta = new Date(inicioDia(primerDiaDeMes(siguiente)).getTime() + MARGEN_DIAS * DIA_MS);
  const tickets = await todosEntre(almacen, desde, hasta);
  const documentos = tickets.map(documentoDeTicket).filter((d): d is DocumentoMes => d !== null);
  // informeMes keeps only the month's documents and the tickets of the month that hold no valid document.
  return informeMes(mes, documentos, tickets);
}

// Every ticket of one ledger, by state, following the keyset cursor (500 per page).
async function todosConEstado(almacen: AlmacenTickets, estado: string): Promise<Ticket[]> {
  const salida: Ticket[] = [];
  let despues: string | undefined;
  let despuesId: string | undefined;
  for (let pagina = 0; pagina < MAXIMO_PAGINAS; pagina++) {
    const lote = await almacen.listar({ estado, limite: 500, despues, despuesId });
    salida.push(...lote);
    if (lote.length < 500) break;
    const ultimo = lote[lote.length - 1];
    despues = ultimo?.creado;
    despuesId = ultimo?.id;
    if (despues === undefined) break;
  }
  return salida;
}

// The daily close of one El Salvador day, for the owner's page. It reads the tickets created in the 60 days before the
// day, plus every paid or rejected ticket still without a valid document, however old: those stay in the close of
// later days until they are resolved (the rule of cierre.ts). A ticket created more than 60 days before the day and
// settled on that day is not read; the CLI has no such limit.
export async function informeDelDia(almacen: AlmacenTickets, dia: string, ahora: Date): Promise<InformeCierre> {
  const desde = new Date(inicioDia(dia).getTime() - VENTANA_CIERRE_DIAS * DIA_MS);
  const hasta = new Date(inicioDia(dia).getTime() + DIA_MS);
  const [recientes, pagados, rechazados] = await Promise.all([
    todosEntre(almacen, desde, hasta),
    todosConEstado(almacen, "pagado"),
    todosConEstado(almacen, "rechazado"),
  ]);
  const porId = new Map<string, Ticket>();
  for (const t of [...recientes, ...pagados, ...rechazados]) porId.set(t.id, t);
  return clasificarCierre({ fecha: dia, ahora, tickets: [...porId.values()], atestaciones: [] });
}
