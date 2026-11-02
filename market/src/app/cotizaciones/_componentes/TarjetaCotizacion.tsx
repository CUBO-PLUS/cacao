import Link from 'next/link';

import { BotonAccion } from '@/app/necesito/_componentes/BotonAccion';
import { fechaCorta, precioAprox } from '@/app/necesito/_comun/formato';
import estilos from '@/app/necesito/estilos.module.css';
import { formatoUsd } from '@/lib/dinero';
import { ETIQUETA_COTIZACION } from '@/lib/servicios';
import type { Cotizacion } from '@/servidor/cotizaciones';

import { aceptarCotizacionAccion, rechazarCotizacionAccion } from '../acciones';

// One quote the client asked for or received. The buttons match the state: a quote asked for a
// service is answered here; a quote on a need is accepted on the need's page.
export function TarjetaCotizacion({ dato, usdBtc }: { dato: Cotizacion; usdBtc: number | null }) {
  const { estado, origen } = dato;

  return (
    <article className={estilos.tarjeta} aria-labelledby={`cotizacion-${dato.id}`}>
      <p className={estilos.categoria}>{origen === 'servicio' ? 'Servicio' : 'Mi necesidad'}</p>
      <h3 id={`cotizacion-${dato.id}`} className={estilos.titulo}>
        {dato.titulo}
      </h3>
      <p className={estilos.meta}>
        <Link href={`/negocios/${dato.negocioId}`} prefetch={false}>{dato.negocioNombre}</Link>
        <span>{ETIQUETA_COTIZACION[estado]}</span>
      </p>

      {origen === 'servicio' && dato.descripcion && (
        <p className={estilos.descripcion}>
          <span className={estilos.etiquetaTexto}>Lo que pediste:</span> {dato.descripcion}
        </p>
      )}

      {dato.precioUsdCentavos !== null && <p>Precio: {precioAprox(dato.precioUsdCentavos, usdBtc)}</p>}
      {dato.mensaje && <p className={estilos.mensaje}>{dato.mensaje}</p>}
      <p className={estilos.ayuda}>{fechaCorta(dato.creadaEn)}</p>

      {estado === 'solicitada' && <p>Esperando respuesta de {dato.negocioNombre}.</p>}

      {estado === 'ofrecida' && origen === 'servicio' && dato.precioUsdCentavos !== null && (
        <div className={estilos.bloque}>
          <BotonAccion
            accion={aceptarCotizacionAccion}
            campos={{ cotizacionId: dato.id }}
            etiqueta="Aceptar"
            confirmacion={{
              texto: `Vas a acordar este trabajo con ${dato.negocioNombre} por ${formatoUsd(dato.precioUsdCentavos)}. Pagás cuando esté hecho.`,
              etiquetaConfirmar: 'Sí, acordar el trabajo',
            }}
          />
          <BotonAccion
            accion={rechazarCotizacionAccion}
            campos={{ cotizacionId: dato.id }}
            etiqueta="Rechazar"
            variante="secundario"
          />
        </div>
      )}

      {estado === 'ofrecida' && origen === 'necesidad' && dato.necesidadId && (
        <p>
          <Link href={`/necesito/${dato.necesidadId}`}>Ver la oferta en la necesidad</Link>
        </p>
      )}

      {estado === 'aceptada' && dato.ordenId && (
        <p>
          <Link href={`/ordenes/${dato.ordenId}`}>Ver el trabajo</Link>
        </p>
      )}
    </article>
  );
}
