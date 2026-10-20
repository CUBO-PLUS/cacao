import { connection } from "next/server";

import { autorizado, sincronizarSiHaceFalta } from "../../../src/servidor/sincronizacion.ts";

// Daily sync for Vercel Cron (vercel.json). Requires "Authorization: Bearer <CRON_SECRET>". Always runs BTCPay
// (no throttle) and waits for it to finish, since nobody is waiting on a page. A run already in progress is
// reported as enCurso and not started twice.
export async function GET(request: Request) {
  await connection();
  const secreto = process.env.CRON_SECRET;
  if (!secreto) {
    return Response.json({ error: "El servidor no tiene CRON_SECRET configurado." }, { status: 503 });
  }
  if (!autorizado(request.headers.get("authorization"), secreto)) {
    return Response.json({ error: "No autorizado." }, { status: 401 });
  }

  const estado = await sincronizarSiHaceFalta({ umbralMs: 0, limiteMs: null });
  return Response.json(
    {
      ok: estado.error === null && !estado.enCurso,
      corrio: estado.corrio,
      enCurso: estado.enCurso,
      nuevas: estado.nuevas,
      emitidos: estado.emitidos,
      rechazados: estado.rechazados,
      ultima: estado.ultima?.toISOString() ?? null,
      error: estado.error,
      // Only the cron caller holds the secret; the cause is for the server log and for it.
      detalle: estado.detalle,
    },
    { status: estado.error === null ? (estado.enCurso ? 202 : 200) : 502 },
  );
}
