"use server";

import { verificarCadenaFilas, type ResultadoCadena } from "../../../src/almacen/atestaciones.ts";
import { ErrorLedger } from "../../../src/errores.ts";
import { almacenAtestacionesDeEntorno } from "../../../src/servidor/configuracion.ts";
import { accesoDeDueno } from "../../../src/servidor/sesion.ts";

// "Verificar cadena": reads the whole chain and recomputes every hash from its stored content. Owner only.
// It answers with the result only: nothing is written.

export type EstadoVerificacion = { resultado: ResultadoCadena | null; error: string | null };

export async function verificarCadenaAccion(): Promise<EstadoVerificacion> {
  if (!(await accesoDeDueno("/tickets"))) return { resultado: null, error: "Esta cuenta no puede verificar la cadena." };
  try {
    const filas = await almacenAtestacionesDeEntorno().cadena();
    return { resultado: verificarCadenaFilas(filas), error: null };
  } catch (e) {
    console.error("La verificación de la cadena falló:", e);
    return { resultado: null, error: e instanceof ErrorLedger ? e.message : "No se pudo verificar la cadena." };
  }
}
