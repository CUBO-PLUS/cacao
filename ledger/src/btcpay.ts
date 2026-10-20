import type { AlmacenTickets } from "./almacen/tipos.ts";
import { ErrorLedger } from "./errores.ts";
import type { Factura } from "./pagos/btcpay-api.ts";
import type { PagoLightning } from "./pagos/tipos.ts";
import { crearTicket, registrarPago, totalDeTicket, validarEntrada, type ProductoCacao, type Ticket } from "./ticket.ts";

// Turns a settled BTCPay Server invoice into a paid ticket. The invoice metadata contract is
// MetadatosCacao in pagos/btcpay-api.ts, and docs/importar-btcpay.md explains the rules.
// Nothing here calls the network: the caller reads the invoices and passes them in.

const PRODUCTOS: string[] = ["media", "travel", "market", "pay"];
const HASH = /^[0-9a-f]{64}$/;
// Longest description a ticket line accepts (see validarEntrada in ticket.ts).
const MAX_DESCRIPCION = 1500;

export type ResultadoFacturaBtcpay = { ticket: Ticket; nueva: boolean } | { omitida: string };

function omitida(motivo: string): { omitida: string } {
  return { omitida: motivo };
}

function textoNoVacio(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function enteroPositivo(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0;
}

// Reads the invoices of an offline file (--archivo): a JSON array as btcpay-api.ts returns them,
// with expiraEn as an ISO string.
export function leerFacturasArchivo(raw: unknown): Factura[] {
  if (!Array.isArray(raw)) throw new ErrorLedger("El archivo de facturas debe ser una lista JSON de facturas.");
  return raw.map((f: unknown, i: number) => {
    const o = (typeof f === "object" && f !== null ? f : {}) as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.storeId !== "string" || typeof o.estado !== "string") {
      throw new ErrorLedger(`La factura ${i + 1} del archivo no trae id, storeId o estado.`);
    }
    const expira = new Date(String(o.expiraEn));
    if (typeof o.expiraEn !== "string" || Number.isNaN(expira.getTime())) {
      throw new ErrorLedger(`La factura ${i + 1} del archivo no trae una fecha de vencimiento (expiraEn) en ISO-8601.`);
    }
    return { ...o, expiraEn: expira } as unknown as Factura;
  });
}

// Imports one invoice. A repeated invoice returns the ticket it already made, and writes nothing.
// The tickets go through the storage interface, so the web app and the CLI share these rules.
export async function importarFacturaBtcpay(almacen: AlmacenTickets, factura: Factura, ahora: Date): Promise<ResultadoFacturaBtcpay> {
  if (factura.estado !== "Settled") return omitida(`la factura no está pagada (estado ${factura.estado})`);
  const meta = factura.metadata ?? {};
  if (typeof meta.producto !== "string" || !PRODUCTOS.includes(meta.producto)) {
    return omitida("la factura no trae un producto de Cacao válido (metadata.producto)");
  }
  const producto = meta.producto as ProductoCacao;
  const orderId = textoNoVacio(meta.orderId);
  if (orderId === null) return omitida("la factura no trae metadata.orderId");
  const itemDesc = textoNoVacio(meta.itemDesc);
  if (itemDesc === null) return omitida("la factura no trae metadata.itemDesc");
  if (!enteroPositivo(meta.usdCentavos)) return omitida("metadata.usdCentavos debe ser un entero mayor que cero");
  const cotizacion = meta.cotizacionUsdBtc;
  if (typeof cotizacion !== "number" || !Number.isFinite(cotizacion) || cotizacion <= 0) {
    return omitida("metadata.cotizacionUsdBtc debe ser un número mayor que cero");
  }
  if (!enteroPositivo(factura.sats)) return omitida("los sats de la factura deben ser un entero mayor que cero");
  if (typeof factura.paymentHash !== "string" || !HASH.test(factura.paymentHash)) {
    return omitida("la factura no trae la referencia del pago (paymentHash)");
  }

  const previo = await almacen.porOrigen("btcpay", factura.id);
  if (previo) return { ticket: previo, nueva: false };
  if (producto === "market") {
    const deCacao = await almacen.porOrigen("cacaomarket", orderId);
    if (deCacao) return omitida(`ya importada desde CacaoMarket (ticket ${deCacao.id})`);
  }
  const otro = await almacen.porHash(factura.paymentHash);
  if (otro) return omitida(`ese pago ya cubre el ticket ${otro.id}`);

  // One line for the whole invoice. The price already includes IVA, as the consumer sees it.
  const entrada = validarEntrada({
    cliente: "consumidor",
    lineas: [{ descripcion: itemDesc.slice(0, MAX_DESCRIPCION), cantidad: 1, precioCentavos: meta.usdCentavos }],
  });
  const abierto = crearTicket(entrada, ahora);
  const pago: PagoLightning = {
    rail: "lightning",
    montoCentavos: totalDeTicket(abierto).totalCentavos,
    momento: ahora.toISOString(),
    sats: factura.sats,
    tasaUsdPorBtc: cotizacion.toFixed(2),
    tasaFuente: "btcpay",
    paymentHash: factura.paymentHash,
    idTransaccion: `btcpay-${factura.id}`,
  };
  const pagado = registrarPago(abierto, pago, ahora);
  const ticket: Ticket = { ...pagado, origen: { plataforma: "btcpay", producto, numero: factura.id } };
  await almacen.guardar(ticket);
  return { ticket, nueva: true };
}
