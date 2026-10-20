'use server';

import { revalidatePath } from 'next/cache';

import type { AccionEnvio } from '@/lib/transferencias';
import { cobroDeEnvio, estadoDeCobro, marcarCobroFallido } from '@/servidor/cobro';
import type { Resultado } from '@/servidor/resultado';
import { exigirAdmin } from '@/servidor/sesion';
import { procesarEnvio, simularCompletar, simularFallar, type CambioEnvio } from '@/servidor/transferencias';

export type EstadoAccion = { ok?: boolean; mensaje?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCIONES_ADMIN: AccionEnvio[] = ['procesar', 'completar', 'fallar'];

const LISTO: Record<'procesar' | 'completar' | 'fallar', string> = {
  procesar: 'Listo: el envío va en camino.',
  completar: 'Listo: el envío quedó como entregado.',
  fallar: 'Listo: el envío quedó como fallido.',
};

// One action for the three buttons. The server layer checks the state and the administrator flag
// again, so a stale page cannot move a transfer twice.
export async function ejecutarAccion(previo: EstadoAccion, datos: FormData): Promise<EstadoAccion> {
  const sesion = await exigirAdmin('/monitor/envios');
  const envioId = String(datos.get('envio') ?? '');
  const accion = String(datos.get('accion') ?? '') as AccionEnvio;
  if (!UUID.test(envioId) || !ACCIONES_ADMIN.includes(accion)) {
    return { ok: false, mensaje: 'No pudimos hacer esa acción. Recargá la página y probá de nuevo.' };
  }

  const actor = { id: sesion.usuario.id, esAdmin: true };
  let resultado: Resultado<CambioEnvio>;
  if (accion === 'procesar') {
    resultado = await procesarEnvio(actor.id, envioId);
  } else if (accion === 'completar') {
    resultado = await simularCompletar(actor, envioId);
  } else {
    resultado = await simularFallar(actor, envioId, String(datos.get('motivo') ?? ''));
  }

  if (!resultado.ok) return { ok: false, mensaje: resultado.mensaje };
  // The list, the detail and the summary all show the state, so every monitor page is read again.
  revalidatePath('/monitor', 'layout');
  return { ok: true, mensaje: LISTO[accion as 'procesar' | 'completar' | 'fallar'] };
}

const ACCIONES_COBRO = ['revisar', 'fallar'] as const;
type AccionCobro = (typeof ACCIONES_COBRO)[number];

const MENSAJE_SIN_COBRO = 'Este envío no tiene un cobro por Lightning.';

// The two actions on a claim that is stuck in "pagando". "Revisar" asks BTCPay for the payment and closes
// the claim if BTCPay has an answer. "Marcar como fallido" closes it by hand; the reason is shown to the
// person who claims. Both need the administrator, and both read the claim token from the database.
export async function ejecutarAccionCobro(previo: EstadoAccion, datos: FormData): Promise<EstadoAccion> {
  await exigirAdmin('/monitor/envios');
  const envioId = String(datos.get('envio') ?? '');
  const accion = String(datos.get('accion') ?? '') as AccionCobro;
  if (!UUID.test(envioId) || !ACCIONES_COBRO.includes(accion)) {
    return { ok: false, mensaje: 'No pudimos hacer esa acción. Recargá la página y probá de nuevo.' };
  }

  const cobro = await cobroDeEnvio(envioId);
  if (!cobro?.token) return { ok: false, mensaje: MENSAJE_SIN_COBRO };

  if (accion === 'revisar') {
    const resultado = await estadoDeCobro(cobro.token);
    revalidatePath('/monitor', 'layout');
    if (!resultado.ok) return { ok: false, mensaje: resultado.mensaje };
    const estado = resultado.dato.cobroEstado;
    if (estado === 'pagado') return { ok: true, mensaje: 'BTCPay confirmó el pago. El envío quedó entregado.' };
    if (estado === 'fallido') return { ok: true, mensaje: 'BTCPay rechazó la factura. Quien cobra puede pedir otra.' };
    return { ok: true, mensaje: 'BTCPay todavía no responde por esta factura. El cobro sigue en curso.' };
  }

  const motivo = String(datos.get('motivo') ?? '');
  const resultado = await marcarCobroFallido(cobro.token, motivo);
  revalidatePath('/monitor', 'layout');
  if (!resultado.ok) return { ok: false, mensaje: resultado.mensaje };
  if (resultado.dato.estado === 'pagado') {
    return { ok: true, mensaje: 'BTCPay confirmó el pago. El envío quedó entregado.' };
  }
  return { ok: true, mensaje: 'Marcamos el cobro como fallido. Quien cobra puede pedir otra factura.' };
}
