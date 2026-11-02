import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { Boton } from '@/componentes/Boton';
import { destinoSeguro } from '@/servidor/cuentas';
import { exigirSesion } from '@/servidor/sesion';

import { BotonSalir } from './BotonSalir';
import { FormularioNombre } from './FormularioNombre';
import estilos from './estilos.module.css';

export const metadata: Metadata = {
  title: 'Tu cuenta',
};

// The visitor's name and phone come from the session, so the page is read per request.
export default function PaginaCuenta(props: PageProps<'/cuenta'>) {
  return (
    <Suspense fallback={<p role="status">Cargando tu cuenta…</p>}>
      <Cuenta busqueda={props.searchParams} />
    </Suspense>
  );
}

async function Cuenta({ busqueda }: { busqueda: PageProps<'/cuenta'>['searchParams'] }) {
  await connection();
  const params = await busqueda;
  const volver = destinoSeguro(params.volver);
  const sesion = await exigirSesion(volver === '/' ? '/cuenta' : `/cuenta?volver=${encodeURIComponent(volver)}`);
  const { usuario } = sesion;

  return (
    <div className={estilos.cuenta}>
      <section className="encabezado">
        <h1>Tu cuenta</h1>
        {!usuario.nombre.trim() && (
          <p>Antes de seguir, decinos tu nombre. Así te reconocen en tus envíos.</p>
        )}
      </section>

      <section className={estilos.bloque} aria-labelledby="titulo-datos">
        <h2 id="titulo-datos">Tus datos</h2>
        <dl className={estilos.datos}>
          {usuario.telefono ? (
            <>
              <dt>Celular</dt>
              <dd className="dato">{mascaraCelular(usuario.telefono)}</dd>
            </>
          ) : (
            <>
              <dt>Correo</dt>
              <dd className="dato">{mascaraCorreo(usuario.correo)}</dd>
            </>
          )}
        </dl>
        <FormularioNombre nombre={usuario.nombre} volver={volver} />
      </section>

      {usuario.esAdmin && (
        <section className={estilos.bloque} aria-labelledby="titulo-admin">
          <h2 id="titulo-admin">Administración</h2>
          <div className={estilos.acciones}>
            <Boton href="/admin" variante="secundario">
              Monitor de envíos
            </Boton>
          </div>
        </section>
      )}

      <section className={estilos.bloque} aria-labelledby="titulo-salir">
        <h2 id="titulo-salir">Sesión</h2>
        <BotonSalir />
      </section>
    </div>
  );
}

// Shows the last two digits only: "+503 •••• ••07".
function mascaraCelular(telefono: string): string {
  const digitos = telefono.replace(/\D/g, '').slice(-8);
  if (digitos.length < 2) return '+503';
  return `+503 •••• ••${digitos.slice(-2)}`;
}

// Shows the first two characters of the name part and the whole domain: "jo•••@gmail.com".
function mascaraCorreo(correo: string): string {
  const corte = correo.lastIndexOf('@');
  if (corte < 1) return '';
  const inicio = Array.from(correo.slice(0, corte)).slice(0, 2).join('');
  return `${inicio}•••${correo.slice(corte)}`;
}
