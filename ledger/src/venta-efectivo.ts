import { createHash } from "node:crypto";
import type { AlmacenTickets } from "./almacen/tipos.ts";
import type { AlmacenDtes } from "./almacen/dtes.ts";
import { emitirTicket, type OpcionesEmision, type ResultadoEmision } from "./emitir.ts";
import { ErrorLedger } from "./errores.ts";
import { pagoEfectivo } from "./pagos/efectivo.ts";
import { fechaHoraSalvador } from "./tiempo.ts";
import { crearTicket, registrarPago, totalDeTicket, validarId, type EntradaTicket, type Ticket } from "./ticket.ts";

// A cash sale that the owner registers on the web: the ticket, the cash payment marked by hand, and the document through
// the same emission path as the rest. The id comes from the form token, so a double submit finds the ticket it made.

export type ResultadoVentaEfectivo = {
  ticket: Ticket;
  emision: ResultadoEmision | null;
  // True when the token had already made this sale: nothing was written again.
  yaExistia: boolean;
};

// TK-AAAAMMDD-XXXX from the day of the sale and the token (the same shape every ticket has).
export function idDeToken(token: string, ahora: Date): string {
  const ymd = fechaHoraSalvador(ahora).ymd;
  const sufijo = createHash("sha256").update(`venta-efectivo|${token}`).digest("hex").slice(0, 4).toUpperCase();
  const id = `TK-${ymd}-${sufijo}`;
  validarId(id);
  return id;
}

export async function registrarVentaEfectivo(
  almacen: AlmacenTickets,
  dtes: AlmacenDtes,
  entrada: EntradaTicket,
  token: string,
  opciones: OpcionesEmision,
): Promise<ResultadoVentaEfectivo> {
  if (token.trim().length < 8) throw new ErrorLedger("El formulario no tiene el sello de envío. Recargá la página y volvé a intentarlo.");
  const id = idDeToken(token, opciones.ahora);
  const previa = await almacen.porId(id);
  if (previa !== null) return { ticket: previa, emision: null, yaExistia: true };

  const abierto = crearTicket(entrada, opciones.ahora, id);
  // Cash is marked for the exact total of the ticket: the modality (with or without IVA) decides it.
  const pagado = registrarPago(abierto, pagoEfectivo(totalDeTicket(abierto).totalCentavos, opciones.ahora), opciones.ahora);
  await almacen.guardar(pagado);
  const emision = await emitirTicket(almacen, dtes, pagado, opciones);
  const final = (await almacen.porId(id)) ?? pagado;
  return { ticket: final, emision, yaExistia: false };
}
