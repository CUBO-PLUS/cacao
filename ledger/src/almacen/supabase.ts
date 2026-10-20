import { ErrorLedger } from "../errores.ts";
import type { Ticket } from "../ticket.ts";
import { limiteDe, textoDeBusqueda, validarInstante, type AlmacenTickets, type FiltrosTickets } from "./tipos.ts";

// Tickets in Supabase, through PostgREST with plain fetch. The server calls it with the service role
// key; the tables and functions come from market/supabase/migrations/20261021000002_ledger.sql.

export type ConfigSupabase = {
  // Base address of the project, for example https://xyz.supabase.co (no trailing slash needed).
  url: string;
  // Service role key. Never sent to the browser.
  clave: string;
  // Replaced in tests.
  fetch?: typeof fetch;
};

const ID_TICKET = /^TK-\d{8}-[0-9A-F]{4}$/;

export function createAlmacenSupabase(config: ConfigSupabase): AlmacenTickets {
  const base = `${config.url.replace(/\/+$/, "")}/rest/v1`;
  const f = config.fetch ?? fetch;
  const cabeceras = {
    apikey: config.clave,
    authorization: `Bearer ${config.clave}`,
    accept: "application/json",
  };

  async function pedir(metodo: string, ruta: string, cuerpo?: unknown): Promise<Response> {
    try {
      return await f(`${base}${ruta}`, {
        method: metodo,
        headers: cuerpo === undefined ? cabeceras : { ...cabeceras, "content-type": "application/json" },
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      });
    } catch {
      throw new ErrorLedger("No se pudo conectar con la base de tickets.");
    }
  }

  async function mensajeDeError(r: Response): Promise<string> {
    try {
      const j = (await r.json()) as { message?: unknown };
      return typeof j.message === "string" ? j.message : "";
    } catch {
      return "";
    }
  }

  async function filas(ruta: string, descripcion: string): Promise<Ticket[]> {
    const r = await pedir("GET", ruta);
    if (!r.ok) throw new ErrorLedger(`No se pudieron leer los tickets ${descripcion} (HTTP ${r.status}).`);
    const lista = (await r.json()) as { datos: Ticket }[];
    return lista.map((fila) => fila.datos);
  }

  async function unico(ruta: string, descripcion: string): Promise<Ticket | null> {
    const lista = await filas(ruta, descripcion);
    return lista[0] ?? null;
  }

  return {
    async guardar(t: Ticket): Promise<void> {
      const r = await pedir("POST", "/rpc/ledger_guardar_ticket", { p_ticket: t });
      if (r.ok) return;
      const mensaje = await mensajeDeError(r);
      if (mensaje.startsWith("DUPLICADO:")) throw new ErrorLedger(mensaje);
      throw new ErrorLedger(`No se pudo guardar el ticket ${t.id} (HTTP ${r.status}).`);
    },

    async porId(id: string): Promise<Ticket | null> {
      if (!ID_TICKET.test(id)) return null;
      return unico(`/ledger_tickets?select=datos&id=eq.${encodeURIComponent(id)}&limit=1`, `del ticket ${id}`);
    },

    async porOrigen(plataforma: string, numero: string): Promise<Ticket | null> {
      const q = new URLSearchParams({
        select: "datos",
        origen_plataforma: `eq.${plataforma}`,
        origen_numero: `eq.${numero}`,
        limit: "1",
      });
      return unico(`/ledger_tickets?${q}`, "por origen");
    },

    async porHash(hash: string): Promise<Ticket | null> {
      const q = new URLSearchParams({ select: "datos", payment_hash: `eq.${hash}`, limit: "1" });
      return unico(`/ledger_tickets?${q}`, "por pago");
    },

    async listar(f?: FiltrosTickets): Promise<Ticket[]> {
      const limite = limiteDe(f);
      const q = new URLSearchParams({ select: "datos", order: "creado_en.desc,id.desc", limit: String(limite) });
      if (f?.desde) q.append("creado_en", `gte.${f.desde.toISOString()}`);
      if (f?.hasta) q.append("creado_en", `lt.${f.hasta.toISOString()}`);
      const despues = validarInstante(f?.despues, "despues");
      if (despues !== undefined) {
        const corte = new Date(despues).toISOString();
        // Same instant: only the ids before the cursor (the list is creado desc, id desc).
        if (f?.despuesId !== undefined) {
          if (!ID_TICKET.test(f.despuesId)) throw new ErrorLedger("El cursor de la lista de tickets no es un ticket válido.");
          q.append("or", `(creado_en.lt.${corte},and(creado_en.eq.${corte},id.lt.${f.despuesId}))`);
        }
        else q.append("creado_en", `lt.${corte}`);
      }
      if (f?.producto !== undefined) q.append("producto", `eq.${f.producto}`);
      if (f?.estado !== undefined) q.append("estado", `eq.${f.estado}`);
      const texto = textoDeBusqueda(f?.texto);
      if (texto !== "") q.append("buscar", `ilike.*${texto}*`);
      return filas(`/ledger_tickets?${q}`, "de la lista");
    },
  };
}

