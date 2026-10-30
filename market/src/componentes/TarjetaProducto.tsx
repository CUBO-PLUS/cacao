import Link from 'next/link';

import type { ProductoCatalogo } from '@/servidor/catalogo';

import { EtiquetaPrecio } from './EtiquetaPrecio';
import { Estrellas } from './Estrellas';
import { FotoProducto } from './FotoProducto';

export function TarjetaProducto({
  producto,
  sats,
  prioridad = false,
}: {
  producto: ProductoCatalogo;
  sats: number | null;
  /** The first row of a listing: its photo loads without waiting. */
  prioridad?: boolean;
}) {
  const agotado = producto.stock === 0;

  return (
    <article className="tarjeta">
      <FotoProducto
        src={producto.foto}
        nombre={producto.nombre}
        categoriaId={producto.categoriaId}
        prioridad={prioridad}
      />
      <div className="tarjeta__cuerpo">
        <h3 className="tarjeta__titulo">
          <Link href={`/productos/${producto.id}`} className="tarjeta__enlace">
            {producto.nombre}
          </Link>
        </h3>
        <p className="tarjeta__dato">{producto.negocioNombre}</p>
        {producto.negocioPromedio !== null && producto.negocioResenas > 0 && (
          <Estrellas valor={producto.negocioPromedio} cantidad={producto.negocioResenas} />
        )}
        <p className="tarjeta__dato">por {producto.unidad}</p>
        {(agotado || !producto.abierto) && (
          <div className="tarjeta__estados">
            {agotado && <span className="marca marca--agotado">Agotado</span>}
            {!producto.abierto && <span className="marca marca--cerrado">Cerrado</span>}
          </div>
        )}
        <EtiquetaPrecio usdCentavos={producto.precioUsdCentavos} sats={sats} />
      </div>
    </article>
  );
}
