import { autorizaProcesado, LOTE_PROGRAMADO, procesarAvisos } from '@/servidor/avisos';

// Sends the due notices from pay_avisos. A scheduled caller sends "Authorization: Bearer <PAY_AVISOS_SECRET>". Without a
// secret configured, or with another one, nothing is sent and the answer is 401. Each notice is claimed, so two calls
// at the same time never send one notice twice.
async function atender(peticion: Request): Promise<Response> {
  const cabeceras = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  if (!autorizaProcesado(peticion.headers.get('authorization'))) {
    return new Response(JSON.stringify({ error: { codigo: 'NO_AUTORIZADO', mensaje: 'El secreto de los avisos falta o no es válido.' } }), {
      status: 401,
      headers: { ...cabeceras, 'www-authenticate': 'Bearer' },
    });
  }
  try {
    const resumen = await procesarAvisos(LOTE_PROGRAMADO);
    return new Response(JSON.stringify(resumen), { status: 200, headers: cabeceras });
  } catch (error) {
    console.error('Avisos programados:', error instanceof Error ? error.message : error);
    return new Response(JSON.stringify({ error: { codigo: 'ERROR', mensaje: 'No pudimos procesar los avisos.' } }), {
      status: 500,
      headers: cabeceras,
    });
  }
}

export async function GET(peticion: Request): Promise<Response> {
  return atender(peticion);
}

export async function POST(peticion: Request): Promise<Response> {
  return atender(peticion);
}
