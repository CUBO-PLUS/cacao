import type { ReactNode } from 'react';

import { formatoUsd } from '@/lib/dinero';
import { formatoMonto } from '@/lib/cotizacion';
import { descripcionDeEstado } from '@/lib/transferencias';
import type { RastreoPublico } from '@/servidor/transferencias';

import { ComoSeRecoge } from './ComoSeRecoge';
import { EtiquetaEstado } from './EtiquetaEstado';
import { LineaDeTiempo } from './LineaDeTiempo';
import { TEXTO_ENTREGA_DESTINATARIO, tiempoEstimado } from './textosEnvio';
import estilos from './VistaDestinatario.module.css';

type Props = {
  /** "Marta, te mandaron dinero" */
  saludo: string;
  envio: Pick<RastreoPublico, 'codigo' | 'estado' | 'monedaDestino' | 'montoDestino' | 'entrega' | 'minutosEstimados' | 'historial'>;
  /** The dollars fixed when the transfer was quoted, in cents. Null when there are none to show. */
  usdCentavos: number | null;
  /** Extra blocks for the signed-in recipient: the sender and the note. */
  extra?: ReactNode;
};

// What a recipient reads about one transfer: the amount, how it arrives, the state and the steps.
// The same view serves the public tracking page and the recipient's own page.
export function VistaDestinatario({ saludo, envio, usdCentavos, extra }: Props) {
  const esperando = envio.estado === 'creada' || envio.estado === 'procesando';
  const tiempo = esperando
    ? envio.estado === 'creada'
      ? `Cuando salga, llega ${tiempoEstimado(envio.minutosEstimados)}.`
      : `Llega ${tiempoEstimado(envio.minutosEstimados)}.`
    : null;

  return (
    <div className={estilos.vista}>
      <h1 className={estilos.saludo}>{saludo}</h1>

      <section className={estilos.monto} aria-labelledby="titulo-monto">
        <h2 id="titulo-monto" className={estilos.etiqueta}>
          Vas a recibir
        </h2>
        <p className={estilos.cifra}>{formatoMonto(envio.montoDestino, envio.monedaDestino)}</p>
        {envio.monedaDestino === 'SATS' && usdCentavos !== null && (
          <div className={estilos.dolares}>
            <p>{`Unos ${formatoUsd(usdCentavos)} en dólares, al cambio del momento de enviar.`}</p>
          </div>
        )}
        <p className={estilos.entrega}>{TEXTO_ENTREGA_DESTINATARIO[envio.entrega]}</p>
      </section>

      <section className={estilos.estado} aria-labelledby="titulo-estado" aria-live="polite">
        <h2 id="titulo-estado" className={estilos.etiqueta}>
          Estado del envío
        </h2>
        <p>
          <EtiquetaEstado estado={envio.estado} entrega={envio.entrega} grande />
        </p>
        <p className={estilos.texto}>{descripcionDeEstado(envio.estado, 'destinatario', envio.entrega)}</p>
        {tiempo && <p className={estilos.tiempo}>{tiempo}</p>}
      </section>

      <ComoSeRecoge entrega={envio.entrega} codigo={envio.codigo} estado={envio.estado} />

      <section className={estilos.pasos} aria-labelledby="titulo-pasos">
        <h2 id="titulo-pasos" className={estilos.etiqueta}>
          Cómo va
        </h2>
        <LineaDeTiempo estado={envio.estado} historial={envio.historial} />
      </section>

      {extra}
    </div>
  );
}
