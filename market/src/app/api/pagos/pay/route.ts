import 'server-only';

import { AvisosVistos, avisoPayValido, configDesdeEntornoPay, leerAvisoPay, leerCobroPay, procesarAvisoPay, referenciaDePay } from '@/lib/pagos/pay-api';
import { confirmarPagoEnBD } from '@/servidor/pagos';
import { clienteServicio } from '@/servidor/supabase';

// CacaoPay calls this when one of this client's charges changes state (pay/docs/api.md, section 7). The Cacao-Firma
// signature only proves that CacaoPay sent the body, and even a signed body is treated as "look again": the charge is
// read back from CacaoPay before anything is paid. A bad signature answers 401. A 502 (CacaoPay or the database could
// not answer) makes CacaoPay send the notice again; every other answer is final. This route is a POST, never cached.

const CABECERA_FIRMA = 'Cacao-Firma';
const CABECERA_AVISO = 'Cacao-Aviso-Id';
// Outcomes the database already reached: a repeated notice, or a payment that came after the deadline.
const YA_RESUELTO = /^(ESTADO_INVALIDO|FUERA_DE_PLAZO)/;

const avisosVistos = new AvisosVistos();

export async function POST(peticion: Request): Promise<Response> {
  // The raw text is what was signed; parsing it first would change the bytes.
  const cuerpo = await peticion.text();
  const pay = configDesdeEntornoPay(process.env);
  if (!pay || !pay.avisoSecreto) {
    console.error('cacaopay aviso: falta CACAO_PAY_URL, CACAO_PAY_API_KEY o CACAO_PAY_AVISO_SECRET');
    return new Response(null, { status: 503 });
  }
  if (!avisoPayValido(peticion.headers.get(CABECERA_FIRMA), cuerpo, pay.avisoSecreto)) {
    return new Response(null, { status: 401 });
  }

  const avisoId = peticion.headers.get(CABECERA_AVISO) ?? '';
  const datos = leerAvisoPay(cuerpo);
  if (datos === null || datos.aviso !== avisoId) return new Response(null, { status: 400 });

  try {
    await procesarAvisoPay(avisoId, datos, {
      avisos: avisosVistos,
      cobroLocal: async (payId) => {
        const { data, error } = await clienteServicio()
          .from('cobros')
          .select('orden_id, estado')
          .eq('proveedor', 'btcpay')
          .eq('referencia_externa', referenciaDePay(payId))
          .maybeSingle();
        if (error) throw error;
        return data;
      },
      leerPay: (payId) => leerCobroPay(pay, payId),
      pagar: async (cobro) => {
        // Same confirmation as the payment screen's poll: one function, one funnel event.
        const error = await confirmarPagoEnBD(cobro.orden_id, null, null);
        if (error === null) return 'pagado';
        if (YA_RESUELTO.test(error.message)) return 'sin-cambio';
        throw new Error(error.message);
      },
    });
  } catch (error) {
    console.error('cacaopay aviso:', error instanceof Error ? error.message : error);
    return new Response(null, { status: 502 });
  }
  return new Response(null, { status: 200 });
}
