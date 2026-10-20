import { connection } from "next/server";

import { almacenDtesDeEntorno } from "../../../../src/servidor/configuracion.ts";
import { respuestaSinAcceso } from "../../../../src/servidor/sesion.ts";

// The document of one ticket as JSON: the one the web emitted (ledger_dtes). Owner only.
// No stored row means no document: 404. A row still reserved, or one without a built document, is 409.
// No preview is offered as a download: a preview has no number from the books.
const FORMATO_ID = /^TK-\d{8}-[0-9A-F]{4}$/;

function enviar(documento: unknown, numeroControl: string): Response {
  const cuerpo = `${JSON.stringify(documento, null, 2)}\n`;
  return new Response(cuerpo, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${numeroControl}.json"`,
    },
  });
}

function error(mensaje: string, estado: number): Response {
  return Response.json({ error: mensaje }, { status: estado });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const sinAcceso = await respuestaSinAcceso(`/tickets/${id}/json`);
  if (sinAcceso) return sinAcceso;
  if (!FORMATO_ID.test(id)) return error("No existe ese documento.", 404);

  let registro;
  try {
    registro = await almacenDtesDeEntorno().porTicket(id);
  } catch (e) {
    console.error(`El documento del ticket ${id} no pudo leerse:`, e);
    return error("No se pudo leer los datos.", 503);
  }
  if (registro === null) return error("Este ticket todavía no tiene un documento emitido.", 404);
  if (registro.estado === "reservado" || Object.keys(registro.documento as object).length === 0) {
    return error("Este documento todavía no está completo.", 409);
  }
  return enviar(registro.documento, registro.numeroControl);
}
