import { ErrorLedger } from "../errores.ts";

// The tax documents the web emits, one row per ticket (ledger_dtes, migrations 20261021000004 and 20261021000005).
// The ticket keeps its own reference to the document (DteRef) and the seal; this table keeps the document itself.
//
// Emission in two steps: reservar() writes a placeholder row ("reservado") and takes the control number in the
// same database transaction; completar() writes the document into that row. A ticket has at most one row.

export type EstadoDte = "reservado" | "aceptado" | "rechazado";

export type RegistroDte = {
  codigoGeneracion: string;
  ticketId: string;
  tipoDte: "01" | "03";
  // Placeholder ("RESERVADO-<codigo>") while the row is reserved.
  numeroControl: string;
  ambiente: "00" | "01";
  estado: EstadoDte;
  // Simulated reception seal, present exactly when the document was accepted.
  sello: string | null;
  // Observations joined with new lines, when the document was refused.
  motivo: string | null;
  // The document as built. Empty object while reserved, or when the ticket could not be built into a document.
  documento: unknown;
  // ISO-8601. The reception moment (or the refusal moment).
  creado: string;
  // Number taken from the serie when the row was reserved. Null only for rows written before reservations existed.
  correlativo: number | null;
};

export type ReservaDte = {
  ticketId: string;
  // Serie of the correlative, for example "03-M001P001".
  serie: string;
  tipoDte: "01" | "03";
  // Code generated before the document is built. The row keeps it, so a reserved row can be completed later.
  codigoGeneracion: string;
};

export type AlmacenDtes = {
  porTicket(ticketId: string): Promise<RegistroDte | null>;
  // Reserves the document of a ticket and returns the number taken from the serie. Returns null when the ticket
  // already has a row, and then no number is taken.
  reservar(reserva: ReservaDte): Promise<number | null>;
  // Writes the document into the reserved row (matched by codigoGeneracion). False when the row is not reserved any more.
  completar(registro: RegistroDte): Promise<boolean>;
};

export type ConfigDtesSupabase = { url: string; clave: string; fetch?: typeof fetch };

const ID_TICKET = /^TK-\d{8}-[0-9A-F]{4}$/;
const CODIGO = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;

type FilaDte = {
  codigo_generacion: string;
  ticket_id: string;
  tipo_dte: "01" | "03";
  numero_control: string;
  ambiente: "00" | "01";
  estado: EstadoDte;
  sello: string | null;
  motivo: string | null;
  documento: unknown;
  creado_en: string;
  correlativo: number | null;
};

function desdeFila(f: FilaDte): RegistroDte {
  return {
    codigoGeneracion: f.codigo_generacion,
    ticketId: f.ticket_id,
    tipoDte: f.tipo_dte,
    numeroControl: f.numero_control,
    ambiente: f.ambiente,
    estado: f.estado,
    sello: f.sello,
    motivo: f.motivo,
    documento: f.documento,
    creado: f.creado_en,
    correlativo: f.correlativo,
  };
}

export function createAlmacenDtesSupabase(config: ConfigDtesSupabase): AlmacenDtes {
  const base = `${config.url.replace(/\/+$/, "")}/rest/v1`;
  const f = config.fetch ?? fetch;
  const cabeceras = { apikey: config.clave, authorization: `Bearer ${config.clave}`, accept: "application/json" };

  async function pedir(ruta: string, init: RequestInit, descripcion: string): Promise<Response> {
    try {
      return await f(`${base}${ruta}`, { ...init, headers: { ...cabeceras, ...(init.headers as Record<string, string>) }, cache: "no-store" });
    } catch {
      throw new ErrorLedger(`No se pudo conectar con la base de documentos (${descripcion}).`);
    }
  }

  return {
    async porTicket(ticketId: string): Promise<RegistroDte | null> {
      if (!ID_TICKET.test(ticketId)) return null;
      const q = new URLSearchParams({ select: "*", ticket_id: `eq.${ticketId}`, limit: "1" });
      const r = await pedir(`/ledger_dtes?${q}`, {}, "lectura");
      if (!r.ok) throw new ErrorLedger(`No se pudo leer el documento del ticket ${ticketId} (HTTP ${r.status}).`);
      const lista = (await r.json()) as FilaDte[];
      return lista[0] ? desdeFila(lista[0]) : null;
    },

    async reservar(reserva: ReservaDte): Promise<number | null> {
      if (!ID_TICKET.test(reserva.ticketId) || !CODIGO.test(reserva.codigoGeneracion)) {
        throw new ErrorLedger("La reserva del documento no tiene un ticket o un código válidos.");
      }
      const r = await pedir(
        "/rpc/ledger_reservar_dte",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            p_ticket: reserva.ticketId,
            p_serie: reserva.serie,
            p_tipo: reserva.tipoDte,
            p_codigo: reserva.codigoGeneracion,
          }),
        },
        "reserva",
      );
      if (!r.ok) throw new ErrorLedger(`No se pudo reservar el documento del ticket ${reserva.ticketId} (HTTP ${r.status}).`);
      const numero = (await r.json()) as unknown;
      if (numero === null) return null;
      if (typeof numero !== "number" || !Number.isSafeInteger(numero) || numero < 1) {
        throw new ErrorLedger(`La base devolvió un correlativo inválido para la serie ${reserva.serie}.`);
      }
      return numero;
    },

    async completar(registro: RegistroDte): Promise<boolean> {
      // Only a reserved row is written: a second completion matches no row and changes nothing.
      const q = new URLSearchParams({ codigo_generacion: `eq.${registro.codigoGeneracion}`, estado: "eq.reservado" });
      const r = await pedir(
        `/ledger_dtes?${q}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json", prefer: "return=representation" },
          body: JSON.stringify({
            numero_control: registro.numeroControl,
            estado: registro.estado,
            sello: registro.sello,
            motivo: registro.motivo,
            documento: registro.documento,
            creado_en: registro.creado,
          }),
        },
        "guardar",
      );
      // 409 is the unique index on numero_control: another row already holds that number.
      if (r.status === 409) throw new ErrorLedger(`El número de control ${registro.numeroControl} ya está en otro documento.`);
      if (!r.ok) throw new ErrorLedger(`No se pudo guardar el documento del ticket ${registro.ticketId} (HTTP ${r.status}).`);
      const filas = (await r.json()) as unknown[];
      return filas.length > 0;
    },
  };
}
