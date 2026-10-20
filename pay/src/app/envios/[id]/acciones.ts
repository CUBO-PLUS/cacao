'use server';

import { refresh } from 'next/cache';

import type { PagoLightning } from '@/lib/lightning';
import type { EstadoEnvio } from '@/lib/transferencias';
import { exigirSesion } from '@/servidor/sesion';
import type { Resultado } from '@/servidor/resultado';
import {
  cancelarEnvio,
  envioPara,
  estadoDePagoEnvio,
  pagarEnvio,
  procesarEnvio,
  simularCompletar,
  simularFallar,
  type CambioEnvio,
} from '@/servidor/transferencias';

// Actions on one transfer. Each reads the session itself and hands the change to the server layer,
// which checks who may make it. The page then re-renders with the new state.

export type ResultadoAccion = { ok: boolean; mensaje: string };

type Usuario = { id: string; esAdmin: boolean };

// Runs one change, refreshes the page either way, and turns the result into a sentence.
async function cambiar(
  envioId: string,
  hacer: (usuario: Usuario) => Promise<Resultado<CambioEnvio>>,
  mensajeListo: string,
): Promise<ResultadoAccion> {
  const sesion = await exigirSesion(`/envios/${envioId}`);
  const resultado = await hacer(sesion.usuario);
  refresh();
  if (!resultado.ok) return { ok: false, mensaje: resultado.mensaje };
  return { ok: true, mensaje: mensajeListo };
}

export async function procesarEnvioAccion(envioId: string): Promise<ResultadoAccion> {
  return cambiar(envioId, (u) => procesarEnvio(u.id, envioId), 'Listo. El envío va en camino.');
}

export async function cancelarEnvioAccion(envioId: string): Promise<ResultadoAccion> {
  return cambiar(envioId, (u) => cancelarEnvio(u.id, envioId), 'Cancelaste el envío. No se movió dinero.');
}

export async function simularCompletarAccion(envioId: string): Promise<ResultadoAccion> {
  return cambiar(envioId, (u) => simularCompletar(u, envioId), 'Simulamos que llegó. El envío quedó entregado.');
}

export async function simularFallarAccion(envioId: string, motivo: string): Promise<ResultadoAccion> {
  return cambiar(envioId, (u) => simularFallar(u, envioId, motivo), 'Simulamos que falló. Mirá el motivo abajo.');
}

/** The state of a transfer, for the page that waits for it to move. Does not refresh anything. */
export async function estadoDeEnvioAccion(envioId: string): Promise<EstadoEnvio | null> {
  const sesion = await exigirSesion(`/envios/${envioId}`);
  const envio = await envioPara(sesion.usuario, envioId);
  return envio?.estado ?? null;
}

/** The Lightning invoice for a transfer the sender is about to pay. Reuses a live invoice. */
export async function pagarEnvioAccion(envioId: string): Promise<Resultado<PagoLightning>> {
  const sesion = await exigirSesion(`/envios/${envioId}`);
  return pagarEnvio(sesion.usuario.id, envioId);
}

/** The state of a transfer the sender is paying in Lightning. Asks BTCPay; does not refresh the page. */
export async function estadoDePagoAccion(envioId: string): Promise<EstadoEnvio | null> {
  const sesion = await exigirSesion(`/envios/${envioId}`);
  return estadoDePagoEnvio(sesion.usuario.id, envioId);
}
