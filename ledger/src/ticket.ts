import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { escribirJson, leerJson } from "./datos.ts";
import { ErrorLedger } from "./errores.ts";
import { calcularTotales, centavosDesdeTexto, formatoUsd, type Modalidad, type Totales } from "./dinero.ts";
import type { Pago } from "./pagos/tipos.ts";
import { fechaHoraSalvador } from "./tiempo.ts";
import { sufijoTicket } from "./azar.ts";

export type TipoCliente = "consumidor" | "contribuyente";
export type EstadoTicket = "abierto" | "pagado" | "emitido" | "rechazado";

export interface Direccion {
  departamento: string; // CAT-012, two digits
  municipio: string; // CAT-013, two digits within the departamento
  distrito: string;
  complemento: string;
}

// Data the 03 schema requires for the receiver.
export interface Receptor {
  nit: string;
  nrc: string;
  nombre: string;
  nombreComercial: string | null;
  codActividad: string; // CAT-019
  descActividad: string;
  direccion: Direccion;
  telefono: string | null;
  correo: string | null;
}

// Price semantics follow the customer: for a consumidor the price includes IVA,
// for a contribuyente it does not. See dte/ and docs/hallazgos.md.
export interface LineaTicket {
  descripcion: string;
  cantidad: number;
  precioCentavos: number;
}

export interface DteRef {
  tipoDte: "01" | "03";
  codigoGeneracion: string;
  numeroControl: string;
  ambiente: "00" | "01";
  archivo: string; // path relative to the data directory
}

// Reception of the document. Simulated until real transmission exists.
export interface Sello {
  valor: string; // always starts with SIMULADO-
  momento: string; // ISO-8601
  simulado: true;
}

// JWS from SVFE-API-Firmador. Optional; transmission can still use the simulated seal alone.
export interface FirmaDte {
  jws: string;
  momento: string;
  firmadorUrl: string;
  comercioId: string;
  archivo: string; // path relative to the data directory
}

export interface Rechazo {
  momento: string; // ISO-8601, starts the 24-hour fuse
  observaciones: string[];
}

// Where the ticket came from, when it was imported. Absent on tickets typed by hand.
// CacaoMarket: the order number. BTCPay: the invoice id, and the product that created it.
export type ProductoCacao = "media" | "travel" | "market" | "pay";

export type OrigenTicket =
  | { plataforma: "cacaomarket"; numero: string }
  | { plataforma: "btcpay"; producto: ProductoCacao; numero: string };

export type PlataformaOrigen = OrigenTicket["plataforma"];

export interface Ticket {
  id: string;
  creado: string;
  actualizado: string;
  estado: EstadoTicket;
  cliente: TipoCliente;
  receptor: Receptor | null;
  lineas: LineaTicket[];
  pago: Pago | null;
  dte: DteRef | null;
  firma: FirmaDte | null;
  sello: Sello | null;
  rechazo: Rechazo | null;
  comercioId?: string | null;
  origen?: OrigenTicket | null;
}

export interface EntradaTicket {
  cliente: TipoCliente;
  receptor?: Receptor | null;
  lineas: LineaTicket[];
}

const ID_TICKET = /^TK-\d{8}-[0-9A-F]{4}$/;

export function modalidadDe(cliente: TipoCliente): Modalidad {
  return cliente === "consumidor" ? "con-iva" : "sin-iva";
}

export function tipoDteDe(cliente: TipoCliente): "01" | "03" {
  return cliente === "consumidor" ? "01" : "03";
}

export function totalDeTicket(ticket: Pick<Ticket, "cliente" | "lineas">): Totales {
  return calcularTotales(ticket.lineas, modalidadDe(ticket.cliente)).totales;
}

export function validarId(id: string): void {
  if (!ID_TICKET.test(id)) {
    throw new ErrorLedger(`"${id}" no es un identificador de ticket (usá la forma TK-AAAAMMDD-XXXX).`);
  }
}

function cadena(v: unknown, campo: string, max: number, min = 1): string {
  if (typeof v !== "string" || v.trim().length < min || v.length > max) {
    throw new ErrorLedger(`El campo ${campo} debe ser texto de entre ${min} y ${max} caracteres.`);
  }
  return v.trim();
}

function digitos(v: unknown, campo: string, validos: number[]): string {
  if (typeof v !== "string" || !/^\d+$/.test(v) || !validos.includes(v.length)) {
    throw new ErrorLedger(`El campo ${campo} debe ser numérico de ${validos.join(" o ")} dígitos.`);
  }
  return v;
}

function opcional(v: unknown, campo: string, max: number): string | null {
  if (v === null || v === undefined || v === "") return null;
  return cadena(v, campo, max);
}

export function validarReceptor(r: unknown): Receptor {
  if (typeof r !== "object" || r === null) {
    throw new ErrorLedger("El receptor debe ser un objeto con sus datos fiscales.");
  }
  const o = r as Record<string, unknown>;
  const d = (typeof o.direccion === "object" && o.direccion !== null ? o.direccion : {}) as Record<string, unknown>;
  return {
    nit: digitos(o.nit, "receptor.nit", [9, 14]),
    nrc: digitos(o.nrc, "receptor.nrc", [1, 2, 3, 4, 5, 6, 7, 8]),
    nombre: cadena(o.nombre, "receptor.nombre", 250),
    nombreComercial: opcional(o.nombreComercial, "receptor.nombreComercial", 250),
    codActividad: digitos(o.codActividad, "receptor.codActividad", [2, 3, 4, 5, 6]),
    descActividad: cadena(o.descActividad, "receptor.descActividad", 150),
    direccion: {
      departamento: digitos(d.departamento, "receptor.direccion.departamento", [2]),
      municipio: digitos(d.municipio, "receptor.direccion.municipio", [2]),
      distrito: cadena(d.distrito, "receptor.direccion.distrito", 100),
      complemento: cadena(d.complemento, "receptor.direccion.complemento", 200),
    },
    telefono: opcional(o.telefono, "receptor.telefono", 30),
    correo: opcional(o.correo, "receptor.correo", 100),
  };
}

// Accepts the JSON file format: lineas[] with "precio" as a decimal string, or "precioCentavos".
export function validarEntrada(entrada: unknown): EntradaTicket {
  if (typeof entrada !== "object" || entrada === null) {
    throw new ErrorLedger("El ticket debe ser un objeto JSON con cliente y lineas.");
  }
  const o = entrada as Record<string, unknown>;
  if (o.cliente !== "consumidor" && o.cliente !== "contribuyente") {
    throw new ErrorLedger('El cliente debe ser "consumidor" (factura 01) o "contribuyente" (CCF 03).');
  }
  if (!Array.isArray(o.lineas) || o.lineas.length === 0) {
    throw new ErrorLedger("El ticket necesita al menos una línea.");
  }
  const lineas: LineaTicket[] = o.lineas.map((raw, i) => {
    if (typeof raw !== "object" || raw === null) throw new ErrorLedger(`La línea ${i + 1} no es un objeto.`);
    const l = raw as Record<string, unknown>;
    const descripcion = cadena(l.descripcion, `lineas[${i}].descripcion`, 1500);
    if (!Number.isSafeInteger(l.cantidad) || (l.cantidad as number) <= 0) {
      throw new ErrorLedger(`La cantidad de la línea ${i + 1} debe ser un entero mayor que cero.`);
    }
    let precioCentavos: number;
    if (typeof l.precio === "string") precioCentavos = centavosDesdeTexto(l.precio);
    else if (Number.isSafeInteger(l.precioCentavos)) precioCentavos = l.precioCentavos as number;
    else throw new ErrorLedger(`La línea ${i + 1} necesita "precio" (por ejemplo "0.99").`);
    return { descripcion, cantidad: l.cantidad as number, precioCentavos };
  });
  const receptor = o.cliente === "contribuyente" ? validarReceptor(o.receptor) : null;
  if (o.cliente === "consumidor" && o.receptor) {
    throw new ErrorLedger("Un ticket de consumidor final no lleva receptor.");
  }
  return { cliente: o.cliente, receptor, lineas };
}

// Pure constructor. The id and the clock are injected so tests stay deterministic.
export function crearTicket(entrada: EntradaTicket, ahora: Date = new Date(), id?: string): Ticket {
  const valida = validarEntrada(entrada);
  const fecha = fechaHoraSalvador(ahora);
  const instante = ahora.toISOString();
  const nuevoId = id ?? `TK-${fecha.ymd}-${sufijoTicket(`${instante}|${JSON.stringify(valida)}`)}`;
  validarId(nuevoId);
  return {
    id: nuevoId,
    creado: instante,
    actualizado: instante,
    estado: "abierto",
    cliente: valida.cliente,
    receptor: valida.receptor ?? null,
    lineas: valida.lineas,
    pago: null,
    dte: null,
    firma: null,
    sello: null,
    rechazo: null,
  };
}

export function adjuntarFirma(ticket: Ticket, firma: FirmaDte, ahora: Date = new Date()): Ticket {
  if (!ticket.dte) throw new ErrorLedger(`El ticket ${ticket.id} no tiene documento.`);
  if (ticket.firma) {
    throw new ErrorLedger(`El ticket ${ticket.id} ya tiene firma JWS (${ticket.firma.archivo}).`);
  }
  return { ...ticket, firma, comercioId: firma.comercioId, actualizado: ahora.toISOString() };
}

export function registrarPago(ticket: Ticket, pago: Pago, ahora: Date = new Date()): Ticket {
  if (ticket.estado !== "abierto") {
    throw new ErrorLedger(`El ticket ${ticket.id} está ${ticket.estado}; solo un ticket abierto admite pago.`);
  }
  const total = totalDeTicket(ticket).totalCentavos;
  if (pago.montoCentavos !== total) {
    throw new ErrorLedger(
      `El pago es ${formatoUsd(pago.montoCentavos)} y el ticket suma ${formatoUsd(total)}; deben coincidir.`,
    );
  }
  return { ...ticket, estado: "pagado", pago, actualizado: ahora.toISOString() };
}

export function adjuntarDte(ticket: Ticket, dte: DteRef, ahora: Date = new Date()): Ticket {
  if (ticket.estado !== "pagado") {
    throw new ErrorLedger(`El ticket ${ticket.id} está ${ticket.estado}; solo un ticket pagado admite documento.`);
  }
  if (ticket.dte) {
    throw new ErrorLedger(`El ticket ${ticket.id} ya tiene un documento (${ticket.dte.numeroControl}).`);
  }
  return { ...ticket, dte, actualizado: ahora.toISOString() };
}

// The reception answered: the ticket is emitted and holds the simulated seal.
export function aceptarDte(ticket: Ticket, sello: Sello, ahora: Date = new Date()): Ticket {
  if (ticket.estado !== "pagado" && ticket.estado !== "rechazado") {
    throw new ErrorLedger(`El ticket ${ticket.id} está ${ticket.estado}; solo un ticket pagado o rechazado admite sello.`);
  }
  if (!ticket.dte) throw new ErrorLedger(`El ticket ${ticket.id} no tiene documento.`);
  return { ...ticket, estado: "emitido", sello, rechazo: null, actualizado: ahora.toISOString() };
}

// The reception refused the document. The ticket keeps its payment and waits 24 hours.
export function rechazarDte(ticket: Ticket, observaciones: string[], ahora: Date = new Date()): Ticket {
  if (ticket.estado !== "pagado" && ticket.estado !== "rechazado") {
    throw new ErrorLedger(`El ticket ${ticket.id} está ${ticket.estado}; solo un ticket pagado o rechazado admite rechazo.`);
  }
  if (!ticket.dte) throw new ErrorLedger(`El ticket ${ticket.id} no tiene documento.`);
  const momento = ahora.toISOString();
  return { ...ticket, estado: "rechazado", rechazo: { momento, observaciones }, actualizado: momento };
}

function rutaTicket(dirDatos: string, id: string): string {
  validarId(id);
  return join(dirDatos, "tickets", `${id}.json`);
}

export function guardarTicket(dirDatos: string, ticket: Ticket): void {
  escribirJson(rutaTicket(dirDatos, ticket.id), ticket);
}

export function leerTicket(dirDatos: string, id: string): Ticket {
  const ruta = rutaTicket(dirDatos, id);
  if (!existsSync(ruta)) {
    throw new ErrorLedger(`No existe el ticket ${id} en ${dirDatos}.`);
  }
  return leerJson(ruta) as Ticket;
}

export function listarTickets(dirDatos: string): Ticket[] {
  const dir = join(dirDatos, "tickets");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => leerJson(join(dir, f)) as Ticket)
    .sort((a, b) => a.creado.localeCompare(b.creado));
}

// One payment hash must settle one ticket. Returns the other ticket that already holds it.
export function ticketConHashDePago(dirDatos: string, hash: string, idTicket: string): string | null {
  for (const t of listarTickets(dirDatos)) {
    if (t.id !== idTicket && t.pago?.rail === "lightning" && t.pago.paymentHash === hash) return t.id;
  }
  return null;
}

// The ticket already imported from this order number or invoice id, if any.
export function ticketDeOrigen(dirDatos: string, plataforma: PlataformaOrigen, numero: string): Ticket | null {
  return listarTickets(dirDatos).find((t) => t.origen?.plataforma === plataforma && t.origen.numero === numero) ?? null;
}
