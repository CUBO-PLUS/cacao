import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import type { ReactNode } from 'react';

import { formatoSats, formatoUsd } from '@/lib/dinero';
import { datosDeCobro, enlaceFacturaDePrueba } from '@/servidor/cobro';

import { FormularioCobro } from './FormularioCobro';
import estilos from './estilos.module.css';
import { SeguimientoCobro } from './SeguimientoCobro';

export const metadata: Metadata = {
  title: 'Cobrar un envío',
  robots: { index: false, follow: false },
};

// The token decides the page. An unknown token gets its 404 from the proxy, before anything streams (src/proxy.ts);
// this check covers a token that goes away while the page is read.
export const instant = false;

// Public: the token in the link is the only key. Shows the amount, the sender's first name and the
// state of the claim. Never the contacts, the fee or the sender's money.
export default async function PaginaCobrar(props: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await props.params;
  const datos = await datosDeCobro(token);
  if (!datos) notFound();

  // The sats are the exact amount the invoice needs; the dollars are the figure fixed when the transfer was quoted.
  const cifra = formatoSats(datos.sats);
  const dolares = datos.usdCentavos === null ? null : formatoUsd(datos.usdCentavos);
  const de = datos.remitenteNombre ? `De ${datos.remitenteNombre}. ` : '';

  let contenido: ReactNode;
  if (datos.estado === 'creada') {
    contenido = <p className={estilos.texto}>Tu envío todavía está esperando el pago de quien lo manda.</p>;
  } else if (datos.estado === 'cancelada') {
    contenido = <p className={estilos.texto}>Este envío se canceló. No te va a llegar dinero.</p>;
  } else if (datos.estado === 'fallida') {
    contenido = <p className={estilos.texto}>Este envío no se pudo entregar. Consultá con quien te lo mandó.</p>;
  } else if (datos.estado === 'devuelta') {
    contenido = (
      <p className={estilos.texto}>Este envío se devolvió a quien lo mandó porque no se cobró a tiempo.</p>
    );
  } else if (datos.cobroEstado === 'pagado') {
    contenido = (
      <div className={estilos.bloque}>
        <p role="status" className={estilos.exito}>
          Listo. Cobraste {dolares ?? cifra}.
        </p>
        <dl className={estilos.recibo}>
          <div>
            <dt>Código del envío</dt>
            <dd className="dato">{datos.codigo}</dd>
          </div>
          <div>
            <dt>Te lo mandó</dt>
            <dd>{datos.remitenteNombre ?? 'Quien envió'}</dd>
          </div>
          <div>
            <dt>Cobraste</dt>
            <dd className="dato">{dolares ?? cifra}</dd>
          </div>
        </dl>
        {datos.cobroHash && (
          <details className={estilos.detalles}>
            <summary>Ver detalle</summary>
            <p>
              Código del pago: <span className="dato">{datos.cobroHash}</span>. El monto exacto en bitcoin es{' '}
              <span className="dato">{cifra}</span>.
            </p>
          </details>
        )}
        <Link href={`/t/${datos.codigo}`} className="boton boton--secundario">
          Ver el envío
        </Link>
        <p className={estilos.texto}>
          Esto es bitcoin de prueba: no tiene valor real. La página Dónde gastar muestra dónde se podría gastar bitcoin
          de verdad.
        </p>
        <Link href="/donde-gastar" className="boton boton--secundario">
          Dónde gastar bitcoin
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
        <p className={estilos.texto}>Estamos cobrando tu dinero. Esta página se actualiza sola.</p>
        <SeguimientoCobro token={token} />
      </div>
    );
  } else if (datos.vencido) {
    // The window is 7 days from the payment. After it, no invoice is taken; the sender gets the money back.
    contenido = (
      <div className={estilos.bloque}>
        <p role="alert" className={estilos.error}>
          Este enlace de cobro venció: el plazo para cobrar es de 7 días. Quien te mandó el dinero puede recuperarlo.
        </p>
      </div>
    );
  } else {
    // Ready to collect: nothing is pending, or the last invoice failed (its reason is shown again).
    contenido = (
      <div className={estilos.bloque}>
        {datos.cobroEstado === 'fallido' && (
          <p role="alert" className={estilos.error}>
            {datos.cobroMotivo ?? 'No pudimos cobrar con ese código. Pegá un código nuevo y probá de nuevo.'}
          </p>
        )}
        <FormularioCobro token={token} monto={cifra} enlaceFacturaDePrueba={await enlaceFacturaDePrueba(datos.sats)} />
      </div>
    );
  }

  return (
    <article className={estilos.pagina}>
      <header className={estilos.encabezado}>
        <p className={estilos.codigo}>
          Código <span className="dato">{datos.codigo}</span>
        </p>
        <h1>Te mandaron {dolares ?? cifra}</h1>
        {dolares && <p className={estilos.dolares}>En dólares, al cambio del momento de enviar. Se cobra en bitcoin.</p>}
        <p className={estilos.texto}>{de}Cobralo con tu billetera de bitcoin.</p>
        <p className={estilos.texto}>
          El monto exacto en bitcoin es <span className="dato">{cifra}</span>.
        </p>
      </header>
      <section className={estilos.bloque} aria-live="polite">
        {contenido}
      </section>
    </article>
  );
}
