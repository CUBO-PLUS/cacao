"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { centavosDesdeTexto } from "../../../src/dinero.ts";
import { ErrorLedger } from "../../../src/errores.ts";
import { validarEntrada } from "../../../src/ticket.ts";
import { registrarVentaEfectivo } from "../../../src/venta-efectivo.ts";
import { almacenDeEntorno, almacenDtesDeEntorno } from "../../../src/servidor/configuracion.ts";
import { MENSAJE_SUSPENDIDO, puedeEmitir } from "../../../src/planes.ts";
import { estadoParaEmitir } from "../../../src/servidor/planes.ts";
import { accesoDeDueno, sesionActual } from "../../../src/servidor/sesion.ts";
import { opcionesDeEmision } from "../../../src/servidor/simulacion.ts";

// "Registrar venta" on the web: a cash sale the owner marks by hand. Owner only, checked here as well as on the page.
// The entry goes through the same rules as the CLI's ticket file (validarEntrada). The document goes through the same
// emission path as the other sales.

export type EstadoVenta = { error: string | null };

function texto(formulario: FormData, campo: string): string {
  return String(formulario.get(campo) ?? "").trim();
}

export async function registrarVentaAccion(_anterior: EstadoVenta, formulario: FormData): Promise<EstadoVenta> {
  if (!(await accesoDeDueno("/tickets/nueva"))) return { error: "Esta cuenta no puede registrar ventas." };
  // A plan unpaid past its grace period pauses new hand-entered sales (src/planes.ts). Never on a read failure.
  const sesion = await sesionActual();
  if (sesion && !puedeEmitir(await estadoParaEmitir(sesion.usuario.id))) return { error: MENSAJE_SUSPENDIDO };
  let destino: string;
  try {
    const cliente = texto(formulario, "cliente") === "contribuyente" ? "contribuyente" : "consumidor";
    const precio = centavosDesdeTexto(texto(formulario, "precio"));
    const receptor =
      cliente === "contribuyente"
        ? {
            nombre: texto(formulario, "nombre"),
            nit: texto(formulario, "nit"),
            nrc: texto(formulario, "nrc"),
            codActividad: texto(formulario, "codActividad"),
            descActividad: texto(formulario, "descActividad"),
            direccion: {
              departamento: texto(formulario, "departamento"),
              municipio: texto(formulario, "municipio"),
              distrito: texto(formulario, "distrito"),
              complemento: texto(formulario, "complemento"),
            },
          }
        : undefined;
    const entrada = validarEntrada({
      cliente,
      receptor,
      lineas: [{ descripcion: texto(formulario, "concepto"), cantidad: 1, precioCentavos: precio }],
    });
    const ahora = new Date();
    const resultado = await registrarVentaEfectivo(almacenDeEntorno(), almacenDtesDeEntorno(), entrada, texto(formulario, "envio"), {
      ...(await opcionesDeEmision(ahora)),
      ahora,
    });
    destino = `/tickets/${resultado.ticket.id}`;
  } catch (e) {
    console.error("La venta en efectivo no se registró:", e);
    return { error: e instanceof ErrorLedger ? e.message : "No se pudo registrar la venta. Intentá de nuevo." };
  }
  revalidatePath("/tickets");
  revalidatePath("/");
  redirect(destino);
}
