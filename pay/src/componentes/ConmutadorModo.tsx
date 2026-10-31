import { connection } from 'next/server';

import { negocioDeCuenta } from '@/servidor/negocios';
import { sesionActual } from '@/servidor/sesion';

import { ConmutadorModoVista } from './ConmutadorModoVista';

// Shown in the header only to an account that has a business. Reads the session, so the header wraps it in Suspense.
export async function ConmutadorModo() {
  await connection();
  const sesion = await sesionActual();
  if (!sesion) return null;
  const negocio = await negocioDeCuenta(sesion.usuario.id);
  if (!negocio) return null;
  return <ConmutadorModoVista />;
}
