// CacaoPay notice. Pay calls it when a charge changes state; a valid signature only means "look again".
// The body is never proof of payment: the charge is read again at CacaoPay, and only "pagado" opens access.
import type { APIContext } from 'astro';
import { hayBase } from '../../../lib/servidor/bd';
import { abrirAccesoPagoPay, cobroDePay, sinGuardar } from '../../../lib/servidor/cobros';
import {
  AvisosVistos,
  avisoPayValido,
  configPay,
  facturaIdDePay,
  leerAvisoPay,
  leerCobroPay,
  procesarAvisoPay,
} from '../../../lib/servidor/pay';

export const prerender = false;

const CABECERA_FIRMA = 'Cacao-Firma';
const CABECERA_AVISO = 'Cacao-Aviso-Id';
const avisosVistos = new AvisosVistos();

export async function POST(context: APIContext) {
  // The signature covers the raw bytes, so read the text before anything parses it.
  const cuerpo = await context.request.text();
  const pay = configPay();
  if (!pay || !pay.avisoSecreto || !hayBase()) {
    return Response.json({ error: 'Los avisos no están disponibles en este momento.' }, { status: 503, headers: sinGuardar });
  }
  if (!avisoPayValido(context.request.headers.get(CABECERA_FIRMA), cuerpo, pay.avisoSecreto)) {
    return Response.json({ error: 'Firma inválida.' }, { status: 401, headers: sinGuardar });
  }

  const avisoId = context.request.headers.get(CABECERA_AVISO) ?? '';
  const datos = leerAvisoPay(cuerpo);
  if (!datos || datos.aviso !== avisoId) {
    return Response.json({ error: 'Aviso inválido.' }, { status: 400, headers: sinGuardar });
  }

  try {
    const resultado = await procesarAvisoPay(avisoId, datos, {
      avisos: avisosVistos,
      cobroLocal: async (payId) => {
        const facturaId = facturaIdDePay(payId);
        return facturaId ? cobroDePay(facturaId) : null;
      },
      leerPay: (payId) => leerCobroPay(pay, payId),
      pagar: async (cobro) => ((await abrirAccesoPagoPay(cobro)) ? 'pagado' : 'sin-cambio'),
    });
    return Response.json({ resultado }, { headers: sinGuardar });
  } catch (error) {
    // CacaoPay could not be read or the database failed: answer 502 so CacaoPay sends the notice again.
    console.error(error);
    return Response.json({ error: 'CacaoPay no respondió.' }, { status: 502, headers: sinGuardar });
  }
}
