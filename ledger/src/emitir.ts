import type { AlmacenTickets } from "./almacen/tipos.ts";
import type { AlmacenDtes, RegistroDte } from "./almacen/dtes.ts";
import { codigoGeneracionNuevo } from "./azar.ts";
import { aceptarDte, adjuntarDte, rechazarDte, tipoDteDe, type DteRef, type Ticket } from "./ticket.ts";
import { construirDte, numeroControl, type Emisor } from "./dte/construir.ts";
import { ErrorLedger } from "./errores.ts";
import type { Generacion } from "./generacion.ts";
import { recibir } from "./recepcion-simulada.ts";
import { emisorPara } from "./servidor/vista-dte.ts";
import { validarDte } from "./validar.ts";

// Emits the tax document of paid tickets in the web app. The steps are the CLI's (cmdDteConstruir and
// cmdDteTransmitir in cli.ts): reserve the number, build, validate, simulated reception, then accept or refuse.
// The pure pieces (construirDte, validarDte, recibir, the ticket transitions) are the same ones.
//
// Differences from the CLI, on purpose:
// - The number is reserved in the same database transaction that writes a placeholder row (ledger_dtes,
//   estado "reservado"). A ticket that already has a row takes no number, so a second run never numbers it again.
//   A row left reservado by a run that stopped is completed by the next run, with the number it already holds.
// - The document is stored in ledger_dtes, not in datos/dte/. The ticket's DteRef points there.
// - Every ticket goes on the 2026 schemas (see generacionParaTicket). Only ambiente "00" (test).
//   Production needs the CLI's --confirmar-produccion.

export type ResultadoEmision = {
  ticket: string;
  // "aceptado" or "rechazado" when the ticket got a document (now, or completed from a stored one).
  // null when the ticket was left alone: not pagado, another run holds the number, or already emitido or rechazado.
  estado: "aceptado" | "rechazado" | null;
  // True when a document was already stored for the ticket and only the ticket was completed from it.
  reparado: boolean;
};

export type OpcionesEmision = {
  // Clock for the document, the transitions and the reception.
  ahora: Date;
  // Schema generation. Default: 2026 (see generacionParaTicket).
  esquemas?: Generacion;
  // Issuer. Default: the emisor of the generation (the same one the ticket page shows).
  emisor?: Emisor;
};

// Every ticket the web emits goes on the 2026 schemas. The caso schemas are a community mirror (herson/dte-json-schemas)
// with a receptor threshold that the Ministry's schemas do not have, and they do not accept code 11 (Bitcoin) on an 01.
// The CLI keeps its own default (LEDGER_ESQUEMAS, else caso). The web does not read that variable for emission.
export function generacionParaTicket(_ticket: Ticket): Generacion {
  return "2026";
}

function mensajeDe(e: unknown, respaldo: string): string {
  return e instanceof ErrorLedger ? e.message : respaldo;
}

function archivoDte(codigoGeneracion: string): string {
  return `ledger_dtes/${codigoGeneracion}`;
}

// Puts a stored document back on its ticket. Used when the document was stored and the ticket was not saved yet.
function ticketDesdeRegistro(ticket: Ticket, r: RegistroDte, ahora: Date): Ticket {
  const ref: DteRef = {
    tipoDte: r.tipoDte,
    codigoGeneracion: r.codigoGeneracion,
    numeroControl: r.numeroControl,
    ambiente: r.ambiente,
    archivo: archivoDte(r.codigoGeneracion),
  };
  const conDte = adjuntarDte(ticket, ref, ahora);
  if (r.estado === "aceptado") {
    if (r.sello === null) throw new ErrorLedger(`El documento ${r.numeroControl} no tiene sello.`);
    return aceptarDte(conDte, { valor: r.sello, momento: r.creado, simulado: true }, ahora);
  }
  return rechazarDte(conDte, (r.motivo ?? "").split("\n"), ahora);
}

export async function emitirTicket(
  almacen: AlmacenTickets,
  dtes: AlmacenDtes,
  ticket: Ticket,
  opciones: OpcionesEmision,
): Promise<ResultadoEmision> {
  const sinCambios: ResultadoEmision = { ticket: ticket.id, estado: null, reparado: false };
  const previo = await dtes.porTicket(ticket.id);
  if (previo !== null && previo.estado !== "reservado") {
    // A document was stored for this ticket but the ticket was not saved after it. Complete the ticket from the
    // stored row. No number is taken and nothing is built again.
    if (ticket.estado !== "pagado") return sinCambios;
    await almacen.guardar(ticketDesdeRegistro(ticket, previo, opciones.ahora));
    return { ticket: ticket.id, estado: previo.estado, reparado: true };
  }
  if (ticket.estado !== "pagado" || ticket.pago === null) return sinCambios;

  const instante = opciones.ahora;
  const generacion = opciones.esquemas ?? generacionParaTicket(ticket);
  const emisor = opciones.emisor ?? emisorPara(generacion);
  const tipo = tipoDteDe(ticket.cliente);
  const serie = `${tipo}-${emisor.codEstable}${emisor.codPuntoVenta}`;

  let codigo: string;
  let correlativo: number;
  if (previo !== null) {
    // Reserved by an earlier run that stopped before completing it: finish that document with its own number.
    if (previo.correlativo === null) throw new ErrorLedger(`La reserva del ticket ${ticket.id} no tiene correlativo.`);
    codigo = previo.codigoGeneracion;
    correlativo = previo.correlativo;
  } else {
    codigo = codigoGeneracionNuevo(`${ticket.id}|reserva`);
    // Taken in the same transaction as the placeholder row. Null means the ticket has a row now: no number is spent here.
    const tomado = await dtes.reservar({ ticketId: ticket.id, serie, tipoDte: tipo, codigoGeneracion: codigo });
    if (tomado === null) return sinCambios;
    correlativo = tomado;
  }
  const numero = numeroControl(tipo, emisor.codEstable, emisor.codPuntoVenta, correlativo, generacion);

  let documento: unknown = {};
  let observaciones: string[] | null = null;
  try {
    documento = construirDte(tipo, ticket, ticket.pago, emisor, {
      ambiente: "00",
      ahora: instante,
      correlativo,
      codigoGeneracion: codigo,
      generacion,
    }).documento;
  } catch (e) {
    observaciones = [mensajeDe(e, "No se pudo armar el documento de este ticket.")];
  }

  if (observaciones === null) {
    const validacion = validarDte(documento, { permitirProduccion: false, generacion });
    if (!validacion.ok) {
      observaciones = [...validacion.esquema, ...validacion.reglas].map((f) => `${f.ruta}: ${f.mensaje}`);
    }
  }

  let sello: string | null = null;
  let momento = instante.toISOString();
  if (observaciones === null) {
    const respuesta = recibir(documento, instante, { generacion });
    if (respuesta.aceptado && respuesta.sello) {
      sello = respuesta.sello;
      momento = respuesta.momento;
    } else {
      observaciones = respuesta.observaciones;
    }
  }

  const estado = sello === null ? "rechazado" : "aceptado";
  const ref: DteRef = { tipoDte: tipo, codigoGeneracion: codigo, numeroControl: numero, ambiente: "00", archivo: archivoDte(codigo) };
  const conDte = adjuntarDte(ticket, ref, instante);
  const final =
    sello === null
      ? rechazarDte(conDte, observaciones ?? [], instante)
      : aceptarDte(conDte, { valor: sello, momento, simulado: true }, instante);

  // The reserved row takes the document. The write matches only a row still reserved, so a row completed by another run is left alone.
  const completado = await dtes.completar({
    codigoGeneracion: codigo,
    ticketId: ticket.id,
    tipoDte: tipo,
    numeroControl: numero,
    ambiente: "00",
    estado,
    sello,
    motivo: sello === null ? (observaciones ?? []).join("\n") : null,
    documento,
    creado: momento,
    correlativo,
  });
  if (!completado) return sinCambios;
  await almacen.guardar(final);
  return { ticket: ticket.id, estado, reparado: false };
}

export const LIMITE_EMISION_POR_SYNC = 50;

export type ResumenEmision = { emitidos: number; rechazados: number; fallidos: number };

// Emits the tickets still pagado, newest first, at most `limite` per run. A ticket that fails stays pagado and is
// tried again on the next run; the failure is logged, not thrown, so one bad ticket does not stop the others.
export async function emitirPagados(
  almacen: AlmacenTickets,
  dtes: AlmacenDtes,
  opciones: OpcionesEmision & { limite?: number },
): Promise<ResumenEmision> {
  const pendientes = await almacen.listar({ estado: "pagado", limite: opciones.limite ?? LIMITE_EMISION_POR_SYNC });
  const resumen: ResumenEmision = { emitidos: 0, rechazados: 0, fallidos: 0 };
  for (const ticket of pendientes) {
    try {
      const r = await emitirTicket(almacen, dtes, ticket, opciones);
      if (r.estado === "aceptado") resumen.emitidos += 1;
      else if (r.estado === "rechazado") resumen.rechazados += 1;
    } catch (e) {
      resumen.fallidos += 1;
      console.error(`No se pudo emitir el documento del ticket ${ticket.id}:`, e);
    }
  }
  return resumen;
}
