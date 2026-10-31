import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { negocioDeCuenta } from '@/servidor/negocios';
import { sesionActual } from '@/servidor/sesion';

import estilos from '../estilos.module.css';
import { CajaCobro } from './CajaCobro';

export const metadata: Metadata = {
  title: 'Cobrar en caja',
};

// The counter is for one signed-in business. Anyone else is sent to the business page.
export default function PaginaCobrar() {
  return (
    <Suspense fallback={<p role="status">Abriendo la caja…</p>}>
      <Caja />
    </Suspense>
  );
}

async function Caja() {
  await connection();
  const sesion = await sesionActual();
  if (!sesion) redirect('/entrar?volver=%2Fnegocios%2Fcobrar');
  const negocio = await negocioDeCuenta(sesion.usuario.id);
  if (!negocio || !negocio.activo) redirect('/negocios');

  return (
    <div className={estilos.pagina}>
      <header className="encabezado">
        <h1>Cobrar en caja</h1>
        <p>Escribí el monto en dólares y tocá Cobrar. Mostrale el código al cliente.</p>
      </header>
      <CajaCobro nombre={negocio.nombre} />
    </div>
  );
}
