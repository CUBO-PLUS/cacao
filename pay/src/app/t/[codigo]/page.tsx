import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';

import { ActualizarEnvio } from '@/componentes/ActualizarEnvio';
import { CodigoQr } from '@/componentes/CodigoQr';
import { VistaDestinatario } from '@/componentes/VistaDestinatario';
import { esEstadoFinal, saludoDestinatario } from '@/componentes/textosEnvio';
import { enlaceRastreo } from '@/lib/compartir';
import { esCodigo, normalizarCodigo } from '@/lib/transferencias';
import { rastreo } from '@/servidor/transferencias';

import estilos from './estilos.module.css';

export const metadata: Metadata = {
  title: 'Seguir un envío',
  robots: { index: false, follow: false },
};

// The code decides the page, so it is read before anything streams. An unknown code then gets a
// real 404 status, not a page that says "not found" with a 200.
export const instant = false;

// Anyone with the code can read this page: the state, what arrives and how. Never the sender, the
// contact, the fee or the note. rastreo() returns only those fields.
export default async function PaginaRastreo(props: PageProps<'/t/[codigo]'>) {
  await connection();
  const { codigo } = await props.params;
  if (!esCodigo(codigo)) notFound();

  // A code typed in lower case, or without dashes, goes to its written form.
  const forma = normalizarCodigo(codigo);
  if (forma !== codigo) redirect(`/t/${forma}`);

  const envio = await rastreo(forma);
  if (!envio) notFound();

  return (
    <div className={estilos.pagina}>
      <p className={estilos.codigo}>
        Código <span className="dato">{envio.codigo}</span>
      </p>

      <VistaDestinatario
        saludo={saludoDestinatario(envio.destinatarioNombre)}
        envio={envio}
      />

      {envio.cobradaPorLightning && <p className={estilos.cobrado}>Cobrado por Lightning</p>}

      <div className={estilos.qr}>
        <CodigoQr texto={enlaceRastreo(envio.codigo)} titulo="Escaneá para seguir este envío desde tu teléfono" />
      </div>

      <ActualizarEnvio activo={!esEstadoFinal(envio.estado)} />

      <p className={estilos.pie}>
        ¿Querés gastarlo en productos locales?{' '}
        <a href="https://cacao-market.vercel.app">Mirá CacaoMarket</a>
      </p>
    </div>
  );
}
