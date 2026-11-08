import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { auth } from '@clerk/nextjs/server';

import { Boton } from '@/componentes/Boton';
import { miNegocio, rutaEntrar, rutaRegistrarse, type DatosNegocio, type Negocio } from '@/servidor/cuentas';
import { cotizacionesDelNegocio } from '@/servidor/cotizaciones';
import { exigirSesion } from '@/servidor/sesion';

import { FormularioNegocio } from './FormularioNegocio';
import { InterruptorAbierto } from './InterruptorAbierto';
import estilos from './estilos.module.css';

export const metadata: Metadata = {
  title: 'Mi negocio',
};

const VACIO: DatosNegocio = { nombre: '', descripcion: '', ubicacion: '', lightningAddress: '' };

// What the visitor sees depends on their shop: none (apply), pending, approved or suspended.
export default function PaginaMiNegocio() {
  return (
    <Suspense fallback={<p role="status">Cargando tu negocio…</p>}>
      <MiNegocio />
    </Suspense>
  );
}

async function MiNegocio() {
  await connection();
  // Signed out: explain the page at once with sign-in and sign-up buttons, instead of redirecting.
  const { userId } = await auth();
  if (!userId) return <SinSesion />;

  const sesion = await exigirSesion('/mi-negocio');
  const resultado = await miNegocio(sesion.usuario.id);
  if (!resultado.ok) {
    return (
      <div role="alert" className={estilos.error}>
        {resultado.mensaje}
      </div>
    );
  }

  const negocio = resultado.dato;
  if (!negocio) return <Solicitud />;
  if (negocio.estado === 'suspendido') return <Suspendido negocio={negocio} />;
  if (negocio.estado === 'pendiente') return <EnRevision negocio={negocio} />;
  return <Aprobado negocio={negocio} />;
}

// A visitor who is not signed in: what the page is for, and the two ways in. Both return here.
function SinSesion() {
  return (
    <div className={estilos.bloque}>
      <section className="encabezado">
        <h1>Mi negocio</h1>
        <p>Vendé en CacaoMarket: publicá tus productos y cobrá en sats.</p>
      </section>
      <nav aria-label="Entrar o registrarte" className={estilos.accesos}>
        <Boton href={rutaEntrar('/mi-negocio')}>Entrar</Boton>
        <Boton href={rutaRegistrarse('/mi-negocio')} variante="secundario">
          Registrar mi negocio
        </Boton>
      </nav>
    </div>
  );
}

function Solicitud() {
  return (
    <div className={estilos.bloque}>
      <section className="encabezado">
        <h1>Vendé en CacaoMarket</h1>
        <p>
          Vendés tus productos directo a vecinos de El Salvador. Cada pedido se paga en sats y el dinero
          llega a tu billetera, no a nosotros.
        </p>
      </section>
      <FormularioNegocio modo="solicitar" valores={VACIO} />
    </div>
  );
}

function EnRevision({ negocio }: { negocio: Negocio }) {
  return (
    <div className={estilos.bloque}>
      <section className="encabezado">
        <h1>Mi negocio</h1>
      </section>
      <div className={estilos.panel}>
        <p className={estilos.titulo}>Tu solicitud está en revisión</p>
        <p>
          Un administrador la revisa. Mientras tanto podés corregir los datos. Cuando la aprueben vas a
          poder publicar productos y recibir pedidos.
        </p>
      </div>
      <FormularioNegocio modo="editar" valores={aValores(negocio)} />
    </div>
  );
}

function Aprobado({ negocio }: { negocio: Negocio }) {
  return (
    <div className={estilos.bloque}>
      <section className="encabezado">
        <h1>Mi negocio</h1>
        <p>
          <span className="marca marca--abierto">Aprobado</span> <span className="dato">{negocio.nombre}</span>
        </p>
      </section>

      <InterruptorAbierto abierto={negocio.abierto} />

      <Suspense fallback={null}>
        <CotizacionesPorResponder negocioId={negocio.id} />
      </Suspense>

      <nav aria-label="Enlaces de mi negocio" className={estilos.accesos}>
        <Boton href="/mi-negocio/productos" variante="secundario">
          Productos
        </Boton>
        <Boton href="/mi-negocio/servicios" variante="secundario">
          Servicios
        </Boton>
        <Boton href="/mi-negocio/ordenes" variante="secundario">
          Órdenes
        </Boton>
        <Boton href="/mi-negocio/cotizaciones" variante="secundario">
          Cotizaciones
        </Boton>
        <Boton href={`/negocios/${negocio.id}`} variante="secundario">
          Ver tu página pública
        </Boton>
      </nav>

      <FormularioNegocio modo="editar" valores={aValores(negocio)} />
    </div>
  );
}

// Quotes waiting for the shop's answer. Silent when there are none.
async function CotizacionesPorResponder({ negocioId }: { negocioId: string }) {
  const cotizaciones = await cotizacionesDelNegocio(negocioId);
  const pendientes = cotizaciones.filter((c) => c.estado === 'solicitada').length;
  if (pendientes === 0) return null;

  return (
    <p className={estilos.avisoEnlace}>
      <Link href="/mi-negocio/cotizaciones">
        {pendientes === 1
          ? 'Tenés 1 cotización por responder'
          : `Tenés ${pendientes} cotizaciones por responder`}
      </Link>
    </p>
  );
}

// Plain statement: the shop is paused and nobody can order from it.
function Suspendido({ negocio }: { negocio: Negocio }) {
  return (
    <div className={estilos.bloque}>
      <section className="encabezado">
        <h1>Mi negocio</h1>
      </section>
      <div className={estilos.panel} role="status">
        <p className={estilos.titulo}>Tu negocio está suspendido.</p>
        <p>Los pedidos están pausados. No se pueden hacer pedidos mientras dure la suspensión.</p>
      </div>
      <dl className={estilos.datos}>
        <dt>Nombre</dt>
        <dd>{negocio.nombre}</dd>
        <dt>Ubicación</dt>
        <dd>{negocio.ubicacion || 'Sin ubicación'}</dd>
      </dl>
    </div>
  );
}

function aValores(negocio: Negocio): DatosNegocio {
  return {
    nombre: negocio.nombre,
    descripcion: negocio.descripcion,
    ubicacion: negocio.ubicacion,
    lightningAddress: negocio.lightningAddress,
  };
}
