import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { AvisoDemo, EtiquetaEjemplo } from '@/componentes/Demo';
import { Estrellas } from '@/componentes/Estrellas';
import { FotoProducto } from '@/componentes/FotoProducto';
import { RegistrarEvento } from '@/componentes/RegistrarEvento';
import { esDemo, mostrarCerrado } from '@/lib/demo';
import { cotizacionSegura } from '@/servidor/catalogo';
import { sesionActual } from '@/servidor/sesion';
import { servicioPublico, type ServicioDetalle } from '@/servidor/servicios';

import { PrecioServicio } from '../PrecioServicio';

import { FormularioContratar } from './FormularioContratar';
import { FormularioCotizar } from './FormularioCotizar';
import estilos from './estilos.module.css';

// The lookup has to finish before the shell, so a missing id can answer 404.
export const instant = false;

// The id comes from the URL. Existence is checked before Suspense so a missing service returns HTTP 404.
export default async function PaginaServicio(props: PageProps<'/servicios/[id]'>) {
  const { id } = await props.params;
  const servicio = await servicioPublico(id);
  if (!servicio) notFound();

  return (
    <Suspense fallback={<p role="status">Cargando el servicio…</p>}>
      <DetalleServicio servicio={servicio} />
    </Suspense>
  );
}

export async function generateMetadata(props: PageProps<'/servicios/[id]'>): Promise<Metadata> {
  const { id } = await props.params;
  const servicio = await servicioPublico(id);
  return { title: servicio ? servicio.titulo : 'Servicio no encontrado' };
}

async function DetalleServicio({ servicio }: { servicio: ServicioDetalle }) {
  const cotizacion = await cotizacionSegura();

  return (
    <article className={estilos.servicio}>
      <RegistrarEvento nombre="vista_servicio" objeto={servicio.id} />
      <div className={estilos.aviso}>
        <AvisoDemo btcmapId={servicio.btcmapId} nombre={servicio.negocioNombre} />
      </div>
      <figure className={estilos.figura}>
        <FotoProducto
          src={servicio.foto}
          nombre={servicio.titulo}
          categoriaId={servicio.categoriaId}
          prioridad
        />
      </figure>

      <div className={estilos.info}>
        <p>
          <Link href="/servicios" className={estilos.volver}>
            ← Volver a servicios
          </Link>
        </p>
        <h1>{servicio.titulo}</h1>

        <p className={estilos.oferta}>
          Ofrece <Link href={`/negocios/${servicio.negocioId}`} prefetch={false}>{servicio.negocioNombre}</Link>{' '}
          <EtiquetaEjemplo activo={esDemo(servicio.btcmapId)} />
          {mostrarCerrado(servicio.btcmapId, servicio.abierto) && (
            <>
              {' '}
              <span className="marca marca--cerrado">Cerrado por ahora</span>
            </>
          )}
        </p>
        {servicio.cantidadResenas > 0 && servicio.promedio !== null && (
          <Estrellas valor={servicio.promedio} cantidad={servicio.cantidadResenas} />
        )}

        <PrecioServicio servicio={servicio} cotizacion={cotizacion} tamano="grande" />
        {servicio.tipoPrecio === 'cotizar' && <p>Precio según el trabajo.</p>}

        <p>Zona: {servicio.zona}</p>
        {servicio.descripcion && <p className={estilos.descripcion}>{servicio.descripcion}</p>}

        <Suspense fallback={<p role="status">Cargando…</p>}>
          <AccionServicio servicio={servicio} />
        </Suspense>
      </div>
    </article>
  );
}

// Owners see the edit link instead of the form. Everyone else gets the form, or a closed notice.
async function AccionServicio({ servicio }: { servicio: ServicioDetalle }) {
  const sesion = await sesionActual();
  if (sesion?.negocio?.id === servicio.negocioId) {
    return (
      <p>
        <Link href={`/mi-negocio/servicios/${servicio.id}`}>Editar este servicio</Link>
      </p>
    );
  }

  if (mostrarCerrado(servicio.btcmapId, servicio.abierto)) {
    return <p className="aviso">Este negocio no está recibiendo pedidos ahora.</p>;
  }

  if (servicio.tipoPrecio === 'fijo') {
    return <FormularioContratar servicioId={servicio.id} />;
  }
  return <FormularioCotizar servicioId={servicio.id} />;
}
