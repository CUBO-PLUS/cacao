import type { AlmacenTickets, FiltrosTickets } from "./tipos.ts";
import type { AlmacenDtes, RegistroDte, ReservaDte } from "./dtes.ts";
import type { Ticket } from "../ticket.ts";

// In-memory stores with the rules of the database versions. The tests use them; nothing in the app does.

export function almacenTicketsMemoria(): AlmacenTickets & { tickets: Map<string, Ticket> } {
  const tickets = new Map<string, Ticket>();
  return {
    tickets,
    async guardar(t: Ticket) {
      tickets.set(t.id, t);
    },
    async porId(id: string) {
      return tickets.get(id) ?? null;
    },
    async porOrigen() {
      return null;
    },
    async porHash() {
      return null;
    },
    async listar(f?: FiltrosTickets) {
      return [...tickets.values()].filter((t) => f?.estado === undefined || t.estado === f.estado).slice(0, f?.limite ?? 50);
    },
  };
}

export function almacenDtesMemoria(): AlmacenDtes & { filas: Map<string, RegistroDte> } {
  const filas = new Map<string, RegistroDte>();
  const tomados: Record<string, number> = {};
  return {
    filas,
    async porTicket(id: string) {
      return filas.get(id) ?? null;
    },
    async reservar(reserva: ReservaDte) {
      if (filas.has(reserva.ticketId)) return null;
      tomados[reserva.serie] = (tomados[reserva.serie] ?? 0) + 1;
      const numero = tomados[reserva.serie] ?? 1;
      filas.set(reserva.ticketId, {
        codigoGeneracion: reserva.codigoGeneracion,
        ticketId: reserva.ticketId,
        tipoDte: reserva.tipoDte,
        numeroControl: `RESERVADO-${reserva.codigoGeneracion}`,
        ambiente: "00",
        estado: "reservado",
        sello: null,
        motivo: null,
        documento: {},
        creado: new Date(0).toISOString(),
        correlativo: numero,
      });
      return numero;
    },
    async completar(registro: RegistroDte) {
      const previa = [...filas.values()].find((f) => f.codigoGeneracion === registro.codigoGeneracion);
      if (!previa || previa.estado !== "reservado") return false;
      filas.set(previa.ticketId, { ...registro, correlativo: previa.correlativo });
      return true;
    },
    async reabrir(ticketId: string, codigo: string) {
      const fila = filas.get(ticketId);
      if (!fila || fila.estado !== "rechazado" || fila.codigoGeneracion !== codigo) return false;
      filas.set(ticketId, { ...fila, estado: "reservado", sello: null, motivo: null, documento: {} });
      return true;
    },
    async contingencias() {
      return [...filas.values()].filter((f) => f.estado === "contingencia");
    },
    async transmitirContingencia(codigo: string, sello: string, momento: string) {
      const fila = [...filas.values()].find((f) => f.codigoGeneracion === codigo);
      if (!fila || fila.estado !== "contingencia") return false;
      filas.set(fila.ticketId, { ...fila, estado: "aceptado", sello, motivo: null, creado: momento });
      return true;
    },
  };
}
