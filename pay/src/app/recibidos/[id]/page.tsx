import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';

import { ActualizarEnvio } from '@/componentes/ActualizarEnvio';
import { esEstadoFinal, primerNombre, saludoDestinatario } from '@/componentes/textosEnvio';
import { VistaDestinatario } from '@/componentes/VistaDestinatario';
import { tokenDeCobroDelDestinatario } from '@/servidor/cobro';
import { envioPara } from '@/servidor/transferencias';
import { exigirSesion } from '@/servidor/sesion';

import estilos from '../estilos.module.css';

export const metadata: Metadata = {
  title: 'Dinero que te mandaron',
};

// Blocking, so a transfer that is not the visitor's gets a real 404 before anything streams.
export const instant = false;

// The recipient's view of one transfer. A sender who opens it goes to their own page; anyone else
// gets the not-found page. The fee is never shown here.
export default async function PaginaRecibido(props: PageProps<'/recibidos/[id]'>) {
  await connection();
  const { id } = await props.params;
  const sesion = await exigirSesion(`/recibidos/${id}`);
  const envio = await envioPara(sesion.usuario, id);
  if (!envio) notFound();
  if (envio.rol === 'remitente') redirect(`/envios/${envio.id}`);
  if (envio.rol !== 'destinatario') notFound();

  const nota = envio.nota.trim();
  // The claim link is read for this recipient alone, per request: the page is never cached.
  const token = await tokenDeCobroDelDestinatario(envio.id, sesion.usuario.id);

  return (
    <div className={estilos.pagina}>
      <p>
        <Link href="/recibidos" className={estilos.volver}>
          ← Volver a lo que te mandaron
        </Link>
      </p>

      <VistaDestinatario
        saludo={saludoDestinatario(envio.destinatarioNombre)}
        envio={envio}
        extra={
          <section className={estilos.datos} aria-labelledby="titulo-datos">
            <h2 id="titulo-datos" className="solo-lectores">
              Datos del envío
            </h2>
            <dl className={estilos.definiciones}>
              <div>
                <dt>Código</dt>
                <dd className={estilos.codigo}>{envio.codigo}</dd>
              </div>
              <div>
                <dt>Te lo mandó</dt>
                <dd>{primerNombre(envio.remitenteNombre)}</dd>
              </div>
              {nota !== '' && (
                <div>
                  <dt>Nota de quien te lo mandó</dt>
                  <dd className={estilos.nota}>{nota}</dd>
                </div>
              )}
            </dl>
            {token && (
              <p>
                <Link href={`/cobrar/${token}`} prefetch={false} className="boton">
                  Cobrar
                </Link>
              </p>
            )}
          </section>
        }
      />

      <ActualizarEnvio activo={!esEstadoFinal(envio.estado)} />
    </div>
  );
}
