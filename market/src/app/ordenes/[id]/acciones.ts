'use server';

import { revalidatePath } from 'next/cache';

import { abrirDisputa, confirmarReembolso, marcarReembolso } from '@/servidor/disputas';
import { enviarMensaje } from '@/servidor/mensajes';
import {
  cancelarOrden,
  confirmarPagoManual,
  crearResena,
  entregarConCodigo,
  esUuid,
  marcarEntregada,
  marcarHecha,
  marcarLista,
  simularEntregaDemo,
} from '@/servidor/pedidos';
import { fallo, type Resultado } from '@/servidor/resultado';
import { sesionActual } from '@/servidor/sesion';

import type { Mensaje } from '../tipos';

// Every action re-reads the session first. The server functions then check the role and state,
// so a direct request to this action cannot do more than the buttons offer.
const SIN_SESION = () => fallo('NO_SESION', 'Entrá de nuevo para seguir con la orden.');
const NO_ENCONTRADA = () => fallo('NO_ENCONTRADA', 'No encontramos esa orden.');

async function transicion(
  ordenId: string,
  operacion: (usuarioId: string) => Promise<Resultado<null>>,
): Promise<Resultado<null>> {
  // The id comes from the browser: anything that is not a UUID is not an order.
  if (!esUuid(ordenId)) return NO_ENCONTRADA();
  const sesion = await sesionActual();
  if (!sesion) return SIN_SESION();
  const resultado = await operacion(sesion.usuario.id);
  if (resultado.ok) {
    // Only after success, so the id is known to be a real order.
    revalidatePath(`/ordenes/${ordenId}`);
    revalidatePath('/ordenes');
    revalidatePath('/mi-negocio/ordenes');
  }
  return resultado;
}

export async function confirmarPago(ordenId: string): Promise<Resultado<null>> {
  return transicion(ordenId, (usuarioId) => confirmarPagoManual(ordenId, usuarioId));
}

export async function marcarOrdenLista(ordenId: string): Promise<Resultado<null>> {
  return transicion(ordenId, (usuarioId) => marcarLista(ordenId, usuarioId));
}

export async function marcarTrabajoHecho(ordenId: string): Promise<Resultado<null>> {
  return transicion(ordenId, (usuarioId) => marcarHecha(ordenId, usuarioId));
}

export async function cancelarTrabajo(ordenId: string, motivo: string): Promise<Resultado<null>> {
  return transicion(ordenId, (usuarioId) => cancelarOrden(ordenId, usuarioId, motivo));
}

/** The buyer cancels a product order before it is paid. The stock goes back to the shop. */
export async function cancelarPedido(ordenId: string, motivo: string): Promise<Resultado<null>> {
  return transicion(ordenId, (usuarioId) => cancelarOrden(ordenId, usuarioId, motivo));
}

export async function confirmarEntregaComprador(ordenId: string): Promise<Resultado<null>> {
  return transicion(ordenId, (usuarioId) => marcarEntregada(ordenId, usuarioId));
}

export async function simularEntregaDeDemo(ordenId: string): Promise<Resultado<null>> {
  return transicion(ordenId, (usuarioId) => simularEntregaDemo(ordenId, usuarioId));
}

export async function entregarConCodigoVendedor(ordenId: string, codigo: string): Promise<Resultado<null>> {
  return transicion(ordenId, (usuarioId) => entregarConCodigo(ordenId, usuarioId, codigo));
}

export async function enviarResena(
  ordenId: string,
  puntuacion: number,
  comentario: string,
): Promise<Resultado<null>> {
  return transicion(ordenId, (usuarioId) => crearResena(ordenId, usuarioId, puntuacion, comentario));
}

export async function abrirDisputaComprador(
  ordenId: string,
  motivo: string,
  evidencia: string,
): Promise<Resultado<null>> {
  return transicion(ordenId, (usuarioId) => abrirDisputa(ordenId, usuarioId, motivo, evidencia));
}

export async function marcarReembolsoVendedor(ordenId: string): Promise<Resultado<null>> {
  return transicion(ordenId, (usuarioId) => marcarReembolso(ordenId, usuarioId));
}

export async function confirmarReembolsoComprador(ordenId: string): Promise<Resultado<null>> {
  return transicion(ordenId, (usuarioId) => confirmarReembolso(ordenId, usuarioId));
}

/** Chat: no page refresh, the message comes back and the composer adds it to the log. */
export async function enviarMensajeAccion(ordenId: string, texto: string): Promise<Resultado<Mensaje>> {
  if (!esUuid(ordenId)) return NO_ENCONTRADA();
  const sesion = await sesionActual();
  if (!sesion) return SIN_SESION();
  return enviarMensaje(ordenId, sesion.usuario.id, texto);
}
