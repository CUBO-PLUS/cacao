import Link from 'next/link';

import { EtiquetaEjemplo } from '@/componentes/Demo';
import { FotoProducto } from '@/componentes/FotoProducto';
import { esDemo, mostrarCerrado } from '@/lib/demo';
import type { ServicioCatalogo } from '@/servidor/servicios';

import { PrecioServicio } from './PrecioServicio';

// One service in the list. The whole card links to the service page through the title.
export function TarjetaServicio({
  servicio,
  cotizacion,
  prioridad = false,
}: {
  servicio: ServicioCatalogo;
  cotizacion: number | null;
  prioridad?: boolean;
}) {
  return (
    <article className="tarjeta">
      <FotoProducto
        src={servicio.foto}
        nombre={servicio.titulo}
        categoriaId={servicio.categoriaId}
        prioridad={prioridad}
      />
      <div className="tarjeta__cuerpo">
        <h3 className="tarjeta__titulo">
          <Link href={`/servicios/${servicio.id}`} className="tarjeta__enlace">
            {servicio.titulo}
          </Link>
        </h3>
        <p className="tarjeta__dato">
          {servicio.negocioNombre} <EtiquetaEjemplo activo={esDemo(servicio.btcmapId)} />
        </p>
        <p className="tarjeta__dato">{servicio.zona}</p>
        {mostrarCerrado(servicio.btcmapId, servicio.abierto) && (
          <div className="tarjeta__estados">
            <span className="marca marca--cerrado">Cerrado por ahora</span>
          </div>
        )}
        <PrecioServicio servicio={servicio} cotizacion={cotizacion} />
      </div>
    </article>
  );
}
