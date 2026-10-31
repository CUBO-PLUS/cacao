import { createHash } from "node:crypto";
import type { AlmacenDtes } from "./almacen/dtes.ts";
import type { AlmacenTickets } from "./almacen/tipos.ts";
import { sufijoTicket } from "./azar.ts";
import { emitirTicket, type OpcionesEmision } from "./emitir.ts";
import { ErrorLedger } from "./errores.ts";
import type { Pago } from "./pagos/tipos.ts";
import { fechaHoraSalvador } from "./tiempo.ts";
import { crearTicket, registrarPago, type OrigenTicket, type ProductoCacao, type Ticket } from "./ticket.ts";

// The sales the API (ledger/app/api/v1) registers. Pure: the store comes in as a port, so the rules are tested without
// the database. The database (migration 20261102000001_ledger_api.sql) enforces the same dedupe with unique constraints.
//
// Two rules that the code below keeps:
// - A sale of product "negocios" (a business that charges with CacaoPay) is stored as a sale only. It never becomes a
//   ticket, so no group total, book, export or tax document counts it or issues in its name.
// - A lightning sale carries its BTCPay invoice. The ticket gets origin btcpay + invoice id, the same origin the BTCPay
//   sync uses, so the invoice is one ticket whichever arrives first.

export const PRODUCTOS_VENTA = ["media", "travel", "market", "pay", "negocios"] as const;
export type ProductoVenta = (typeof PRODUCTOS_VENTA)[number];
export type MedioVenta = "lightning" | "efectivo";

export const SIN_DOCUMENTO_NEGOCIO = "Sin documento: falta el registro fiscal del negocio";

export type EntradaVenta = {
  referencia: string;
  producto: ProductoVenta;
  descripcion: string;
  montoCentavos: number;
  medio: MedioVenta;
  pago: { sats: number; tasa: string; facturaId: string; hash: string } | null;
  negocioId: string | null;
};

// A sale as the database has it (ledger_ventas_api, to_jsonb).
export type FilaVenta = {
  id: string;
  cliente_id: string;
  referencia: string;
  producto: ProductoVenta;
  negocio_id: string | null;
  descripcion: string;
  monto_centavos: number;
  medio: MedioVenta;
  factura_id: string | null;
  payment_hash: string | null;
  sats: number | null;
  tasa_usd_btc: string | number | null;
  ticket_id: string | null;
  estado: "reservada" | "registrada";
  creado_en: string;
};

export type DocumentoVenta = {
  numeroControl: string;
  codigoGeneracion: string;
  estado: "aceptado" | "rechazado" | "pendiente";
  sello: string | null;
  observaciones: string[];
};

export type ResultadoVenta = {
  id: string;
  estado: "registrada";
  situacion: "nueva" | "existente";
  // The tax document of the sale, when one was issued or is still due. Null for a business sale.
  documento: DocumentoVenta | null;
  // The plain Spanish reason a sale has no document of the group.
  sinDocumento: string | null;
};

export type PuertoVentas = {
  almacen: AlmacenTickets;
  dtes: AlmacenDtes;
  // Takes or finds the sale of the key. The database decides; the same key and body give the same sale.
  reservar(clienteId: string, clave: string, huella: string, entrada: EntradaVenta): Promise<{ situacion: "nueva" | "existente"; venta: FilaVenta }>;
  // Links the ticket the reserved sale made.
  completar(ventaId: string, ticketId: string): Promise<FilaVenta>;
};

const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function texto(v: unknown, campo: string, max: number): string {
  if (typeof v !== "string" || v.trim().length < 1 || v.trim().length > max) {
    throw new ErrorLedger(`El campo ${campo} debe ser texto de entre 1 y ${max} caracteres.`);
  }
  return v.trim();
}

// Validates the body of POST /api/v1/ventas. Amounts are integer cents; the tasa is a decimal text.
export function validarVenta(cuerpo: unknown): EntradaVenta {
  if (typeof cuerpo !== "object" || cuerpo === null || Array.isArray(cuerpo)) {
    throw new ErrorLedger("El cuerpo tiene que ser un objeto JSON.");
  }
  const o = cuerpo as Record<string, unknown>;
  const referencia = texto(o.referencia, "referencia", 120);
  if (typeof o.producto !== "string" || !(PRODUCTOS_VENTA as readonly string[]).includes(o.producto)) {
    throw new ErrorLedger("El campo producto debe ser media, travel, market, pay o negocios.");
  }
  const producto = o.producto as ProductoVenta;
  const descripcion = texto(o.descripcion, "descripcion", 200);
  const monto = o.monto_usd_centavos;
  if (!Number.isSafeInteger(monto) || (monto as number) < 1 || (monto as number) > 2147483647) {
    throw new ErrorLedger("El campo monto_usd_centavos debe ser un entero mayor que cero.");
  }
  if (o.medio !== "lightning" && o.medio !== "efectivo") {
    throw new ErrorLedger('El campo medio debe ser "lightning" o "efectivo".');
  }
  let pago: EntradaVenta["pago"] = null;
  if (o.medio === "lightning") {
    const p = (typeof o.pago === "object" && o.pago !== null ? o.pago : null) as Record<string, unknown> | null;
    if (p === null) throw new ErrorLedger("Un pago por lightning necesita el objeto pago con sats, tasa, factura_id y hash.");
    if (!Number.isSafeInteger(p.sats) || (p.sats as number) < 1) throw new ErrorLedger("pago.sats debe ser un entero mayor que cero.");
    const tasa = typeof p.tasa === "number" ? String(p.tasa) : p.tasa;
    if (typeof tasa !== "string" || !/^\d+(\.\d{1,2})?$/.test(tasa) || Number(tasa) <= 0) {
      throw new ErrorLedger("pago.tasa debe ser el precio del bitcoin en dólares, con hasta dos decimales.");
    }
    if (typeof p.hash !== "string" || !HEX64.test(p.hash)) throw new ErrorLedger("pago.hash debe ser el hash de 64 caracteres hexadecimales.");
    pago = { sats: p.sats as number, tasa, facturaId: texto(p.factura_id, "pago.factura_id", 200), hash: p.hash };
  } else if (o.pago !== undefined && o.pago !== null) {
    throw new ErrorLedger("Un pago en efectivo no lleva el objeto pago.");
  }
  let negocioId: string | null = null;
  if (producto === "negocios") {
    if (typeof o.negocio_id !== "string" || !UUID.test(o.negocio_id)) {
      throw new ErrorLedger("Una venta de negocios necesita negocio_id (el identificador del negocio).");
    }
    negocioId = o.negocio_id.toLowerCase();
  } else if (o.negocio_id !== undefined && o.negocio_id !== null) {
    throw new ErrorLedger("Solo una venta de negocios lleva negocio_id.");
  }
  return { referencia, producto, descripcion, montoCentavos: monto as number, medio: o.medio, pago, negocioId };
}

// The same body always gives the same fingerprint, whatever the key order was.
export function huellaVenta(e: EntradaVenta): string {
  const canonico = JSON.stringify([
    e.referencia,
    e.producto,
    e.descripcion,
    e.montoCentavos,
    e.medio,
    e.pago ? [e.pago.sats, e.pago.tasa, e.pago.facturaId, e.pago.hash] : null,
    e.negocioId,
  ]);
  return createHash("sha256").update(canonico, "utf8").digest("hex");
}

// The ticket id of a sale is fixed by the sale: a retry after a crash makes the same ticket, not a second one.
export function idTicketDeVenta(ventaId: string, creado: Date): string {
  return `TK-${fechaHoraSalvador(creado).ymd}-${sufijoTicket(`venta|${ventaId}`)}`;
}

// The ticket of a consumer sale, paid. Same shape the BTCPay import makes: one line, the price with IVA.
export function ticketDeVenta(e: EntradaVenta, id: string, creado: Date): Ticket {
  if (e.producto === "negocios") throw new ErrorLedger("Una venta de negocios no es un ticket del grupo.");
  const abierto = crearTicket(
    { cliente: "consumidor", lineas: [{ descripcion: e.descripcion, cantidad: 1, precioCentavos: e.montoCentavos }] },
    creado,
    id,
  );
  const momento = creado.toISOString();
  const pago: Pago =
    e.medio === "lightning" && e.pago
      ? {
          rail: "lightning",
          montoCentavos: e.montoCentavos,
          momento,
          sats: e.pago.sats,
          tasaUsdPorBtc: e.pago.tasa,
          tasaFuente: "api de CacaoLedger",
          paymentHash: e.pago.hash,
          idTransaccion: `api-${e.pago.facturaId}`,
        }
      : { rail: "efectivo", montoCentavos: e.montoCentavos, momento };
  const pagado = registrarPago(abierto, pago, creado);
  const origen: OrigenTicket | null =
    e.medio === "lightning" && e.pago ? { plataforma: "btcpay", producto: e.producto as ProductoCacao, numero: e.pago.facturaId } : null;
  return { ...pagado, origen };
}

export function documentoDe(ticket: Ticket): DocumentoVenta | null {
  if (!ticket.dte) return null;
  const estado = ticket.estado === "emitido" ? "aceptado" : ticket.estado === "rechazado" ? "rechazado" : "pendiente";
  return {
    numeroControl: ticket.dte.numeroControl,
    codigoGeneracion: ticket.dte.codigoGeneracion,
    estado,
    sello: ticket.sello?.valor ?? null,
    observaciones: ticket.rechazo?.observaciones ?? [],
  };
}

// Registers a sale: validates it, takes or finds it, makes its ticket once (or finds the ticket of the same invoice),
// and emits the document when the ticket is due one. A failed emission does not fail the sale: the ticket stays pagado
// and the next sync emits it.
export async function registrarVenta(
  puerto: PuertoVentas,
  clienteId: string,
  clave: string,
  cuerpo: unknown,
  opciones: OpcionesEmision,
): Promise<ResultadoVenta> {
  const entrada = validarVenta(cuerpo);
  const { situacion, venta } = await puerto.reservar(clienteId, clave, huellaVenta(entrada), entrada);

  if (entrada.producto === "negocios") {
    // A business sale: no ticket, no document of the group. It is only the sale.
    return { id: venta.id, estado: "registrada", situacion, documento: null, sinDocumento: SIN_DOCUMENTO_NEGOCIO };
  }

  let ticket: Ticket | null = null;
  if (venta.ticket_id) {
    ticket = await puerto.almacen.porId(venta.ticket_id);
  }
  if (ticket === null) {
    const creado = new Date(venta.creado_en);
    const nuevo = ticketDeVenta(entrada, idTicketDeVenta(venta.id, creado), creado);
    try {
      await puerto.almacen.guardar(nuevo);
      ticket = nuevo;
    } catch (e) {
      // The invoice (or its hash) already has a ticket: the BTCPay sync made it first. That ticket is the sale's.
      if (!(e instanceof ErrorLedger) || !e.message.startsWith("DUPLICADO")) throw e;
      const existente =
        entrada.pago !== null ? await puerto.almacen.porOrigen("btcpay", entrada.pago.facturaId) : null;
      if (existente === null) throw new ErrorLedger("Ese pago ya está registrado en otro ticket.");
      ticket = existente;
    }
    await puerto.completar(venta.id, ticket.id);
  }

  if (ticket.estado === "pagado") {
    try {
      await emitirTicket(puerto.almacen, puerto.dtes, ticket, opciones);
    } catch (e) {
      console.error(`No se pudo emitir el documento del ticket ${ticket.id}:`, e);
    }
  }
  const final = (await puerto.almacen.porId(ticket.id)) ?? ticket;
  return { id: venta.id, estado: "registrada", situacion, documento: documentoDe(final), sinDocumento: null };
}

// The sales a month holds, for the owner's tablero. Business sales are summed apart: they are never group revenue.
export function resumenNegocios(filas: { producto: string; monto_centavos: number; creado_en: string }[], mes: string) {
  let ventas = 0;
  let centavos = 0;
  for (const f of filas) {
    if (f.producto !== "negocios") continue;
    if (fechaHoraSalvador(new Date(f.creado_en)).fecEmi.slice(0, 7) !== mes) continue;
    ventas += 1;
    centavos += f.monto_centavos;
  }
  return { ventas, centavos };
}
