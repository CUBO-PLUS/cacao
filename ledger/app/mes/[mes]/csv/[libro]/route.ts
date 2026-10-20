import { connection } from "next/server";

import { almacenDeEntorno } from "../../../../../src/servidor/configuracion.ts";
import { respuestaSinAcceso } from "../../../../../src/servidor/sesion.ts";
import { informeDelMes } from "../../../../../src/servidor/informe.ts";
import { esMes } from "../../../../../src/servidor/tiempo-sv.ts";
import {
  anexoConsumidorF07Csv,
  anexoContribuyentesF07Csv,
  libroConsumidorCsv,
  libroContribuyentesCsv,
  nombresLibros,
  type InformeMes,
} from "../../../../../src/mes.ts";

// The four CSV files of a month, the same builders the CLI writes with `mes --csv`.
const LIBROS: Record<string, { construir: (informe: InformeMes) => string; clave: keyof ReturnType<typeof nombresLibros> }> = {
  consumidor: { construir: libroConsumidorCsv, clave: "consumidor" },
  contribuyentes: { construir: libroContribuyentesCsv, clave: "contribuyentes" },
  anexo1: { construir: anexoContribuyentesF07Csv, clave: "anexo1" },
  anexo2: { construir: anexoConsumidorF07Csv, clave: "anexo2" },
};

function error(mensaje: string, estado: number): Response {
  return Response.json({ error: mensaje }, { status: estado });
}

export async function GET(_request: Request, { params }: { params: Promise<{ mes: string; libro: string }> }) {
  await connection();
  const { mes, libro } = await params;
  // Owner only, before the ledger is read.
  const sinAcceso = await respuestaSinAcceso(`/mes/${mes}`);
  if (sinAcceso) return sinAcceso;
  // Own keys only: a name such as "constructor" must not reach the prototype.
  const elegido = Object.hasOwn(LIBROS, libro) ? LIBROS[libro] : undefined;
  if (!esMes(mes) || elegido === undefined) return error("No existe ese archivo.", 404);

  let informe: InformeMes;
  try {
    informe = await informeDelMes(almacenDeEntorno(), mes);
  } catch (e) {
    console.error(`El CSV de ${mes} no pudo leer la base:`, e);
    return error("No se pudo leer los datos.", 503);
  }

  const nombre = nombresLibros(mes)[elegido.clave];
  return new Response(elegido.construir(informe), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${nombre}"`,
    },
  });
}
