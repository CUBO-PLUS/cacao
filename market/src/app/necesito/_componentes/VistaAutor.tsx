import Link from 'next/link';

import { Estrellas } from '@/componentes/Estrellas';
import { ETIQUETA_COTIZACION } from '@/lib/servicios';
import { formatoUsd } from '@/lib/dinero';
import { aceptarCotizacionAccion, rechazarCotizacionAccion } from '@/app/cotizaciones/acciones';
import type { NecesidadParaUsuario, OfertaNecesidad } from '@/servidor/necesidades';

import { fechaCorta, precioAprox } from '../_comun/formato';
import estilos from '../estilos.module.css';

import { BotonAccion } from './BotonAccion';
import { cancelarNecesidadAccion } from '../acciones';

// What the author sees: every offer with its shop, price and message, and the actions for each one.
// Only the author gets this view; the page decides that on the server.
export function VistaAutor({
  vista,
  cotizacion,
}: {
  vista: NecesidadParaUsuario;
  cotizacion: number | null;
}) {
  const { necesidad, ofertas } = vista;
  const abierta = necesidad.estado === 'abierta';

  return (
    <>
      <section aria-labelledby="ofertas-titulo" className={estilos.bloque}>
        <h2 id="ofertas-titulo">Ofertas</h2>
        {ofertas.length === 0 ? (
          <p>Todavía no hay ofertas. Suelen llegar el mismo día.</p>
        ) : (
          <ul className={estilos.lista}>
            {ofertas.map((oferta) => (
              <li key={oferta.id}>
                <TarjetaOferta oferta={oferta} cotizacion={cotizacion} abierta={abierta} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Its own block with space above: it is the last action, not part of the last offer. */}
      <div className={estilos.seccion}>
        <BotonAccion
          accion={cancelarNecesidadAccion}
          campos={{ necesidadId: necesidad.id }}
          etiqueta="Cancelar esta necesidad"
          variante="secundario"
          confirmacion={{
            texto: 'Si la cancelás, las ofertas abiertas se cierran y nadie más puede ofertar. No se puede deshacer.',
            etiquetaConfirmar: 'Sí, cancelar',
          }}
          disponible={abierta}
        />
      </div>
    </>
  );
}

function TarjetaOferta({
  oferta,
  cotizacion,
  abierta,
}: {
  oferta: OfertaNecesidad;
  cotizacion: number | null;
  abierta: boolean;
}) {
  // Accepting and rejecting only make sense while the need is still open.
  const puedeResponder = abierta && oferta.estado === 'ofrecida' && oferta.precioUsdCentavos !== null;

  return (
    <article className={estilos.oferta} aria-labelledby={`oferta-${oferta.id}`}>
      <h3 id={`oferta-${oferta.id}`} className={estilos.subtitulo}>
        <Link href={`/negocios/${oferta.negocioId}`} prefetch={false}>{oferta.negocioNombre}</Link>
      </h3>
      {oferta.negocioResenas > 0 && oferta.negocioPromedio !== null && (
        <Estrellas valor={oferta.negocioPromedio} cantidad={oferta.negocioResenas} />
      )}
      {oferta.precioUsdCentavos !== null && (
        <p className={estilos.precioOferta}>{precioAprox(oferta.precioUsdCentavos, cotizacion)}</p>
      )}
      {oferta.mensaje && <p className={estilos.mensaje}>{oferta.mensaje}</p>}
      <p className={estilos.ayuda}>
        {fechaCorta(oferta.creadaEn)} · {ETIQUETA_COTIZACION[oferta.estado]}
      </p>

      <div className={estilos.bloque}>
        <BotonAccion
          accion={aceptarCotizacionAccion}
          campos={{ cotizacionId: oferta.id }}
          etiqueta="Aceptar"
          confirmacion={{
            texto: `Vas a acordar este trabajo con ${oferta.negocioNombre} por ${formatoUsd(oferta.precioUsdCentavos ?? 0)}. Pagás cuando esté hecho.`,
            etiquetaConfirmar: 'Sí, acordar el trabajo',
          }}
          disponible={puedeResponder}
        />
        <BotonAccion
          accion={rechazarCotizacionAccion}
          campos={{ cotizacionId: oferta.id }}
          etiqueta="Rechazar"
          variante="secundario"
          disponible={puedeResponder}
        />
      </div>
    </article>
  );
}
