import type { Atestacion } from "./atestacion.ts";
import { formatoSats, formatoUsd } from "./dinero.ts";
import { fechaHoraSalvador } from "./tiempo.ts";
import { totalDeTicket, type Ticket } from "./ticket.ts";

// Daily close. It is an operational control, not a filing: nothing is owed each day, but
// a rejected document must be sent again within 24 hours, and nothing warns the merchant
// when that time runs out. Rules for each group are in the README.

export const PLAZO_HORAS = 24;
const MS_HORA = 3_600_000;

export type Grupo = "emitidos" | "huerfanos" | "plazo" | "abiertos";
export const GRUPOS: readonly Grupo[] = ["emitidos", "huerfanos", "plazo", "abiertos"];

export interface FilaCierre {
  ticket: string;
  cliente: string;
  estado: string;
  rail: "lightning" | "efectivo" | "sin cobro";
  usdCentavos: number;
  sats: number | null;
  // Date the ticket belongs to in this close (YYYY-MM-DD, El Salvador).
  fecha: string;
  motivo: string;
  // Only for rejected documents: minutes left of the 24-hour fuse, negative when expired.
  minutosRestantes?: number;
  vencido?: boolean;
  numeroControl?: string | null;
  selloSimulado?: string | null;
}

export interface TotalesGrupo {
  cantidad: number;
  usdCentavos: number;
  porRail: Record<"lightning" | "efectivo" | "sin cobro", { cantidad: number; usdCentavos: number; sats: number }>;
}

export interface InformeCierre {
  fecha: string;
  grupos: Record<Grupo, FilaCierre[]>;
  totales: Record<Grupo, TotalesGrupo>;
  pendientes: number;
  todosConSello: boolean;
  respuesta: string;
}

export interface EntradaCierre {
  fecha: string; // YYYY-MM-DD
  ahora: Date;
  tickets: Ticket[];
  atestaciones: Atestacion[];
}

function diaDe(iso: string): string {
  return fechaHoraSalvador(new Date(iso)).fecEmi;
}

function sumaVacia(): TotalesGrupo {
  return {
    cantidad: 0,
    usdCentavos: 0,
    porRail: {
      lightning: { cantidad: 0, usdCentavos: 0, sats: 0 },
      efectivo: { cantidad: 0, usdCentavos: 0, sats: 0 },
      "sin cobro": { cantidad: 0, usdCentavos: 0, sats: 0 },
    },
  };
}

// A ticket belongs to the close when one of its events fell on the day: created, paid,
// sealed or rejected. Money received and still without a valid document also stays in the
// close of later days until it is resolved, so an old orphan cannot disappear.
function perteneceAlDia(t: Ticket, fecha: string): boolean {
  if (diaDe(t.creado) === fecha) return true;
  if (t.pago && diaDe(t.pago.momento) === fecha) return true;
  if (t.rechazo && diaDe(t.rechazo.momento) === fecha) return true;
  if (t.sello && diaDe(t.sello.momento) === fecha) return true;
  const sinResolver = t.estado === "pagado" || t.estado === "rechazado";
  const inicio = t.pago ? diaDe(t.pago.momento) : diaDe(t.creado);
  return sinResolver && inicio <= fecha;
}

// Why a paid ticket is still an orphan. A Lightning orphan has no attestation yet, because
// the attestation is written when the document is built; its sats come from the payment.
function motivoHuerfano(t: Ticket): string {
  if (t.dte) return "documento construido, sin transmitir";
  if (t.pago?.rail === "lightning") {
    return "sin documento: nunca se construyó, así que aún no hay atestación; los sats son del pago";
  }
  return "sin documento: nunca se construyó";
}

function minutosHasta(ahora: Date, desde: string): number {
  return Math.floor((new Date(desde).getTime() + PLAZO_HORAS * MS_HORA - ahora.getTime()) / 60_000);
}

export function clasificarCierre(entrada: EntradaCierre): InformeCierre {
  const { fecha, ahora } = entrada;
  const satsPorTicket = new Map<string, number>();
  for (const a of entrada.atestaciones) satsPorTicket.set(a.ticket, a.sats);

  const grupos: Record<Grupo, FilaCierre[]> = { emitidos: [], huerfanos: [], plazo: [], abiertos: [] };

  for (const t of entrada.tickets) {
    if (!perteneceAlDia(t, fecha)) continue;
    const rail: FilaCierre["rail"] = t.pago ? t.pago.rail : "sin cobro";
    const sats = t.pago?.rail === "lightning" ? (satsPorTicket.get(t.id) ?? t.pago.sats) : null;
    const base = {
      ticket: t.id,
      cliente: t.cliente,
      estado: t.estado,
      rail,
      // An open ticket has no payment yet: its total is shown so the group has a value.
      usdCentavos: t.pago ? t.pago.montoCentavos : totalDeTicket(t).totalCentavos,
      sats,
      fecha: t.pago ? diaDe(t.pago.momento) : diaDe(t.creado),
      numeroControl: t.dte?.numeroControl ?? null,
      selloSimulado: t.sello?.valor ?? null,
    };
    if (t.estado === "emitido") {
      grupos.emitidos.push({ ...base, motivo: "sello simulado recibido" });
    } else if (t.estado === "pagado" && t.contingencia && t.dte && !t.contingencia.transmitida) {
      // Issued in the simulated outage: it waits for the reception and has the same 24-hour fuse as a rejection.
      const minutos = minutosHasta(ahora, t.contingencia.desde);
      grupos.plazo.push({
        ...base,
        motivo: "contingencia simulada: transmitir antes de 24 horas",
        minutosRestantes: minutos,
        vencido: minutos <= 0,
      });
    } else if (t.estado === "pagado") {
      grupos.huerfanos.push({
        ...base,
        motivo: motivoHuerfano(t),
      });
    } else if (t.estado === "rechazado") {
      const minutos = t.rechazo ? minutosHasta(ahora, t.rechazo.momento) : 0;
      const primera = t.rechazo?.observaciones[0] ?? "rechazado";
      grupos.plazo.push({
        ...base,
        motivo: `rechazado: ${primera}`,
        minutosRestantes: minutos,
        vencido: minutos <= 0,
      });
    } else {
      grupos.abiertos.push({ ...base, motivo: "creado, sin pago" });
    }
  }

  grupos.plazo.sort((a, b) => (a.minutosRestantes ?? 0) - (b.minutosRestantes ?? 0));
  grupos.huerfanos.sort((a, b) => a.ticket.localeCompare(b.ticket));
  grupos.emitidos.sort((a, b) => a.ticket.localeCompare(b.ticket));
  grupos.abiertos.sort((a, b) => a.ticket.localeCompare(b.ticket));

  const totales = { emitidos: sumaVacia(), huerfanos: sumaVacia(), plazo: sumaVacia(), abiertos: sumaVacia() } as Record<Grupo, TotalesGrupo>;
  for (const g of GRUPOS) {
    for (const f of grupos[g]) {
      const T = totales[g];
      T.cantidad += 1;
      T.usdCentavos += f.usdCentavos;
      const celda = T.porRail[f.rail];
      celda.cantidad += 1;
      celda.usdCentavos += f.usdCentavos;
      celda.sats += f.sats ?? 0;
    }
  }

  const pendientes = grupos.huerfanos.length + grupos.plazo.length;
  const todosConSello = pendientes === 0;
  const respuesta = todosConSello
    ? "¿Todos los cobros de hoy tienen su sello? Sí."
    : `¿Todos los cobros de hoy tienen su sello? No: ${pendientes} cobros sin documento válido.`;
  return { fecha, grupos, totales, pendientes, todosConSello, respuesta };
}

// Whole hours, or minutes under one hour. Rounds down: "quedan 18 h" means 18 full hours or more.
function duracion(minutos: number): string {
  const abs = Math.abs(minutos);
  if (abs >= 60) return `${Math.floor(abs / 60)} h`;
  return `${abs} min`;
}

export function montoFila(f: FilaCierre): string {
  if (f.rail === "sin cobro") return `${formatoUsd(f.usdCentavos)} sin pagar`;
  const usd = formatoUsd(f.usdCentavos);
  return f.rail === "lightning" && f.sats !== null ? `${usd} (${formatoSats(f.sats)}) Lightning` : `${usd} efectivo`;
}

// The time left on a rejected document, or null for the other groups.
export function textoPlazo(f: FilaCierre): string | null {
  if (f.minutosRestantes === undefined) return null;
  return f.vencido ? `plazo vencido hace ${duracion(f.minutosRestantes)}` : `quedan ${duracion(f.minutosRestantes)}`;
}

export const ETIQUETAS: Record<Grupo, string> = {
  emitidos: "Emitidos (con sello simulado)",
  huerfanos: "Pagados sin documento válido (huérfanos)",
  plazo: "Con plazo de 24 horas corriendo",
  abiertos: "Abiertos (creados, sin pagar)",
};

export function lineasCierre(informe: InformeCierre): string[] {
  const lineas: string[] = [`Cierre del ${informe.fecha} (hora de El Salvador)`, ""];
  for (const g of GRUPOS) {
    const t = informe.totales[g];
    lineas.push(`${ETIQUETAS[g]}: ${t.cantidad}  ${t.cantidad > 0 ? formatoUsd(t.usdCentavos) : ""}`.trimEnd());
    for (const f of informe.grupos[g]) {
      // The time left goes first on a rejected line, where it is easiest to miss.
      const plazo = textoPlazo(f);
      if (plazo !== null) {
        lineas.push(`  ${plazo}  ${f.ticket}  ${f.fecha}  ${montoFila(f)}  ${f.motivo}`);
      } else {
        lineas.push(`  ${f.ticket}  ${f.fecha}  ${montoFila(f)}  ${f.motivo}`);
      }
    }
  }
  lineas.push("");
  lineas.push(informe.respuesta);
  return lineas;
}

export const AYUDA_CIERRE = `Uso: ledger cierre [YYYY-MM-DD] [--json]

Muestra, para un día (hoy por defecto, hora de El Salvador), cada ticket en un solo grupo:
emitidos, pagados sin documento válido (huérfanos), con plazo de 24 horas corriendo y abiertos.
Termina con una sola pregunta y sale con código 1 si la respuesta es no.

Un DTE rechazado debe reenviarse dentro de las 24 horas desde el rechazo (cifra por confirmar ante Hacienda), y nadie avisa cuando ese plazo vence.
No hay declaración diaria obligatoria, pero el cierre diario es un control operativo: responde si cada cobro del día tiene su sello.
`;
