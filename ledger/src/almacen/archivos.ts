import { ErrorLedger } from "../errores.ts";
import { buscarTicket, guardarTicket, listarTickets, productoDeTicket, type Ticket } from "../ticket.ts";
import {
  limiteDe,
  textoBuscable,
  textoDeBusqueda,
  validarInstante,
  type AlmacenTickets,
  type FiltrosTickets,
} from "./tipos.ts";

// The CLI's storage: one JSON file per ticket under <datos>/tickets/. The same rules as supabase.ts:
// a second ticket with the same origin or the same payment hash is refused with DUPLICADO.
export function almacenArchivos(datos: string): AlmacenTickets {
  const todos = (): Ticket[] => listarTickets(datos);

  return {
    async guardar(t: Ticket): Promise<void> {
      const otros = todos().filter((o) => o.id !== t.id);
      if (t.origen) {
        const igual = otros.find((o) => o.origen?.plataforma === t.origen?.plataforma && o.origen?.numero === t.origen?.numero);
        if (igual) {
          throw new ErrorLedger(`DUPLICADO: el origen ${t.origen.plataforma} ${t.origen.numero} ya está en el ticket ${igual.id}.`);
        }
      }
      if (t.pago?.rail === "lightning") {
        const hash = t.pago.paymentHash;
        const igual = otros.find((o) => o.pago?.rail === "lightning" && o.pago.paymentHash === hash);
        if (igual) throw new ErrorLedger(`DUPLICADO: el pago ya cubre el ticket ${igual.id}.`);
      }
      guardarTicket(datos, t);
    },

    async porId(id: string): Promise<Ticket | null> {
      return buscarTicket(datos, id);
    },

    async porOrigen(plataforma: string, numero: string): Promise<Ticket | null> {
      return todos().find((t) => t.origen?.plataforma === plataforma && t.origen.numero === numero) ?? null;
    },

    async porHash(hash: string): Promise<Ticket | null> {
      return todos().find((t) => t.pago?.rail === "lightning" && t.pago.paymentHash === hash) ?? null;
    },

    async listar(f?: FiltrosTickets): Promise<Ticket[]> {
      const limite = limiteDe(f);
      const texto = textoDeBusqueda(f?.texto);
      const despues = validarInstante(f?.despues, "despues");
      const desde = f?.desde?.getTime();
      const hasta = f?.hasta?.getTime();
      return todos()
        .filter((t) => {
          const creado = new Date(t.creado).getTime();
          if (desde !== undefined && creado < desde) return false;
          if (hasta !== undefined && creado >= hasta) return false;
          if (despues !== undefined) {
            const corte = new Date(despues).getTime();
            // Same instant: only the ids before the cursor, in the same order as the list (creado desc, id desc).
            const antes = creado < corte || (creado === corte && f?.despuesId !== undefined && t.id < f.despuesId);
            if (!antes) return false;
          }
          if (f?.producto !== undefined && productoDeTicket(t) !== f.producto) return false;
          if (f?.estado !== undefined && t.estado !== f.estado) return false;
          if (texto !== "" && !textoBuscable(t).includes(texto)) return false;
          return true;
        })
        .sort((a, b) => (a.creado < b.creado ? 1 : a.creado > b.creado ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
        .slice(0, limite);
    },
  };
}
