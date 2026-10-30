import Link from 'next/link';

import { ChipEstado } from '@/componentes/ChipEstado';
import { fechaEnvio } from '@/componentes/formatoEnvio';
import { formatoMonto } from '@/lib/cotizacion';
import type { Envio } from '@/servidor/transferencias';

import estilos from './estilos.module.css';

/** One transfer in the list: code, state, what was sent and what arrives, and when it was made. */
export function TarjetaEnvio({ envio }: { envio: Envio }) {
  return (
    <article className={estilos.tarjeta} aria-label={`Envío ${envio.codigo}`}>
      <div className={estilos.tarjetaCabecera}>
        <Link href={`/envios/${envio.id}`} className={`dato ${estilos.codigo}`}>
          {envio.codigo}
        </Link>
        <ChipEstado estado={envio.estado} entrega={envio.entrega} />
      </div>
      <p>
        Para <strong>{envio.destinatarioNombre}</strong>
      </p>
      <div className={estilos.cifras}>
        <p>
          Enviaste{' '}
          <span className="dato">{formatoMonto(envio.montoOrigenCentavos, envio.monedaOrigen)}</span>
        </p>
        <p>
          Recibe{' '}
          <span className="dato">{formatoMonto(envio.montoDestino, envio.monedaDestino)}</span>
        </p>
      </div>
      <p className={estilos.fecha}>Creado {fechaEnvio(envio.creadaEn)}</p>
    </article>
  );
}
