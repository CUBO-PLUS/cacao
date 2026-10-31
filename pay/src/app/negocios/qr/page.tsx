import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { rutaPagarNegocio } from '@/lib/cobro-negocio';
import { matrizQr } from '@/lib/qr';
import { negocioDeCuenta } from '@/servidor/negocios';
import { sesionActual } from '@/servidor/sesion';

import estilos from '../estilos.module.css';
import { BotonImprimir } from './BotonImprimir';

export const metadata: Metadata = {
  title: 'Código QR del mostrador',
};

export default function PaginaQr() {
  return (
    <Suspense fallback={<p role="status">Preparando el código…</p>}>
      <Contenido />
    </Suspense>
  );
}

async function Contenido() {
  await connection();
  const sesion = await sesionActual();
  if (!sesion) redirect('/entrar?volver=%2Fnegocios%2Fqr');
  const negocio = await negocioDeCuenta(sesion.usuario.id);
  if (!negocio || !negocio.activo) redirect('/negocios');

  // The address the code opens: this host, as the visitor reached it.
  const cabeceras = await headers();
  const host = cabeceras.get('x-forwarded-host') ?? cabeceras.get('host') ?? 'localhost:4324';
  const protocolo = /^(localhost|127\.|\[::1\])/.test(host) ? 'http' : 'https';
  const direccion = `${protocolo}://${host}${rutaPagarNegocio(negocio.id)}`;

  const { tamano, d } = matrizQr(direccion);
  const margen = 2;
  const total = tamano + margen * 2;

  return (
    <div className={estilos.pagina}>
      <header className={`encabezado ${estilos.imprimir}`}>
        <h1>{negocio.nombre}</h1>
        <p>Escaneá este código y poné el monto en dólares. Después pagás con tu billetera de bitcoin.</p>
        <svg
          className={estilos.qrGrande}
          viewBox={`0 0 ${total} ${total}`}
          role="img"
          aria-label={`Código QR para pagar en ${negocio.nombre}`}
          shapeRendering="crispEdges"
        >
          <rect width={total} height={total} fill="#fff" />
          <path transform={`translate(${margen} ${margen})`} d={d} fill="#000" />
        </svg>
        <p className="dato">{direccion}</p>
        <p className="aviso">Demo con bitcoin de prueba, sin valor.</p>
      </header>
      <BotonImprimir />
    </div>
  );
}
