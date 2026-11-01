"use server";

import { revalidatePath } from "next/cache";

import { reintentarEmision } from "../../../src/emitir.ts";
import { ErrorLedger } from "../../../src/errores.ts";
import { almacenDeEntorno, almacenDtesDeEntorno } from "../../../src/servidor/configuracion.ts";
import { accesoDeDueno } from "../../../src/servidor/sesion.ts";
import { opcionesDeEmision } from "../../../src/servidor/simulacion.ts";

// The "Reintentar emisión" button of a refused ticket. Owner only: the action checks the session itself, since a form
// post can come from anywhere. The retry reuses the number of the refused document (src/emitir.ts).

export type EstadoReintento = {
  mensaje: string | null;
  error: string | null;
};

const FORMATO_ID = /^TK-\d{8}-[0-9A-F]{4}$/;

export async function reintentarEmisionTicket(_anterior: EstadoReintento, formulario: FormData): Promise<EstadoReintento> {
  const id = String(formulario.get("ticket") ?? "");
  if (!(await accesoDeDueno(`/tickets/${id}`))) {
    return { mensaje: null, error: "Esta cuenta no puede reintentar la emisión." };
  }
  if (!FORMATO_ID.test(id)) return { mensaje: null, error: "El ticket no es válido." };

  try {
    const ticket = await almacenDeEntorno().porId(id);
    if (ticket === null) return { mensaje: null, error: "No existe ese ticket." };
    const r = await reintentarEmision(almacenDeEntorno(), almacenDtesDeEntorno(), ticket, await opcionesDeEmision(new Date()));
    revalidatePath(`/tickets/${id}`);
    revalidatePath("/tickets");
    if (r.estado === "aceptado") return { mensaje: "Listo: el documento quedó aceptado.", error: null };
    if (r.estado === "rechazado") {
      return { mensaje: null, error: "La recepción volvió a rechazar el documento. Mirá las observaciones de arriba." };
    }
    return { mensaje: null, error: "Este ticket ya no se puede reintentar: ya tiene documento o alguien lo está emitiendo." };
  } catch (e) {
    console.error(`El reintento de emisión del ticket ${id} falló:`, e);
    return { mensaje: null, error: e instanceof ErrorLedger ? e.message : "No se pudo reintentar la emisión." };
  }
}
