"use server";

import { revalidatePath } from "next/cache";

import { sincronizarSiHaceFalta } from "../src/servidor/sincronizacion.ts";

// The "Sincronizar ahora" button. Anyone may press it; the throttle is 10 seconds instead of 60, so a
// second press right after a run does nothing. The dashboard is rendered again with the new state.

export type EstadoAccionSincronizar = {
  mensaje: string | null;
  error: string | null;
};

export async function sincronizarAhora(
  _anterior: EstadoAccionSincronizar,
  _formulario: FormData,
): Promise<EstadoAccionSincronizar> {
  const estado = await sincronizarSiHaceFalta({ umbralMs: 10_000 });
  revalidatePath("/", "layout");
  if (estado.error !== null) return { mensaje: null, error: estado.error };
  if (!estado.corrio) return { mensaje: "Ya estaba al día: se revisó hace unos segundos.", error: null };
  const emision = estado.emitidos > 0 ? ` Se emitieron ${estado.emitidos} documentos.` : "";
  if (estado.nuevas === 0) return { mensaje: `Listo: no hubo ventas nuevas.${emision}`, error: null };
  return { mensaje: `Listo: entraron ${estado.nuevas} ventas nuevas.${emision}`, error: null };
}
