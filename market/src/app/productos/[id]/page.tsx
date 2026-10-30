import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { AgregarAlCarrito } from '@/componentes/AgregarAlCarrito';
import { EtiquetaPrecio } from '@/componentes/EtiquetaPrecio';
import { Estrellas } from '@/componentes/Estrellas';
import { FotoProducto } from '@/componentes/FotoProducto';
import { RegistrarEvento } from '@/componentes/RegistrarEvento';
import { usdCentavosASats } from '@/lib/dinero';
import type { ProductoDetalle } from '@/servidor/catalogo';
import { cotizacionSegura, productoPorId } from '@/servidor/catalogo';

// The lookup has to finish before the shell, so a missing id can answer 404.
export const instant = false;

// The id comes from the URL. Existence is checked before Suspense so a missing product returns HTTP 404.
export default async function PaginaProducto(props: PageProps<'/productos/[id]'>) {
  const { id } = await props.params;
  const producto = await productoPorId(id);
  if (!producto) notFound();

  return (
    <Suspense fallback={<p role="status">Cargando el producto…</p>}>
      <DetalleProducto producto={producto} />
    </Suspense>
  );
}

export async function generateMetadata(props: PageProps<'/productos/[id]'>): Promise<Metadata> {
  const { id } = await props.params;
  const producto = await productoPorId(id);
  return { title: producto ? producto.nombre : 'Producto no encontrado' };
}

async function DetalleProducto({ producto }: { producto: ProductoDetalle }) {
  const cotizacion = await cotizacionSegura();
  const sats = cotizacion === null ? null : usdCentavosASats(producto.precioUsdCentavos, cotizacion);

  // The reason the button is off, written under it. Sold out wins over closed.
  const motivo =
    producto.stock === 0
      ? 'Este producto está agotado.'
      : !producto.abierto
        ? 'La tienda está cerrada por ahora. Volvé a pedir cuando abra.'
        : null;

  return (
    <article className="producto">
      <RegistrarEvento nombre="vista_producto" objeto={producto.id} />
      <figure>
        <FotoProducto
          src={producto.foto}
          nombre={producto.nombre}
          categoriaId={producto.categoriaId}
          prioridad
        />
      </figure>

      <div className="producto__info">
        <p>
          <Link href="/">← Volver al catálogo</Link>
        </p>
        <h1>{producto.nombre}</h1>

        <p className="producto__tienda">
          Vende{' '}
          <Link href={`/negocios/${producto.negocioId}`}>{producto.negocioNombre}</Link>
          {!producto.abierto && (
            <>
              {' '}
              <span className="marca marca--cerrado">Cerrado</span>
            </>
          )}
        </p>
        {producto.negocioPromedio !== null && producto.negocioResenas > 0 && (
          <Estrellas valor={producto.negocioPromedio} cantidad={producto.negocioResenas} />
        )}

        <EtiquetaPrecio usdCentavos={producto.precioUsdCentavos} sats={sats} tamano="grande" />

        <p className="producto__unidad">por {producto.unidad}</p>
        <p className="producto__stock">
          {producto.stock > 0 ? `Quedan ${producto.stock}` : 'Agotado'}
        </p>

        {producto.descripcion && <p className="producto__descripcion">{producto.descripcion}</p>}

        <AgregarAlCarrito
          producto={{
            id: producto.id,
            negocioId: producto.negocioId,
            negocioNombre: producto.negocioNombre,
            nombre: producto.nombre,
            unidad: producto.unidad,
            precioUsdCentavos: producto.precioUsdCentavos,
            foto: producto.foto,
            stock: producto.stock,
          }}
          motivoNoDisponible={motivo}
        />
      </div>
    </article>
  );
}
