import { createHash } from "node:crypto";
import emisorGeneral from "../../fixtures/emisor.json" with { type: "json" };
import emisorCaso from "../../fixtures/caso/emisor.json" with { type: "json" };
import { construirDte, type Emisor, type ResultadoConstruccion } from "../dte/construir.ts";
import { ErrorLedger } from "../errores.ts";
import { resolverGeneracion, type Generacion } from "../generacion.ts";
import { tipoDteDe, type Ticket } from "../ticket.ts";

// A preview of the tax document of one ticket, built on the fly. It does NOT consume the real correlative
// (ledger_siguiente_correlativo): the number comes from the ticket id, so the same ticket always shows the same
// preview. The document the CLI or the stored seal refer to is a different thing and is not read here.

export type VistaDte = { ok: true; resultado: ResultadoConstruccion } | { ok: false; motivo: string };

// The same demo emisor the CLI uses: the caso schemas need tipoEstablecimiento, so they get their own fixture.
export function emisorPara(generacion: Generacion): Emisor {
  return (generacion === "caso" ? emisorCaso : emisorGeneral) as Emisor;
}

// 15-digit correlative from the last four hex digits of the id, never 0.
export function correlativoDeId(id: string): number {
  return parseInt(id.slice(-4), 16) + 1;
}

// An upper-case UUID version 4 derived from the ticket id, in the shape codigoGeneracion requires.
export function codigoGeneracionDeId(id: string): string {
  const h = createHash("sha256").update(`vista-dte|${id}`).digest("hex").toUpperCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-A${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function vistaDte(ticket: Ticket, generacion?: Generacion): VistaDte {
  if (ticket.pago === null) {
    return { ok: false, motivo: "Todavía no hay cobro. El documento se arma cuando el ticket está pagado." };
  }
  let gen: Generacion;
  try {
    gen = resolverGeneracion(generacion);
  } catch (e) {
    return { ok: false, motivo: e instanceof ErrorLedger ? e.message : "No se pudo elegir el esquema." };
  }
  try {
    const resultado = construirDte(tipoDteDe(ticket.cliente), { ...ticket, estado: "pagado" }, ticket.pago, emisorPara(gen), {
      ambiente: "00",
      ahora: new Date(ticket.pago.momento),
      correlativo: correlativoDeId(ticket.id),
      codigoGeneracion: codigoGeneracionDeId(ticket.id),
      generacion: gen,
    });
    return { ok: true, resultado };
  } catch (e) {
    return { ok: false, motivo: e instanceof ErrorLedger ? e.message : "No se pudo armar el documento de este ticket." };
  }
}
