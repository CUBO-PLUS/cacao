import { SignIn } from '@clerk/nextjs';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { destinoSeguro, rutaContinuar, rutaCuenta, rutaRegistrarse } from '@/servidor/cuentas';
import { sesionActual } from '@/servidor/sesion';

export const metadata: Metadata = {
  title: 'Entrar',
};

// The sign-in form is Clerk's. The destination comes from the URL, so the form streams in behind a boundary.
export default function PaginaEntrar(props: PageProps<'/entrar/[[...rest]]'>) {
  return (
    <div className="entrar">
      <Suspense fallback={<p role="status">Cargando…</p>}>
        <EntradaConDestino busqueda={props.searchParams} />
      </Suspense>
    </div>
  );
}

async function EntradaConDestino({ busqueda }: { busqueda: PageProps<'/entrar/[[...rest]]'>['searchParams'] }) {
  await connection();
  const params = await busqueda;
  const volver = destinoSeguro(params.volver);

  // Already signed in: skip the form. A new account without a name sets it first.
  const sesion = await sesionActual();
  if (sesion) {
    redirect(sesion.usuario.nombre.trim() ? volver : rutaCuenta(volver));
  }

  // Clerk sends the visitor to /continuar after signing in. That route runs the name check
  // before the visitor reaches `volver`.
  return (
    <>
      <section className="encabezado">
        <h1>Entrá a tu cuenta</h1>
        <p>
          {volver.startsWith('/carrito')
            ? 'Para hacer el pedido, entrá con tu celular o tu correo. Tu carrito te espera: al entrar volvés directo a él.'
            : 'Usá tu celular o tu correo para entrar.'}
        </p>
      </section>

      <SignIn
        routing="path"
        path="/entrar"
        signUpUrl={rutaRegistrarse(volver)}
        forceRedirectUrl={rutaContinuar(volver)}
      />
    </>
  );
}
