import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';

import { ChipEstado } from '@/componentes/ChipEstado';
import { CodigoQr } from '@/componentes/CodigoQr';
import { ComoSeRecoge } from '@/componentes/ComoSeRecoge';
import { fechaEnvio, fraseDeLaSuma } from '@/componentes/formatoEnvio';
import { LineasDinero } from '@/componentes/LineasDinero';
import { Logo } from '@/componentes/Logo';
import { primerNombre } from '@/componentes/textosEnvio';
import { formatoSats, formatoUsd } from '@/lib/dinero';
import { formatoMonto } from '@/lib/cotizacion';
import { enlaceRastreo, enlaceWhatsapp, mensajeRastreo } from '@/lib/compartir';
import { desgloseTributarioEnvio } from '@/lib/hacienda';
import {
  accionesPosibles,
  descripcionDeEstado,
  ETIQUETA_ENTREGA,
  usdCotizadoCentavos,
} from '@/lib/transferencias';
import { cobroDeEnvio, enlaceDeCobro } from '@/servidor/cobro';
import { exigirSesion } from '@/servidor/sesion';
import { envioPara, pagoLightningActivo } from '@/servidor/transferencias';

import { AccionesEnvio } from './AccionesEnvio';
import { BotonImprimir } from './BotonImprimir';
import { CopiarCodigo } from './CopiarCodigo';
import { EnlaceCobro } from './EnlaceCobro';
import estilos from './estilos.module.css';
import { LineaTiempo } from './LineaTiempo';
import { RecuperarDinero } from './RecuperarDinero';
import { SeguimientoEnCamino } from './SeguimientoEnCamino';

// Blocking, so a transfer that is not the visitor's gets a real 404 before anything streams.
export const instant = false;

// Shortens a payment hash for a receipt: the first and the last characters.
function hashCorto(hash: string): string {
  return hash.length > 16 ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : hash;
}

// One transfer, for its sender or an administrator. The recipient is sent to their own view.
export default async function PaginaEnvio(props: PageProps<'/envios/[id]'>) {
  await connection();
  const { id } = await props.params;
  const sesion = await exigirSesion(`/envios/${id}`);
  const envio = await envioPara(sesion.usuario, id);
  if (!envio) notFound();
  if (envio.rol === 'destinatario') redirect(`/recibidos/${envio.id}`);

  // The sender pays the invoice whatever the way of delivery, once BTCPay is set up on this server.
  const pagoLightning = envio.rol === 'remitente' && envio.estado === 'creada' && (await pagoLightningActivo());
  const acciones = accionesPosibles(envio.estado, envio.rol, envio.entrega, {
    pagada: envio.pagadaEn !== null,
    facturaViva: envio.facturaViva,
    pagoLightning,
  });
  const enCamino = envio.estado === 'procesando';
  const tributario = desgloseTributarioEnvio(envio);
  const cobro = envio.entrega === 'lightning' ? await cobroDeEnvio(envio.id) : null;
  // The sender shares the claim link once the transfer is paid and until the recipient collects it. Before the
  // payment the link would only lead to a "waiting" page.
  // Once the claim window has closed the link would only lead to "expired": the sender gets the money back instead.
  const enlaceCobro =
    envio.rol === 'remitente' && envio.entrega === 'lightning' && envio.estado === 'procesando' && !envio.cobroVencido
      ? enlaceDeCobro(cobro)
      : null;
  // The sender takes the money back after the claim window, while nobody holds the transfer for a claim.
  const devolucion = cobro?.devolucion ?? null;
  const puedeRecuperar =
    envio.rol === 'remitente' &&
    envio.entrega === 'lightning' &&
    envio.estado === 'procesando' &&
    envio.cobroVencido &&
    envio.satsPagados !== null &&
    cobro?.estado !== 'pagando';
  // The dollar value shown next to the sats in the claim share text: the figure fixed when the transfer was quoted.
  const usdEnvio = usdCotizadoCentavos(envio);
  const dolaresEnlace = enlaceCobro && usdEnvio !== null ? formatoUsd(usdEnvio) : null;
  const rastreo = enlaceRastreo(envio.codigo);
  const whatsapp = enlaceWhatsapp(mensajeRastreo(envio.codigo, rastreo));
  const completada = envio.estado === 'completada';

  return (
    <article className={estilos.envio}>
      <header className={estilos.encabezado}>
        <h1>
          Envío <span className="dato">{envio.codigo}</span>
        </h1>
        <div>
          <ChipEstado estado={envio.estado} entrega={envio.entrega} />
        </div>
        <p>{descripcionDeEstado(envio.estado, 'remitente', envio.entrega)}</p>
        <CopiarCodigo codigo={envio.codigo} />
        <div className={estilos.compartir}>
          <p>Pasale este código a quien recibe: puede seguirlo en cacaopay sin cuenta.</p>
          <Link href={`/t/${envio.codigo}`} className="dato">
            /t/{envio.codigo}
          </Link>
          <a className="boton boton--secundario" href={whatsapp} target="_blank" rel="noopener">
            Compartir por WhatsApp
          </a>
        </div>
      </header>

      {enlaceCobro && (
        <EnlaceCobro
          enlace={enlaceCobro}
          sats={formatoMonto(envio.montoDestino, envio.monedaDestino)}
          dolares={dolaresEnlace}
        />
      )}

      {puedeRecuperar && envio.satsPagados !== null && (
        <RecuperarDinero
          envioId={envio.id}
          sats={formatoSats(envio.satsPagados)}
          enCurso={devolucion === 'pagando'}
          motivo={devolucion === 'fallido' ? (cobro?.devolucionMotivo ?? null) : null}
        />
      )}

      <AccionesEnvio
        envioId={envio.id}
        acciones={acciones}
        pagoLightning={pagoLightning}
        entrega={envio.entrega}
        sinBitcoin={envio.rol === 'remitente' && envio.entrega === 'lightning' && envio.estado === 'creada' && !pagoLightning}
      />
      {enCamino && <SeguimientoEnCamino envioId={envio.id} />}
      <ComoSeRecoge entrega={envio.entrega} codigo={envio.codigo} estado={envio.estado} />

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
        <h2 id="titulo-hacienda">Impuestos del envío</h2>
        <p>Cacao Pay calcula los impuestos de este envío y los deja registrados.</p>
        <details className={estilos.detalle}>
          <summary>Ver detalle</summary>
          <dl className={estilos.datos}>
            <div>
              <dt>Tipo de envío</dt>{' '}
              <dd>Remesa familiar recibida del exterior. Referencia: Art. 3 núm. 4 LISR (alcance por confirmar con tu contador).</dd>
            </div>
            <div>
              <dt>Desglose</dt>{' '}
              <dd className="dato">
                Base sin IVA {formatoUsd(tributario.baseSinIvaUsdCentavos)} + IVA 13% {formatoUsd(tributario.ivaUsdCentavos)} ·
                Pago a cuenta 1.75% {formatoUsd(tributario.pagoACuentaUsdCentavos)}
              </dd>
            </div>
            <div>
              <dt>Forma de pago</dt> <dd className="dato">{tributario.etiquetaCat017}</dd>
            </div>
          </dl>
          <p className={estilos.nota}>
            <Link href="/hacienda">Ver el marco tributario y regulatorio completo</Link>.
          </p>
        </details>
      </section>

      {completada && (
        <section className={estilos.comprobante} aria-labelledby="titulo-comprobante">
          <div className={estilos.comprobanteCabecera}>
            <Logo />
            <h2 id="titulo-comprobante">Comprobante del envío</h2>
          </div>
          <dl className={estilos.datosComprobante}>
            <div>
              <dt>Número</dt> <dd className="dato">{envio.codigo}</dd>
            </div>
            <div>
              <dt>Fecha</dt> <dd>{fechaEnvio(envio.completadaEn ?? envio.creadaEn, true)}</dd>
            </div>
            <div>
              <dt>De</dt> <dd>{primerNombre(envio.remitenteNombre, 'Quien envió')}</dd>
            </div>
            <div>
              <dt>Para</dt> <dd>{primerNombre(envio.destinatarioNombre)}</dd>
            </div>
            <div>
              <dt>Enviado</dt> <dd className="dato">{formatoMonto(envio.montoOrigenCentavos, envio.monedaOrigen)}</dd>
            </div>
            <div>
              <dt>Comisión</dt> <dd className="dato">{formatoMonto(envio.comisionCentavos, envio.monedaOrigen)}</dd>
            </div>
            <div>
              <dt>Recibido</dt> <dd className="dato">{formatoMonto(envio.montoDestino, envio.monedaDestino)}</dd>
            </div>
            <div>
              <dt>Entrega</dt> <dd>{ETIQUETA_ENTREGA[envio.entrega]}</dd>
            </div>
          </dl>
          {envio.entrega === 'lightning' && cobro?.hash && (
            <details className={estilos.detalle}>
              <summary>Ver detalle</summary>
              <p>
                Código del pago en bitcoin: <span className="dato">{hashCorto(cobro.hash)}</span>
              </p>
            </details>
          )}
          <div className={estilos.qr}>
            <CodigoQr texto={rastreo} titulo={`Escaneá para ver el envío ${envio.codigo}`} />
          </div>
        </section>
      )}

      <div className={`${estilos.noImprimir} no-imprimir`}>
        {completada && (
          <div className={estilos.botonesRecibo}>
            <BotonImprimir />
          </div>
        )}
        {envio.rol === 'remitente' && (
          <Link href={`/enviar?repetir=${envio.id}`} className="boton boton--secundario">
            Repetir envío
          </Link>
        )}
        <Link href="/envios" className={estilos.volver}>
          Volver a mis envíos
        </Link>
      </div>
    </article>
  );
}
