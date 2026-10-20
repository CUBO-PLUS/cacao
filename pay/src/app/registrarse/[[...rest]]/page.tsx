import { SignUp } from '@clerk/nextjs';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { destinoSeguro, rutaAcceso, rutaContinuar, rutaCuenta } from '@/servidor/cuentas';
import { sesionActual } from '@/servidor/sesion';

export const metadata: Metadata = {
  title: 'Crear cuenta',
};

// The sign-up form is Clerk's. A finished sign-up goes through /continuar, which sends the visitor on.
export default function PaginaRegistrarse(props: PageProps<'/registrarse/[[...rest]]'>) {
  return (
    <div className="entrar">
      <Suspense fallback={<p role="status">Cargando…</p>}>
        <RegistroConDestino busqueda={props.searchParams} />
      </Suspense>
    </div>
  );
}

async function RegistroConDestino({ busqueda }: { busqueda: PageProps<'/registrarse/[[...rest]]'>['searchParams'] }) {
  await connection();
  const params = await busqueda;
  const volver = destinoSeguro(params.volver);

  const sesion = await sesionActual();
  if (sesion) {
    redirect(sesion.usuario.nombre.trim() ? volver : rutaCuenta(volver));
  }

  return (
    <>
      <section className="encabezado">
        <h1>Creá tu cuenta</h1>
        <p>Así podés mandar y recibir dinero con tu propio nombre.</p>
      </section>

      <SignUp
        routing="path"
        path="/registrarse"
        forceRedirectUrl={rutaContinuar(volver)}
        signInUrl={rutaAcceso('/entrar', volver)}
      />
    </>
  );
}
