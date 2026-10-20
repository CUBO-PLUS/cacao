import type { Entrega } from './cotizacion';
import { enmascararContacto } from './transferencias';

// The people the sender has already sent money to, for one-tap choices in step 2. Pure: the server
// reads the rows, this keeps the newest one per contact.

export type RecienteDestinatario = {
  nombre: string;
  /** The full contact, as the sender typed it. Only ever sent back to that same sender. */
  contacto: string;
  /** "•••• ••07" or "ma•••@gmail.com", for the chip. */
  contactoEnmascarado: string;
  /** How the last transfer to this person was delivered. */
  entrega: Entrega;
};

export type FilaReciente = {
  nombre: string;
  contacto: string;
  entrega: Entrega;
};

/**
 * Distinct recipients by contact, newest first. The rows come newest first, so the first one kept for a
 * contact is its latest transfer (name and delivery). At most `limite` people.
 */
export function distintosRecientes(filas: FilaReciente[], limite = 6): RecienteDestinatario[] {
  const vistos = new Set<string>();
  const salida: RecienteDestinatario[] = [];
  for (const fila of filas) {
    const clave = fila.contacto.trim().toLowerCase();
    if (!clave || vistos.has(clave)) continue;
    vistos.add(clave);
    salida.push({
      nombre: fila.nombre,
      contacto: fila.contacto,
      contactoEnmascarado: enmascararContacto(fila.contacto),
      entrega: fila.entrega,
    });
    if (salida.length >= limite) break;
  }
  return salida;
}
