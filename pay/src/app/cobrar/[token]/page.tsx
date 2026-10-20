import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import type { ReactNode } from 'react';

import { formatoSats } from '@/lib/dinero';
import { datosDeCobro, enlaceFacturaDePrueba } from '@/servidor/cobro';

import { FormularioCobro } from './FormularioCobro';
import estilos from './estilos.module.css';
import { SeguimientoCobro } from './SeguimientoCobro';

export const metadata: Metadata = {
  title: 'Cobrar un envío',
  robots: { index: false, follow: false },
};

// The token decides the page, so it is read before anything streams. An unknown token gets a real 404.
export const instant = false;

// Public: the token in the link is the only key. Shows the amount, the sender's first name and the
// state of the claim. Never the contacts, the fee or the sender's money.
export default async function PaginaCobrar(props: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await props.params;
  const datos = await datosDeCobro(token);
  if (!datos) notFound();

  const cifra = formatoSats(datos.sats);
  const de = datos.remitenteNombre ? `De ${datos.remitenteNombre}. ` : '';

  let contenido: ReactNode;
  if (datos.estado === 'creada') {
    contenido = <p className={estilos.texto}>Tu envío todavía está esperando el pago de quien lo manda.</p>;
  } else if (datos.estado === 'cancelada') {
    contenido = <p className={estilos.texto}>Este envío se canceló. No te va a llegar dinero.</p>;
  } else if (datos.estado === 'fallida') {
    contenido = <p className={estilos.texto}>Este envío no se pudo entregar. Consultá con quien te lo mandó.</p>;
  } else if (datos.cobroEstado === 'pagado') {
    contenido = (
      <div className={estilos.bloque}>
        <p role="status" className={estilos.exito}>
          Listo. Recibiste {cifra}.
        </p>
        {datos.cobroHash && (
          <p className={estilos.texto}>
            Pago <span className="dato">{datos.cobroHash.slice(0, 8)}…{datos.cobroHash.slice(-6)}</span>
          </p>
        )}
        <Link href={`/t/${datos.codigo}`} className="boton boton--secundario">
          Ver el envío
        </Link>
      </div>
    );
  } else if (datos.estado === 'completada') {
    contenido = (
      <div className={estilos.bloque}>
        <p className={estilos.texto}>Este envío ya se entregó.</p>
        <Link href={`/t/${datos.codigo}`} className="boton boton--secundario">
          Ver el envío
        </Link>
      </div>
    );
  } else if (datos.cobroEstado === 'pagando') {
    contenido = (
      <div className={estilos.bloque}>
        <p className={estilos.texto}>Estamos pagando tu factura. Esta página se actualiza sola.</p>
        <SeguimientoCobro token={token} />
      </div>
    );
  } else {
    // Ready to collect: nothing is pending, or the last invoice failed (its reason is shown again).
    contenido = (
      <div className={estilos.bloque}>
        {datos.cobroEstado === 'fallido' && (
          <p role="alert" className={estilos.error}>
            {datos.cobroMotivo ?? 'No se pudo pagar la factura. Pedí otra factura.'}
          </p>
        )}
        <FormularioCobro token={token} enlaceFacturaDePrueba={enlaceFacturaDePrueba(datos.sats)} />
      </div>
    );
  }

  return (
    <article className={estilos.pagina}>
      <header className={estilos.encabezado}>
        <p className={estilos.codigo}>
          Código <span className="dato">{datos.codigo}</span>
        </p>
        <h1>Te mandaron {cifra}</h1>
        <p className={estilos.texto}>
          {de}Cobralo por Lightning con una factura de tu billetera.
        </p>
      </header>
      <section className={estilos.bloque} aria-live="polite">
        {contenido}
      </section>
    </article>
  );
}
