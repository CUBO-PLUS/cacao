import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { nombrePublico } from '@/servidor/negocios';

import estilos from '../../negocios/estilos.module.css';
import { FormularioPagar } from './FormularioPagar';

export const metadata: Metadata = {
  title: 'Pagar con CacaoPay',
};

// The public page of a business: only its name is shown, and the visitor types the amount. The business id is the one
// on its counter code. An inactive business shows a sentence, not a form.
export default function PaginaPagar(props: PageProps<'/pagar/[negocio]'>) {
  return (
    <Suspense fallback={<p role="status">Cargando…</p>}>
      <Contenido params={props.params} />
    </Suspense>
  );
}

async function Contenido({ params }: { params: PageProps<'/pagar/[negocio]'>['params'] }) {
  await connection();
  const { negocio } = await params;
  const nombre = await nombrePublico(negocio);

  if (!nombre) {
    return (
      <div className={estilos.pagina}>
        <header className="encabezado">
          <h1>Este negocio no acepta pagos por CacaoPay</h1>
          <p>Pedí al cajero que te muestre otra forma de pagar.</p>
        </header>
      </div>
    );
  }

  return (
    <div className={estilos.pagina}>
      <header className="encabezado">
        <h1>Pagar en {nombre}</h1>
        <p>Escribí cuánto vas a pagar, en dólares. Después escaneá el código con tu billetera de bitcoin.</p>
        <p className="aviso">Demo con bitcoin de prueba, sin valor.</p>
      </header>
      <FormularioPagar negocioId={negocio} nombre={nombre} />
    </div>
  );
}
