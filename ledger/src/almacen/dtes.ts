import { ErrorLedger } from "../errores.ts";

// The tax documents the web emits, one row per ticket (ledger_dtes, migration 20261021000004). The ticket
// keeps its own reference to the document (DteRef) and the seal; this table keeps the document itself.

export type RegistroDte = {
  codigoGeneracion: string;
  ticketId: string;
  tipoDte: "01" | "03";
  numeroControl: string;
  ambiente: "00" | "01";
  estado: "aceptado" | "rechazado";
  // Simulated reception seal, present exactly when the document was accepted.
  sello: string | null;
  // Observations joined with new lines, when the document was refused.
  motivo: string | null;
  // The document as built. Empty object when the ticket could not be built into a document.
  documento: unknown;
  // ISO-8601. The reception moment (or the refusal moment).
  creado: string;
};

export type AlmacenDtes = {
  porTicket(ticketId: string): Promise<RegistroDte | null>;
  // Refuses a second document for the same ticket with a readable ErrorLedger.
  insertar(registro: RegistroDte): Promise<void>;
};

export type ConfigDtesSupabase = { url: string; clave: string; fetch?: typeof fetch };

const ID_TICKET = /^TK-\d{8}-[0-9A-F]{4}$/;

type FilaDte = {
  codigo_generacion: string;
  ticket_id: string;
  tipo_dte: "01" | "03";
  numero_control: string;
  ambiente: "00" | "01";
  estado: "aceptado" | "rechazado";
  sello: string | null;
  motivo: string | null;
  documento: unknown;
  creado_en: string;
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
  };
}

export function createAlmacenDtesSupabase(config: ConfigDtesSupabase): AlmacenDtes {
  const base = `${config.url.replace(/\/+$/, "")}/rest/v1`;
  const f = config.fetch ?? fetch;
  const cabeceras = { apikey: config.clave, authorization: `Bearer ${config.clave}`, accept: "application/json" };

  return {
    async porTicket(ticketId: string): Promise<RegistroDte | null> {
      if (!ID_TICKET.test(ticketId)) return null;
      const q = new URLSearchParams({ select: "*", ticket_id: `eq.${ticketId}`, limit: "1" });
      let r: Response;
      try {
        r = await f(`${base}/ledger_dtes?${q}`, { headers: cabeceras, cache: "no-store" });
      } catch {
        throw new ErrorLedger("No se pudo conectar con la base de documentos.");
      }
      if (!r.ok) throw new ErrorLedger(`No se pudo leer el documento del ticket ${ticketId} (HTTP ${r.status}).`);
      const lista = (await r.json()) as FilaDte[];
      return lista[0] ? desdeFila(lista[0]) : null;
    },

    async insertar(registro: RegistroDte): Promise<void> {
      let r: Response;
      try {
        r = await f(`${base}/ledger_dtes`, {
          method: "POST",
          headers: { ...cabeceras, "content-type": "application/json", prefer: "return=minimal" },
          body: JSON.stringify({
            codigo_generacion: registro.codigoGeneracion,
            ticket_id: registro.ticketId,
            tipo_dte: registro.tipoDte,
            numero_control: registro.numeroControl,
            ambiente: registro.ambiente,
            estado: registro.estado,
            sello: registro.sello,
            motivo: registro.motivo,
            documento: registro.documento,
            creado_en: registro.creado,
          }),
          cache: "no-store",
        });
      } catch {
        throw new ErrorLedger("No se pudo conectar con la base de documentos.");
      }
      // 409 is the unique index on ticket_id or on numero_control: the ticket already has a document.
      if (r.status === 409) throw new ErrorLedger(`El ticket ${registro.ticketId} ya tiene un documento guardado.`);
      if (!r.ok) throw new ErrorLedger(`No se pudo guardar el documento del ticket ${registro.ticketId} (HTTP ${r.status}).`);
    },
  };
}
