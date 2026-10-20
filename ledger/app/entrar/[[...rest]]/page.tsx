import { SignIn } from "@clerk/nextjs";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { destinoSeguro, rutaAcceso, rutaContinuar } from "../../../src/servidor/acceso.ts";
import { sesionActual } from "../../../src/servidor/sesion.ts";

export const metadata: Metadata = {
  title: "Entrar",
};

// The sign-in form is Clerk's. The destination comes from the URL, so the form streams in behind a boundary.
export default function PaginaEntrar(props: PageProps<"/entrar/[[...rest]]">) {
  return (
    <div className="entrar">
      <Suspense fallback={<p role="status">Cargando…</p>}>
        <EntradaConDestino busqueda={props.searchParams} />
      </Suspense>
    </div>
  );
}

async function EntradaConDestino({ busqueda }: { busqueda: PageProps<"/entrar/[[...rest]]">["searchParams"] }) {
  await connection();
  const params = await busqueda;
  const volver = destinoSeguro(params.volver);

  // Already signed in: skip the form. The owner pages then decide what the visitor sees.
  if (await sesionActual()) redirect(volver);

  return (
    <>
      <section className="encabezado">
        <h1>Entrá a tu cuenta</h1>
        <p>Con tu celular o tu correo. Te mandamos un código, sin contraseña.</p>
      </section>

      {/* After sign-in, /continuar sends the visitor on, once. */}
      <SignIn routing="path" path="/entrar" forceRedirectUrl={rutaContinuar(volver)} signUpUrl={rutaAcceso("/registrarse", volver)} />
    </>
  );
}
