import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';

import { ChipEstado } from '@/componentes/ChipEstado';
import { fechaEnvio, fraseDeLaSuma } from '@/componentes/formatoEnvio';
import { LineasDinero } from '@/componentes/LineasDinero';
import { Logo } from '@/componentes/Logo';
import { formatoUsd } from '@/lib/dinero';
import { desgloseTributarioEnvio } from '@/lib/hacienda';
import {
  accionesPosibles,
  descripcionDeEstado,
  ETIQUETA_ENTREGA,
  ETIQUETA_ESTADO,
} from '@/lib/transferencias';
import { exigirSesion } from '@/servidor/sesion';
import { envioPara, pagoLightningActivo } from '@/servidor/transferencias';

import { AccionesEnvio } from './AccionesEnvio';
import { BotonImprimir } from './BotonImprimir';
import { CopiarCodigo } from './CopiarCodigo';
import estilos from './estilos.module.css';
import { LineaTiempo } from './LineaTiempo';
import { SeguimientoEnCamino } from './SeguimientoEnCamino';

// Blocking, so a transfer that is not the visitor's gets a real 404 before anything streams.
export const instant = false;

// One transfer, for its sender or an administrator. The recipient is sent to their own view.
export default async function PaginaEnvio(props: PageProps<'/envios/[id]'>) {
  await connection();
  const { id } = await props.params;
  const sesion = await exigirSesion(`/envios/${id}`);
  const envio = await envioPara(sesion.usuario, id);
  if (!envio) notFound();
  if (envio.rol === 'destinatario') redirect(`/recibidos/${envio.id}`);

  const acciones = accionesPosibles(envio.estado, envio.rol);
  const enCamino = envio.estado === 'procesando';
  const tributario = desgloseTributarioEnvio(envio);

  return (
    <article className={estilos.envio}>
      <header className={estilos.encabezado}>
        <h1>
          Envío <span className="dato">{envio.codigo}</span>
        </h1>
        <div>
          <ChipEstado estado={envio.estado} />
        </div>
        <p>{descripcionDeEstado(envio.estado, 'remitente')}</p>
        <CopiarCodigo codigo={envio.codigo} />
        <div className={estilos.compartir}>
          <p>Pasale este código a quien recibe: puede seguirlo en cacaopay sin cuenta.</p>
          <Link href={`/t/${envio.codigo}`} className="dato">
            /t/{envio.codigo}
          </Link>
        </div>
      </header>

      <AccionesEnvio
        envioId={envio.id}
        acciones={acciones}
        pagoLightning={envio.rol === 'remitente' && pagoLightningActivo()}
      />
      {enCamino && <SeguimientoEnCamino envioId={envio.id} />}

      <section className={estilos.bloque} aria-labelledby="titulo-camino">
        <h2 id="titulo-camino">Cómo va el envío</h2>
        <LineaTiempo envio={envio} />
      </section>

      <section className={estilos.bloque} aria-labelledby="titulo-dinero">
        <h2 id="titulo-dinero">El detalle del dinero</h2>
        <LineasDinero datos={envio} tiempo="pasado" />
        <p className={estilos.suma}>{fraseDeLaSuma(envio)}</p>
      </section>

      <section className={estilos.bloque} aria-labelledby="titulo-destinatario">
        <h2 id="titulo-destinatario">Destinatario</h2>
        <dl className={estilos.datos}>
          <div>
            <dt>Nombre</dt> <dd>{envio.destinatarioNombre}</dd>
          </div>
          <div>
            <dt>Contacto</dt> <dd className="dato">{envio.destinatarioContacto ?? envio.destinatarioContactoEnmascarado}</dd>
          </div>
          <div>
            <dt>Cómo lo recibe</dt> <dd>{ETIQUETA_ENTREGA[envio.entrega]}</dd>
          </div>
          {envio.nota && (
            <div>
              <dt>Nota</dt> <dd>{envio.nota}</dd>
            </div>
          )}
        </dl>
      </section>

      <section className={estilos.bloque} aria-labelledby="titulo-hacienda">
        <h2 id="titulo-hacienda">Tratamiento tributario en El Salvador (DGII · BCR)</h2>
        <dl className={estilos.datos}>
          <div>
            <dt>Principal de la remesa</dt>{' '}
            <dd>Valores recibidos del exterior: no constituyen renta según el Art. 3 num. 4 LISR (alcance para remesas familiares no confirmado). IVA no verificado.</dd>
          </div>
          <div>
            <dt>Desglose fiscal del servicio (DTE 01)</dt>{' '}
            <dd className="dato">
              Base sin IVA {formatoUsd(tributario.baseSinIvaUsdCentavos)} + IVA 13% {formatoUsd(tributario.ivaUsdCentavos)} (F-07, v14 sin vigencia confirmada) · Pago a Cuenta 1.75% {formatoUsd(tributario.pagoACuentaUsdCentavos)} (F-14 v17). La base sin IVA es un supuesto de cálculo.
            </dd>
          </div>
          <div>
            <dt>Forma de pago CAT-017</dt> <dd className="dato">{tributario.etiquetaCat017}</dd>
          </div>
        </dl>
        <p className={estilos.nota}>
          <Link href="/hacienda">Ver el marco tributario y regulatorio completo</Link>.
        </p>
      </section>

      <section className={estilos.comprobante} aria-labelledby="titulo-comprobante">
        <div className={estilos.comprobanteCabecera}>
          <Logo />
          <h2 id="titulo-comprobante">Comprobante del envío</h2>
        </div>
        <dl className={estilos.datosComprobante}>
          <div>
            <dt>Código</dt> <dd className="dato">{envio.codigo}</dd>
          </div>
          <div>
            <dt>Creado</dt> <dd>{fechaEnvio(envio.creadaEn, true)}</dd>
          </div>
          {envio.procesandoEn && (
            <div>
              <dt>Salió</dt> <dd>{fechaEnvio(envio.procesandoEn, true)}</dd>
            </div>
          )}
          {envio.completadaEn && (
            <div>
              <dt>Entregado</dt> <dd>{fechaEnvio(envio.completadaEn, true)}</dd>
            </div>
          )}
          {envio.fallidaEn && (
            <div>
              <dt>No se pudo entregar</dt> <dd>{fechaEnvio(envio.fallidaEn, true)}</dd>
            </div>
          )}
          {envio.canceladaEn && (
            <div>
              <dt>Cancelado</dt> <dd>{fechaEnvio(envio.canceladaEn, true)}</dd>
            </div>
          )}
          <div>
            <dt>Estado</dt> <dd>{ETIQUETA_ESTADO[envio.estado]}</dd>
          </div>
          <div>
            <dt>Destinatario</dt> <dd>{envio.destinatarioNombre}</dd>
          </div>
          <div>
            <dt>Cómo lo recibe</dt> <dd>{ETIQUETA_ENTREGA[envio.entrega]}</dd>
          </div>
          {envio.motivo && (
            <div>
              <dt>Motivo</dt> <dd>{envio.motivo}</dd>
            </div>
          )}
        </dl>
        <LineasDinero datos={envio} tiempo="pasado" />
        <p className={estilos.pieComprobante}>Comprobante de una simulación. No es un documento tributario.</p>
      </section>

      <div className={estilos.noImprimir}>
        <BotonImprimir />
        <Link href="/envios" className={estilos.volver}>
          Volver a mis envíos
        </Link>
      </div>
    </article>
  );
}
