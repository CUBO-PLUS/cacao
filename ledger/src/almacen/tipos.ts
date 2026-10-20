import { ErrorLedger } from "../errores.ts";
import type { Ticket } from "../ticket.ts";

// Where tickets are kept. The CLI uses the JSON files (archivos.ts); the web app uses Supabase
// (supabase.ts). Both follow the same rules, so the code above them does not change.

export type FiltrosTickets = {
  // Inclusive lower bound on the creation instant.
  desde?: Date;
  // Exclusive upper bound on the creation instant.
  hasta?: Date;
  producto?: string;
  estado?: string;
  // Case-insensitive text: matched against the id, the origin number and the line descriptions.
  texto?: string;
  // Rows per page. Default 50, at most 500.
  limite?: number;
  // Keyset cursor: only tickets created strictly before this ISO-8601 instant (the creado of the last row).
  despues?: string;
};

export type AlmacenTickets = {
  guardar(t: Ticket): Promise<void>;
  porId(id: string): Promise<Ticket | null>;
  porOrigen(plataforma: string, numero: string): Promise<Ticket | null>;
  porHash(hash: string): Promise<Ticket | null>;
  listar(f?: FiltrosTickets): Promise<Ticket[]>;
};

export const LIMITE_DEFECTO = 50;
export const LIMITE_MAXIMO = 500;

// Rows per page after the defaults and the maximum apply.
export function limiteDe(f: FiltrosTickets | undefined): number {
  const l = f?.limite ?? LIMITE_DEFECTO;
  if (!Number.isSafeInteger(l) || l < 1) throw new ErrorLedger("El límite de tickets debe ser un entero mayor que cero.");
  return Math.min(l, LIMITE_MAXIMO);
}

// Removes the characters that mean something in a LIKE pattern or a PostgREST filter, and lowercases.
// Returns "" when nothing is left, which means "no text filter".
export function textoDeBusqueda(texto: string | undefined): string {
  return (texto ?? "").toLowerCase().replace(/[*%_\\,()"]/g, " ").replace(/\s+/g, " ").trim();
}

// The text the search matches, as the Supabase column "buscar" stores it.
export function textoBuscable(t: Ticket): string {
  return [t.id, t.origen?.numero ?? "", ...t.lineas.map((l) => l.descripcion)].join(" ").toLowerCase();
}

export function validarInstante(texto: string | undefined, campo: string): string | undefined {
  if (texto === undefined) return undefined;
  if (Number.isNaN(new Date(texto).getTime())) throw new ErrorLedger(`El campo ${campo} no es una fecha ISO-8601.`);
  return texto;
}

