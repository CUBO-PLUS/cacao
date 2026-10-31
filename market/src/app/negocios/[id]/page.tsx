import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { AvisoDemo, EstadoNegocio, EtiquetaEjemplo, PieDemo } from '@/componentes/Demo';
import { Estrellas } from '@/componentes/Estrellas';
import { TarjetaProducto } from '@/componentes/TarjetaProducto';
import { esDemo } from '@/lib/demo';
import { usdCentavosASats } from '@/lib/dinero';
import {
  cotizacionSegura,
  negocioPorId,
  resenasDeNegocio,
} from '@/servidor/catalogo';

// Shop page. The id comes from the URL, so the shop is read per request behind a Suspense
// boundary. notFound() renders in place when the shop does not exist or is not approved.
export default function PaginaNegocio(props: PageProps<'/negocios/[id]'>) {
  return (
    <Suspense fallback={<p role="status">Cargando la tienda…</p>}>
      <DetalleNegocio params={props.params} />
    </Suspense>
  );
}

export async function generateMetadata(props: PageProps<'/negocios/[id]'>): Promise<Metadata> {
  const { id } = await props.params;
  const negocio = await negocioPorId(id);
  return { title: negocio ? negocio.nombre : 'Negocio no encontrado' };
}

function fechaCorta(iso: string): string {
  return new Intl.DateTimeFormat('es-SV', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/El_Salvador',
  }).format(new Date(iso));
}

async function DetalleNegocio({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [negocio, resenas, cotizacion] = await Promise.all([
    negocioPorId(id),
    resenasDeNegocio(id),
    cotizacionSegura(),
  ]);
  if (!negocio) notFound();

  return (
    <article className="negocio">
      <AvisoDemo btcmapId={negocio.btcmapId} nombre={negocio.nombre} />
      <header className="negocio__cabeza">
        <p>
          <EstadoNegocio btcmapId={negocio.btcmapId} abierto={negocio.abierto} />
        </p>
        <h1>
          {negocio.nombre} <EtiquetaEjemplo activo={esDemo(negocio.btcmapId)} />
        </h1>
        {negocio.ubicacion && <p className="dato">{negocio.ubicacion}</p>}
        {negocio.descripcion && <p>{negocio.descripcion}</p>}
        {negocio.promedio === null ? (
          <p className="dato">Todavía no tiene reseñas.</p>
        ) : (
          <Estrellas valor={negocio.promedio} cantidad={negocio.cantidadResenas} />
        )}
      </header>

      <section className="seccion" aria-labelledby="titulo-productos">
        <h2 id="titulo-productos">Productos</h2>
        {negocio.productos.length === 0 ? (
          <p className="vacio">Esta tienda todavía no tiene productos a la venta.</p>
        ) : (
          <ul className="cuadricula">
            {negocio.productos.map((p) => (
              <li key={p.id}>
                <TarjetaProducto
                  producto={p}
                  sats={cotizacion === null ? null : usdCentavosASats(p.precioUsdCentavos, cotizacion)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="seccion" aria-labelledby="titulo-resenas">
        <h2 id="titulo-resenas">Reseñas</h2>
        {resenas.length === 0 ? (
          <p>Todavía no hay reseñas para esta tienda.</p>
        ) : (
          <ul className="resenas">
            {resenas.map((r) => (
              <li key={r.id} className="resena">
                <Estrellas valor={r.puntuacion} />
                <p className="dato">{fechaCorta(r.creadaEn)}</p>
                {r.comentario && <p>{r.comentario}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <PieDemo btcmapId={negocio.btcmapId} />
    </article>
  );
}
