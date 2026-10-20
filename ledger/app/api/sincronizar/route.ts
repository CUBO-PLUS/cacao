import { connection } from "next/server";

import { autorizado, sincronizarSiHaceFalta } from "../../../src/servidor/sincronizacion.ts";

// Daily sync for Vercel Cron (vercel.json). Requires "Authorization: Bearer <CRON_SECRET>". Always runs BTCPay
// (no throttle) and waits for it to finish, since nobody is waiting on a page.
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
      ok: estado.error === null,
      corrio: estado.corrio,
      nuevas: estado.nuevas,
      emitidos: estado.emitidos,
      rechazados: estado.rechazados,
      ultima: estado.ultima?.toISOString() ?? null,
      error: estado.error,
    },
    { status: estado.error === null ? 200 : 502 },
  );
}
