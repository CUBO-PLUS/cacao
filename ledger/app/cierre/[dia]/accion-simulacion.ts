"use server";

import { revalidatePath } from "next/cache";

import { retransmitirContingencias } from "../../../src/emitir.ts";
import { ErrorLedger } from "../../../src/errores.ts";
import { almacenDeEntorno, almacenDtesDeEntorno } from "../../../src/servidor/configuracion.ts";
import { accesoDeDueno } from "../../../src/servidor/sesion.ts";
import { fijarSimulacion } from "../../../src/servidor/simulacion.ts";

// The owner's demo control of the simulated outage of Hacienda. It changes only how CacaoLedger issues documents.
// Nothing is sent to the Ministry, and every answer says so. Owner only, checked here as well as on the page.

export type EstadoControl = { mensaje: string | null; error: string | null };

export async function cambiarSimulacionAccion(_anterior: EstadoControl, formulario: FormData): Promise<EstadoControl> {
  if (!(await accesoDeDueno("/cierre"))) return { mensaje: null, error: "Esta cuenta no puede cambiar la simulación." };
  const accion = String(formulario.get("accion") ?? "");
  if (accion !== "caer" && accion !== "volver") return { mensaje: null, error: "La acción de simulación no es válida." };
  const ahora = new Date();
  try {
    if (accion === "caer") {
      await fijarSimulacion(true, ahora);
      revalidatePath("/cierre", "layout");
      return { mensaje: "SIMULADO: caída de Hacienda activa. Los documentos nuevos quedan en espera, sin transmisión real.", error: null };
    }
    await fijarSimulacion(false, ahora);
    const r = await retransmitirContingencias(almacenDeEntorno(), almacenDtesDeEntorno(), { ahora });
    revalidatePath("/cierre", "layout");
    revalidatePath("/tickets");
    revalidatePath("/");
    return {
      mensaje: `SIMULADO: Hacienda volvió. Documentos transmitidos con sello simulado: ${r.transmitidos}. Sin transmitir todavía: ${r.pendientes}.`,
      error: null,
    };
  } catch (e) {
    console.error("La simulación de Hacienda no pudo cambiar:", e);
    return { mensaje: null, error: e instanceof ErrorLedger ? e.message : "No se pudo cambiar la simulación." };
  }
}
