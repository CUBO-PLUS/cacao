"use server";

import { revalidatePath } from "next/cache";

import { sesionActual } from "../src/servidor/sesion.ts";
import { sincronizarSiHaceFalta } from "../src/servidor/sincronizacion.ts";

// The "Sincronizar ahora" button. Owner only: the action checks the session itself, since a form post can come from
// anywhere. The throttle is 10 seconds instead of 60, and a run in progress is reported, not started twice.

export type EstadoAccionSincronizar = {
  mensaje: string | null;
  error: string | null;
};

export async function sincronizarAhora(
  _anterior: EstadoAccionSincronizar,
  _formulario: FormData,
): Promise<EstadoAccionSincronizar> {
  const sesion = await sesionActual();
  if (!sesion || !sesion.usuario.esAdmin) {
    return { mensaje: null, error: "Esta cuenta no puede sincronizar el libro." };
  }

  const estado = await sincronizarSiHaceFalta({ umbralMs: 10_000 });
  revalidatePath("/", "layout");
  if (estado.enCurso) return { mensaje: "Ya hay una sincronización en curso. Probá en un minuto.", error: null };
  if (estado.error !== null) {
    // The owner gets the cause; the generic line goes first.
    return { mensaje: null, error: estado.detalle ? `${estado.error} Motivo: ${estado.detalle}` : estado.error };
  }
  if (!estado.corrio) return { mensaje: "Ya estaba al día: se revisó hace unos segundos.", error: null };
  const emision = estado.emitidos > 0 ? ` Se emitieron ${estado.emitidos} documentos.` : "";
  if (estado.nuevas === 0) return { mensaje: `Listo: no hubo ventas nuevas.${emision}`, error: null };
  return { mensaje: `Listo: entraron ${estado.nuevas} ventas nuevas.${emision}`, error: null };
}
