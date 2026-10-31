import Link from 'next/link';

import { esDemo, mostrarCerrado } from '@/lib/demo';
import type { ProductoCatalogo } from '@/servidor/catalogo';

import { EtiquetaEjemplo } from './Demo';
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
  const cerrado = mostrarCerrado(producto.btcmapId, producto.abierto);

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
        <p className="tarjeta__dato">
          {producto.negocioNombre} <EtiquetaEjemplo activo={esDemo(producto.btcmapId)} />
        </p>
        {producto.negocioPromedio !== null && producto.negocioResenas > 0 && (
          <Estrellas valor={producto.negocioPromedio} cantidad={producto.negocioResenas} />
        )}
        <p className="tarjeta__dato">por {producto.unidad}</p>
        {(agotado || cerrado) && (
          <div className="tarjeta__estados">
            {agotado && <span className="marca marca--agotado">Agotado</span>}
            {cerrado && <span className="marca marca--cerrado">Cerrado</span>}
          </div>
        )}
        <EtiquetaPrecio usdCentavos={producto.precioUsdCentavos} sats={sats} />
      </div>
    </article>
  );
}
