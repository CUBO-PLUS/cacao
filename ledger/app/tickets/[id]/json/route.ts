import { connection } from "next/server";

import { almacenDeEntorno, almacenDtesDeEntorno } from "../../../../src/servidor/configuracion.ts";
import { vistaDte } from "../../../../src/servidor/vista-dte.ts";

// The document of one ticket as JSON: the one the web emitted (ledger_dtes) when there is one, otherwise the
// preview the ticket page shows, built on the fly.
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
  if (!FORMATO_ID.test(id)) return error("No existe ese ticket.", 404);

  let ticket;
  try {
    ticket = await almacenDeEntorno().porId(id);
  } catch (e) {
    console.error(`El JSON del ticket ${id} no pudo leer la base:`, e);
    return error("No se pudo leer los datos.", 503);
  }
  if (ticket === null) return error("No existe ese ticket.", 404);

  let registro;
  try {
    registro = await almacenDtesDeEntorno().porTicket(id);
  } catch (e) {
    console.error(`El documento del ticket ${id} no pudo leerse:`, e);
    return error("No se pudo leer los datos.", 503);
  }
  if (registro !== null) {
    if (Object.keys(registro.documento as object).length === 0) {
      return error("Este ticket no tiene documento: no se pudo armar.", 409);
    }
    return enviar(registro.documento, registro.numeroControl);
  }

  const vista = vistaDte(ticket);
  if (!vista.ok) return error(vista.motivo, 409);
  return enviar(vista.resultado.documento, vista.resultado.numeroControl);
}
