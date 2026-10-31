'use server';

// The business screens' actions. Each one takes the account from the session on the server. A form or a call from the
// browser never names the business: the business is the one of the account that is signed in (or, on the public page,
// the business whose page the visitor opened, which is checked to be active).

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { centavosDesdeTexto } from '@/lib/cobro-negocio';
import {
  activarNegocio,
  cancelarEnCaja,
  cobrarEnCaja,
  cobrarPublico,
  estadoEnCaja,
  estadoPublico,
  ipDeCabeceras,
  type CobroNegocio,
} from '@/servidor/negocios';
import { fallo, type Resultado } from '@/servidor/resultado';
import { exigirSesion, sesionActual } from '@/servidor/sesion';

export type EstadoActivar = { tipo: string; nombre: string; ubicacion: string; error?: string };

/** Activates the signed-in account's business. The name, type and location are used only when it has none yet. */
export async function activarAccion(previo: EstadoActivar, datos: FormData): Promise<EstadoActivar> {
  const sesion = await exigirSesion('/negocios');
  const nombre = String(datos.get('nombre') ?? '');
  const tipo = String(datos.get('tipo') ?? '');
  const ubicacion = String(datos.get('ubicacion') ?? '');

  const resultado = await activarNegocio(sesion.usuario.id, { nombre, tipo, ubicacion });
  if (!resultado.ok) return { nombre, tipo, ubicacion, error: resultado.mensaje };

  // The header's switch appears after this, so the root layout renders again.
  revalidatePath('/', 'layout');
  redirect('/negocios');
}

async function conCuenta<T>(hacer: (usuarioId: string) => Promise<Resultado<T>>): Promise<Resultado<T>> {
  const sesion = await sesionActual();
  if (!sesion) return fallo('NO_AUTORIZADO', 'Entrá de nuevo para seguir cobrando.');
  return hacer(sesion.usuario.id);
}

/** A sale at the counter: the amount in US cents and the attempt's key. The same key returns the same charge. */
export async function cobrarCajaAccion(clave: string, centavos: number): Promise<Resultado<CobroNegocio>> {
  return conCuenta((usuarioId) => cobrarEnCaja(usuarioId, centavos, clave));
}

export async function estadoCajaAccion(cobroId: string): Promise<Resultado<CobroNegocio>> {
  return conCuenta((usuarioId) => estadoEnCaja(usuarioId, cobroId));
}

export async function cancelarCajaAccion(cobroId: string): Promise<Resultado<CobroNegocio>> {
  return conCuenta((usuarioId) => cancelarEnCaja(usuarioId, cobroId));
}

/** The public page: a visitor pays an amount typed in dollars, such as "3.50". */
export async function cobrarPublicoAccion(negocioId: string, dolares: string, clave: string): Promise<Resultado<CobroNegocio>> {
  const centavos = centavosDesdeTexto(dolares);
  if (!centavos.ok) return centavos;
  const cabeceras = await headers();
  return cobrarPublico(negocioId, centavos.dato, clave, ipDeCabeceras(cabeceras));
}

export async function estadoPublicoAccion(negocioId: string, cobroId: string): Promise<Resultado<CobroNegocio>> {
  const cabeceras = await headers();
  return estadoPublico(negocioId, cobroId, ipDeCabeceras(cabeceras));
}
