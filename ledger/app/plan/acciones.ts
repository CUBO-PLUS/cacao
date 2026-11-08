"use server";

import { revalidatePath } from "next/cache";

import { ErrorLedger } from "../../src/errores.ts";
import { esPlan } from "../../src/planes.ts";
import { elegirPlan } from "../../src/servidor/planes.ts";
import { accesoDeDueno, sesionActual } from "../../src/servidor/sesion.ts";

export type EstadoElegir = { error: string | null };

// "Elegir este plan": owner only, checked here as well as on the page.
export async function elegirPlanAccion(_anterior: EstadoElegir, formulario: FormData): Promise<EstadoElegir> {
  if (!(await accesoDeDueno("/plan"))) return { error: "Esta cuenta no puede elegir un plan." };
  const plan = formulario.get("plan");
  if (!esPlan(plan)) return { error: "Ese plan no existe." };
  const sesion = await sesionActual();
  if (!sesion) return { error: "Entrá de nuevo para elegir el plan." };
  try {
    await elegirPlan(sesion.usuario.id, plan);
  } catch (e) {
    console.error("El plan no se guardó:", e);
    return { error: e instanceof ErrorLedger ? e.message : "No se pudo guardar el plan. Intentá de nuevo." };
  }
  revalidatePath("/plan");
  revalidatePath("/");
  return { error: null };
}
