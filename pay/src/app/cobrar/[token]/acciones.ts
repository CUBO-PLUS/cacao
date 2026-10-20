'use server';

// Actions of the claim page. Nobody signs in to claim: the token in the link is the only key, and the
// server checks it again. The browser only sends the token and the pasted invoice; it never reports a payment.

import { cobrarEnvio, estadoDeCobro, type EstadoCobroEnvio, type ResultadoCobrar } from '@/servidor/cobro';
import type { Resultado } from '@/servidor/resultado';

/** Pays the transfer to the recipient's invoice. Returns the outcome the server recorded. */
export async function cobrarAccion(token: string, factura: string): Promise<Resultado<ResultadoCobrar>> {
  return cobrarEnvio(token, factura);
}

/** The claim state, read while a payment is pending. Closes the claim when BTCPay has the answer. */
export async function estadoCobroAccion(token: string): Promise<Resultado<{ cobroEstado: EstadoCobroEnvio | null }>> {
  return estadoDeCobro(token);
}
