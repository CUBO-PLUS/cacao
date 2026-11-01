import type { AlmacenAtestaciones } from "./almacen/atestaciones.ts";
import { anexarAtestacion } from "./almacen/atestaciones.ts";
import type { AlmacenTickets } from "./almacen/tipos.ts";
import type { AlmacenDtes, RegistroDte } from "./almacen/dtes.ts";
import { codigoGeneracionNuevo } from "./azar.ts";
import type { DatosAtestacion } from "./atestacion.ts";
import { aceptarDte, adjuntarDte, rechazarDte, tipoDteDe, type Contingencia, type DteRef, type Ticket } from "./ticket.ts";
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
// - The rate attestation of a Lightning payment is chained in ledger_atestaciones once the document row exists.
// - The simulated contingency of the owner (opciones.contingencia) issues documents with tipoOperacion 2. They wait
//   in estado "contingencia" until retransmitirContingencias takes them with the simulated reception.

export type ResultadoEmision = {
  ticket: string;
  // "aceptado" or "rechazado" when the ticket got a document (now, or completed from a stored one). "contingencia"
  // when it was issued during the simulated outage and waits. null when the ticket was left alone: not pagado,
  // another run holds the number, or already emitido or rechazado.
  estado: "aceptado" | "rechazado" | "contingencia" | null;
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
  // Simulated outage of Hacienda: when set, documents are issued in contingency and wait. Demo control only.
  contingencia?: { desde: Date } | null;
  // Chain of rate attestations. When set, each Lightning payment gets its record.
  atestaciones?: AlmacenAtestaciones | null;
};

// Every ticket the web emits goes on the 2026 schemas. The caso schemas are a community mirror (herson/dte-json-schemas)
// with a receptor threshold that the Ministry's schemas do not have, and they do not accept code 11 (Bitcoin) on an 01.
// The CLI keeps its own default (LEDGER_ESQUEMAS, else caso). The web does not read that variable for emission.
export function generacionParaTicket(_ticket: Ticket): Generacion {
  return "2026";
}

// Written on every document issued in the simulated outage: the schema needs it as text.
export const MOTIVO_CONTINGENCIA_SIMULADA =
  "Simulación de caída de Hacienda (demo de CacaoLedger): documento emitido sin transmisión real";

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

// The attestation of the payment, from the ticket and the document it belongs to. Lightning only.
export function datosDeAtestacion(
  ticket: Ticket,
  documento: { codigoGeneracion: string; numeroControl: string; tipoDte: "01" | "03" },
  generacion: Generacion,
  ahora: Date,
): DatosAtestacion | null {
  const p = ticket.pago;
  if (p === null || p.rail !== "lightning") return null;
  return {
    ticket: ticket.id,
    codigoGeneracion: documento.codigoGeneracion,
    numeroControl: documento.numeroControl,
    tipoDte: documento.tipoDte,
    generacion,
    momentoPago: p.momento,
    sats: p.sats,
    usdCentavos: p.montoCentavos,
    tasaUsdPorBtc: p.tasaUsdPorBtc,
    tasaFuente: p.tasaFuente,
    paymentHash: p.paymentHash,
    // The Lightning rail goes as "11" (Bitcoin) on the 2026 schemas; the caso schemas take "99" (Otros) on an 01.
    codigoFormaPago: generacion === "2026" ? "11" : "99",
    referencia: `BTC-LN|${p.sats}sat|${p.tasaUsdPorBtc}|${p.paymentHash.slice(0, 12)}`,
    registrada: ahora.toISOString(),
  };
}

async function atestiguar(
  atestaciones: AlmacenAtestaciones | null | undefined,
  ticket: Ticket,
  documento: { codigoGeneracion: string; numeroControl: string; tipoDte: "01" | "03" },
  generacion: Generacion,
  ahora: Date,
): Promise<void> {
  if (!atestaciones) return;
  const datos = datosDeAtestacion(ticket, documento, generacion, ahora);
  if (datos === null) return;
  await anexarAtestacion(atestaciones, datos);
}

export async function emitirTicket(
  almacen: AlmacenTickets,
  dtes: AlmacenDtes,
  ticket: Ticket,
  opciones: OpcionesEmision,
): Promise<ResultadoEmision> {
  const sinCambios: ResultadoEmision = { ticket: ticket.id, estado: null, reparado: false };
  const previo = await dtes.porTicket(ticket.id);
  // Issued in contingency and waiting for the reception: nothing is sent again here (retransmitirContingencias does).
  if (previo !== null && previo.estado === "contingencia") return sinCambios;
  if (previo !== null && previo.estado !== "reservado") {
    // A document was stored for this ticket but the ticket was not saved after it. Complete the ticket from the
    // stored row. No number is taken and nothing is built again.
    if (ticket.estado !== "pagado") return sinCambios;
    const generacion = generacionParaTicket(ticket);
    await atestiguar(opciones.atestaciones, ticket, previo, generacion, opciones.ahora);
    await almacen.guardar(ticketDesdeRegistro(ticket, previo, opciones.ahora));
    return { ticket: ticket.id, estado: previo.estado === "contingencia" ? null : previo.estado, reparado: true };
  }
  if (ticket.estado !== "pagado" || ticket.pago === null) return sinCambios;

  const instante = opciones.ahora;
  const generacion = opciones.esquemas ?? generacionParaTicket(ticket);
  const emisor = opciones.emisor ?? emisorPara(generacion);
  const tipo = tipoDteDe(ticket.cliente);
  const serie = `${tipo}-${emisor.codEstable}${emisor.codPuntoVenta}`;
  const contingencia = opciones.contingencia ?? null;

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
      contingencia: contingencia === null ? undefined : { motivo: MOTIVO_CONTINGENCIA_SIMULADA },
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

  let estado: "aceptado" | "rechazado" | "contingencia";
  let sello: string | null = null;
  let momento = instante.toISOString();
  if (observaciones !== null) {
    estado = "rechazado";
  } else if (contingencia !== null) {
    // The reception is not reached during the outage: the document waits.
    estado = "contingencia";
  } else {
    const respuesta = recibir(documento, instante, { generacion });
    if (respuesta.aceptado && respuesta.sello) {
      sello = respuesta.sello;
      momento = respuesta.momento;
      estado = "aceptado";
    } else {
      observaciones = respuesta.observaciones;
      estado = "rechazado";
    }
  }

  const ref: DteRef = { tipoDte: tipo, codigoGeneracion: codigo, numeroControl: numero, ambiente: "00", archivo: archivoDte(codigo) };
  const conDte = adjuntarDte(ticket, ref, instante);
  let final: Ticket;
  if (estado === "aceptado") {
    final = aceptarDte(conDte, { valor: sello as string, momento, simulado: true }, instante);
  } else if (estado === "rechazado") {
    final = rechazarDte(conDte, observaciones ?? [], instante);
  } else {
    const cont: Contingencia = {
      desde: instante.toISOString(),
      simulada: true,
      tipoContingencia: 1,
      motivo: MOTIVO_CONTINGENCIA_SIMULADA,
      transmitida: null,
    };
    final = { ...conDte, contingencia: cont };
  }

  // The reserved row takes the document. The write matches only a row still reserved, so a row completed by another run is left alone.
  const completado = await dtes.completar({
    codigoGeneracion: codigo,
    ticketId: ticket.id,
    tipoDte: tipo,
    numeroControl: numero,
    ambiente: "00",
    estado,
    sello,
    motivo: estado === "rechazado" ? (observaciones ?? []).join("\n") : null,
    documento,
    creado: momento,
    correlativo,
  });
  if (!completado) return sinCambios;
  // The attestation goes before the ticket is saved: if it fails, the ticket stays pagado and the next run completes it.
  await atestiguar(opciones.atestaciones, ticket, { codigoGeneracion: codigo, numeroControl: numero, tipoDte: tipo }, generacion, instante);
  await almacen.guardar(final);
  return { ticket: ticket.id, estado, reparado: false };
}

// The owner's "Reintentar emisión" on a refused ticket. The refused row goes back to reservado with the number it
// holds, so nothing is numbered again; the ticket then goes through emitirTicket as a paid one. A second press, or a
// press while another one runs, finds the row already reopened and changes nothing.
export async function reintentarEmision(
  almacen: AlmacenTickets,
  dtes: AlmacenDtes,
  ticket: Ticket,
  opciones: OpcionesEmision,
): Promise<ResultadoEmision> {
  const sinCambios: ResultadoEmision = { ticket: ticket.id, estado: null, reparado: false };
  if (ticket.estado !== "rechazado" || ticket.pago === null) return sinCambios;
  const previo = await dtes.porTicket(ticket.id);
  if (previo === null) return sinCambios;
  if (previo.estado === "rechazado") {
    if (!(await dtes.reabrir(ticket.id, previo.codigoGeneracion))) return sinCambios;
  }
  return emitirTicket(almacen, dtes, { ...ticket, estado: "pagado", dte: null, rechazo: null }, opciones);
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

export type ResultadoRetransmision = { transmitidos: number; pendientes: number };

// "Simular que Hacienda volvió": sends every document waiting in contingency to the simulated reception. A document
// the reception takes gets the simulated seal and its ticket is emitted. One it refuses stays waiting, and is counted.
export async function retransmitirContingencias(
  almacen: AlmacenTickets,
  dtes: AlmacenDtes,
  opciones: { ahora: Date },
): Promise<ResultadoRetransmision> {
  const resultado: ResultadoRetransmision = { transmitidos: 0, pendientes: 0 };
  for (const fila of await dtes.contingencias()) {
    const ticket = await almacen.porId(fila.ticketId);
    if (ticket === null || ticket.estado !== "pagado" || ticket.dte === null) {
      resultado.pendientes += 1;
      continue;
    }
    const respuesta = recibir(fila.documento, opciones.ahora, { generacion: "2026" });
    if (!respuesta.aceptado || respuesta.sello === null) {
      resultado.pendientes += 1;
      continue;
    }
    if (!(await dtes.transmitirContingencia(fila.codigoGeneracion, respuesta.sello, respuesta.momento))) {
      resultado.pendientes += 1;
      continue;
    }
    const enviado: Ticket = {
      ...ticket,
      contingencia: ticket.contingencia ? { ...ticket.contingencia, transmitida: { momento: respuesta.momento, sello: respuesta.sello } } : null,
    };
    await almacen.guardar(aceptarDte(enviado, { valor: respuesta.sello, momento: respuesta.momento, simulado: true }, opciones.ahora));
    resultado.transmitidos += 1;
  }
  return resultado;
}

// Tickets emitted before the chain existed have no record. This appends the missing ones, oldest first, so the chain
// follows the order of the sales. It is idempotent: a ticket that has its record is skipped. Returns how many it wrote.
export async function completarAtestaciones(
  almacen: AlmacenTickets,
  atestaciones: AlmacenAtestaciones,
  opciones: { ahora: Date; limite?: number },
): Promise<number> {
  const limite = opciones.limite ?? 200;
  const candidatos: Ticket[] = [];
  for (const estado of ["emitido", "rechazado", "pagado"] as const) {
    candidatos.push(...(await almacen.listar({ estado, limite: 500 })));
  }
  const conDocumento = candidatos
    .filter((t) => t.dte !== null && t.pago !== null && t.pago.rail === "lightning")
    .sort((a, b) => a.creado.localeCompare(b.creado));
  let escritos = 0;
  for (const t of conDocumento) {
    if (escritos >= limite) break;
    if (t.dte === null) continue;
    if ((await atestaciones.porTicket(t.id)) !== null) continue;
    const datos = datosDeAtestacion(
      t,
      { codigoGeneracion: t.dte.codigoGeneracion, numeroControl: t.dte.numeroControl, tipoDte: t.dte.tipoDte },
      generacionParaTicket(t),
      opciones.ahora,
    );
    if (datos === null) continue;
    await anexarAtestacion(atestaciones, datos);
    escritos += 1;
  }
  return escritos;
}
