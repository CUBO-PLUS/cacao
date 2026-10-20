import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';

import { EtiquetaEstado } from '@/componentes/EtiquetaEstado';
import { fechaSv, tiempoEstimado } from '@/componentes/textosEnvio';
import { formatoMonto } from '@/lib/cotizacion';
import { accionesPosibles, ETIQUETA_ENTREGA, ETIQUETA_MONEDA } from '@/lib/transferencias';
import { cobroDeEnvio, type EstadoCobroEnvio } from '@/servidor/cobro';
import { exigirAdmin } from '@/servidor/sesion';
import { envioPara } from '@/servidor/transferencias';

import estilos from '../../estilos.module.css';

import { AccionesCobroAdmin } from './AccionesCobroAdmin';
import { AccionesEnvioAdmin } from './AccionesEnvioAdmin';

export const metadata: Metadata = {
  title: 'Detalle del envío',
};

// Blocking, so an unknown transfer gets a real 404 before anything streams.
export const instant = false;

const ETIQUETA_COBRO: Record<EstadoCobroEnvio, string> = {
  pagando: 'Pagando la factura',
  pagado: 'Cobrado por Lightning',
  fallido: 'Factura fallida, el destinatario puede pedir otra',
};

// Everything about one transfer, with the full contact and the admin's actions.
export default async function PaginaDetalleEnvio(props: PageProps<'/monitor/envios/[id]'>) {
  await connection();
  const { id } = await props.params;
  const sesion = await exigirAdmin(`/monitor/envios/${id}`);
  const envio = await envioPara(sesion.usuario, id);
  if (!envio) notFound();
  // A lightning transfer is collected by its recipient; the admin only sees how that claim went.
  const cobro = envio.entrega === 'lightning' ? await cobroDeEnvio(envio.id) : null;

  const tasa = envio.tasa.toLocaleString('en-US', { maximumFractionDigits: 8 });

  return (
    <article className={estilos.seccion} aria-labelledby="titulo-envio">
      <p>
        <Link href="/monitor/envios" className={estilos.volver}>
          ← Volver a los envíos
        </Link>
      </p>

      <h2 id="titulo-envio" className={estilos.codigoTitulo}>
        {envio.codigo}
      </h2>
      <p>
        <EtiquetaEstado estado={envio.estado} />
      </p>
      {envio.estado === 'fallida' && envio.motivo && <p>Motivo: {envio.motivo}</p>}
      {envio.pagoTardioEn && (
        <p role="alert" className={estilos.devolver}>
          Devolver pago: llegó un pago de Lightning después de cerrar el envío. Devolvé el dinero y anotalo en BTCPay.
        </p>
      )}

      <dl className={estilos.datos}>
        <div>
          <dt>Quién envía</dt>
          <dd>{envio.remitenteNombre || 'Sin nombre'}</dd>
        </div>
        <div>
          <dt>Destinatario</dt>
          <dd>{envio.destinatarioNombre}</dd>
        </div>
        <div>
          <dt>Contacto del destinatario</dt>
          <dd className={estilos.mono}>{envio.destinatarioContacto}</dd>
        </div>
        <div>
          <dt>Monto enviado</dt>
          <dd>{formatoMonto(envio.montoOrigenCentavos, envio.monedaOrigen)}</dd>
        </div>
        <div>
          <dt>Comisión</dt>
          <dd>{formatoMonto(envio.comisionCentavos, envio.monedaOrigen)}</dd>
        </div>
        <div>
          <dt>Monto neto</dt>
          <dd>{formatoMonto(envio.netoCentavos, envio.monedaOrigen)}</dd>
        </div>
        <div>
          <dt>Tipo de cambio</dt>
          <dd>
            {tasa} · {envio.tasaFuente}
          </dd>
        </div>
        <div>
          <dt>Recibe</dt>
          <dd>
            {formatoMonto(envio.montoDestino, envio.monedaDestino)} ({ETIQUETA_MONEDA[envio.monedaDestino]})
          </dd>
        </div>
        <div>
          <dt>Forma de entrega</dt>
          <dd>{ETIQUETA_ENTREGA[envio.entrega]}</dd>
        </div>
        <div>
          <dt>Tiempo estimado</dt>
          <dd>{tiempoEstimado(envio.minutosEstimados)}</dd>
        </div>
        <div>
          <dt>Nota</dt>
          <dd>{envio.nota.trim() || 'Sin nota'}</dd>
        </div>
        <div>
          <dt>Creado</dt>
          <dd>{fechaSv(envio.creadaEn)}</dd>
        </div>
      </dl>

      {cobro && (
        <dl className={estilos.datos}>
          <div>
            <dt>Cobro por Lightning</dt>
            <dd>{cobro.estado ? ETIQUETA_COBRO[cobro.estado] : 'Sin cobrar todavía'}</dd>
          </div>
          {cobro.motivo && (
            <div>
              <dt>Motivo del cobro</dt>
              <dd>{cobro.motivo}</dd>
            </div>
          )}
          {cobro.hash && (
            <div>
              <dt>Hash del pago</dt>
              <dd className={estilos.mono}>{cobro.hash}</dd>
            </div>
          )}
        </dl>
      )}

      <section aria-labelledby="titulo-historial">
        <h3 id="titulo-historial">Historial</h3>
        <ol className={estilos.historial}>
          {envio.historial.map((paso, i) => (
            <li key={`${paso.cuando}-${i}`}>
              <span>{paso.detalle}</span>
              <span className={estilos.mono}>{fechaSv(paso.cuando)}</span>
            </li>
          ))}
        </ol>
      </section>

      {cobro?.estado === 'pagando' && <AccionesCobroAdmin envioId={envio.id} />}

      <AccionesEnvioAdmin envioId={envio.id} acciones={accionesPosibles(envio.estado, 'admin', envio.entrega)} />
    </article>
  );
}
