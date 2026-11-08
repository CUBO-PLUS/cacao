import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { Boton } from '@/componentes/Boton';
import { AvisoPedidoDemo } from '@/componentes/Demo';
import { EtiquetaPrecio } from '@/componentes/EtiquetaPrecio';
import { Estrellas } from '@/componentes/Estrellas';
import { ProximoPaso } from '@/componentes/ProximoPaso';
import { formatoSats, formatoUsd, usdCentavosASats } from '@/lib/dinero';
import { accionesPosibles, descripcionDeEstado, ETIQUETA_RESULTADO } from '@/lib/estados';
import { mensajesDe } from '@/servidor/mensajes';
import { detalleDeOrden, paraAcciones } from '@/servidor/pedidos';
import { exigirSesion } from '@/servidor/sesion';

import { fechaCorta } from '../fechas';

import { SIGUIENTES_PASOS } from './siguientes';

import { AccionesOrden } from './AccionesOrden';
import { Chat } from './Chat';
import { Cronologia } from './Cronologia';
import { EstadoVivo, OrdenViva } from './OrdenViva';
import styles from './orden.module.css';

// One page for both parties. The id comes from the URL, so the order is read per request.
// Anyone who is not a party gets notFound(), the same answer as for a missing order.
export default function PaginaOrden(props: PageProps<'/ordenes/[id]'>) {
  return (
    <Suspense fallback={<p role="status">Cargando la orden…</p>}>
      <Orden params={props.params} />
    </Suspense>
  );
}

// Groups the delivery code in threes: "482 913".
function partirCodigo(codigo: string): string {
  return `${codigo.slice(0, 3)} ${codigo.slice(3)}`;
}

async function Orden({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sesion = await exigirSesion(`/ordenes/${id}`);
  const detalle = await detalleDeOrden(id, sesion);
  if (!detalle) notFound();

  const mensajes = (await mensajesDe(id, sesion)) ?? [];
  // The buttons are exactly what the state machine allows for this role.
  const acciones = accionesPosibles(paraAcciones(detalle), detalle.rol);
  const esComprador = detalle.rol === 'comprador';
  const trabajo = detalle.tipo === 'servicio';
  // A job's sats are set when the client's payment request is made, not when it is agreed.
  const satsFijos = detalle.pagadaEn !== null || detalle.estado === 'esperando_pago';
  const satsAproximados = trabajo && !satsFijos && detalle.estado !== 'cancelada';
  const cotizacionTexto = `1 BTC = ${formatoUsd(Math.round(detalle.cotizacionUsdBtc * 100))}`;
  const modoTexto = detalle.modoEntrega === 'recogida' ? 'Recogida en punto' : 'Entrega por el vendedor';
  const parte = trabajo
    ? `${esComprador ? 'Quien trabaja' : 'Cliente'}: ${detalle.otraParte}`
    : `${esComprador ? 'Tienda' : 'Comprador'}: ${detalle.otraParte}`;
  // A demo order is not on its way from a real business: its state sentences are replaced by the notice.
  const descripcion = detalle.demo ? null : descripcionDeEstado(detalle.estado, detalle.rol, detalle.tipo);
  // A job's reminder while agreed or done: who pays and when.
  const recordatorio =
    trabajo && (detalle.estado === 'acordada' || detalle.estado === 'hecha')
      ? esComprador
        ? 'Pagás cuando el trabajo esté hecho. CacaoMarket no guarda tu dinero.'
        : 'Cobrás al terminar. Coordiná bien antes de ir.'
      : null;

  return (
    <OrdenViva estado={detalle.estado}>
      <article className={styles.orden} aria-labelledby="orden-titulo">
        <header className={styles.cabecera}>
          <p>
            <Link href={esComprador ? '/ordenes' : '/mi-negocio/ordenes'} className={styles.volver}>
              ← Volver a {esComprador ? (trabajo ? 'mis órdenes' : 'mis compras') : 'mis ventas'}
            </Link>
          </p>
          <h1 id="orden-titulo">{trabajo ? `Trabajo ${detalle.numero}` : `Orden ${detalle.numero}`}</h1>
          <p className={styles.parte}>{parte}</p>
          <EstadoVivo ordenId={detalle.id} />
          {/* The provider's agreed sentence is the same text as the reminder: show it once. */}
          {descripcion !== null && descripcion !== recordatorio && <p>{descripcion}</p>}
          {detalle.pagadaEn !== null && (
            <p>
              <Boton href={`/ordenes/${detalle.id}/recibo`} variante="secundario">
                Ver comprobante
              </Boton>
            </p>
          )}
        </header>

        <AvisoPedidoDemo activo={detalle.demo} />
        {recordatorio !== null && <p className={styles.recordatorio}>{recordatorio}</p>}

        {acciones.length > 0 && (
          <section aria-labelledby="que-sigue" className={styles.bloque}>
            <h2 id="que-sigue">Qué sigue</h2>
            <AccionesOrden
              ordenId={detalle.id}
              acciones={acciones}
              trabajo={trabajo}
              pagada={detalle.pagadaEn !== null}
            />
          </section>
        )}

        {detalle.codigoEntrega && (
          <section aria-labelledby="codigo-titulo" className={styles.codigo}>
            <h2 id="codigo-titulo">Código de entrega</h2>
            <p className={styles.codigoNumero}>{partirCodigo(detalle.codigoEntrega)}</p>
            <p>Mostráselo al vendedor cuando recibás tu pedido. No lo compartás antes.</p>
          </section>
        )}

        {/* After a payment the buyer sees the next step; the seller of a paid order has none. */}
        {esComprador && detalle.pagadaEn !== null && (
          <ProximoPaso
            id="ahora-titulo"
            intro="Tu pago quedó registrado. Guardá el comprobante por si lo necesitás."
            opciones={SIGUIENTES_PASOS}
          />
        )}

        {/* A job's steps: agreed, done, paid (the entregada step), closed. */}
        <Cronologia
          tipo={detalle.tipo}
          estado={detalle.estado}
          motivo={detalle.motivoCancelacion}
          fechas={
            trabajo
              ? {
                  acordada: detalle.creadaEn,
                  hecha: detalle.hechaEn,
                  entregada: detalle.pagadaEn,
                  cerrada: detalle.cerradaEn,
                  cancelada: detalle.canceladaEn,
                  disputada: detalle.disputadaEn,
                  resuelta: detalle.resueltaEn,
                }
              : {
                  pagada: detalle.pagadaEn,
                  lista: detalle.listaEn,
                  entregada: detalle.entregadaEn,
                  cerrada: detalle.cerradaEn,
                  expirada: detalle.expiradaEn,
                  cancelada: detalle.canceladaEn,
                  disputada: detalle.disputadaEn,
                  resuelta: detalle.resueltaEn,
                }
          }
        />

        <section aria-labelledby="productos-titulo" className={styles.bloque}>
          <h2 id="productos-titulo">{trabajo ? 'Qué se acordó' : 'Productos y total'}</h2>
          <ul className={styles.lineas}>
            {detalle.lineas.map((linea) => {
              const subtotal = linea.precioUsdCentavos * linea.cantidad;
              const sats = usdCentavosASats(subtotal, detalle.cotizacionUsdBtc);
              if (trabajo) {
                // The unit reads like the service price ("por persona"); a need's job has the unit "trabajo".
                const precio = formatoUsd(linea.precioUsdCentavos);
                const unidad = linea.unidad === 'trabajo' ? '' : ` ${linea.unidad}`;
                return (
                  <li key={linea.id} className={styles.linea}>
                    <span className={styles.lineaNombre}>{linea.nombre}</span>
                    <span className="dato">
                      {linea.cantidad > 1 ? `${linea.cantidad} × ` : ''}
                      {precio}
                      {unidad}
                    </span>
                    <span className={styles.totales}>
                      {formatoSats(sats)} · {formatoUsd(subtotal)}
                    </span>
                  </li>
                );
              }
              return (
                <li key={linea.id} className={styles.linea}>
                  <span className={styles.lineaNombre}>{linea.nombre}</span>
                  <span className="dato">
                    {linea.cantidad} × {formatoUsd(linea.precioUsdCentavos)} por {linea.unidad}
                  </span>
                  <span className={styles.totales}>
                    {formatoSats(sats)} · {formatoUsd(subtotal)}
                  </span>
                </li>
              );
            })}
          </ul>
          <dl className={styles.datos}>
            <div>
              <dt>Total</dt>
              <dd>
                <EtiquetaPrecio usdCentavos={detalle.totalUsdCentavos} sats={detalle.totalSats} />
                {satsAproximados && <p className={styles.aproximado}>Aproximado. Los sats se fijan cuando pagás.</p>}
              </dd>
            </div>
            {/* A job shows its quote once the sats are fixed. */}
            {(!trabajo || satsFijos) && (
              <div>
                <dt>Cotización usada</dt>
                <dd className="dato">{cotizacionTexto}</dd>
              </div>
            )}
            {/* A job has no delivery mode. */}
            {detalle.modoEntrega !== null && !detalle.demo && (
              <div>
                <dt>Entrega</dt>
                <dd>{modoTexto}</dd>
              </div>
            )}
          </dl>
        </section>

        {detalle.disputa && (
          <section aria-labelledby="disputa-titulo" className={styles.bloque}>
            <h2 id="disputa-titulo">Disputa</h2>
            <dl className={styles.datos}>
              <div>
                <dt>Estado</dt>
                <dd>{detalle.disputa.estado === 'abierta' ? 'Abierta, en revisión' : 'Resuelta'}</dd>
              </div>
              <div>
                <dt>Motivo</dt>
                <dd>{detalle.disputa.motivo}</dd>
              </div>
              {detalle.disputa.evidencia && (
                <div>
                  <dt>Evidencia</dt>
                  <dd>{detalle.disputa.evidencia}</dd>
                </div>
              )}
              <div>
                <dt>Abierta el</dt>
                <dd className="dato">{fechaCorta(detalle.disputa.creadaEn)}</dd>
              </div>
              {detalle.disputa.resultado && (
                <div>
                  <dt>Resultado</dt>
                  <dd>{ETIQUETA_RESULTADO[detalle.disputa.resultado]}</dd>
                </div>
              )}
              {detalle.disputa.notaResolucion && (
                <div>
                  <dt>Nota del administrador</dt>
                  <dd>{detalle.disputa.notaResolucion}</dd>
                </div>
              )}
              {detalle.disputa.reembolsoMarcadoEn && (
                <div>
                  <dt>Reembolso</dt>
                  <dd>Marcado por el vendedor el {fechaCorta(detalle.disputa.reembolsoMarcadoEn)}</dd>
                </div>
              )}
              {detalle.disputa.reembolsoConfirmadoEn && (
                <div>
                  <dt>Confirmación</dt>
                  <dd>Confirmado por el comprador el {fechaCorta(detalle.disputa.reembolsoConfirmadoEn)}</dd>
                </div>
              )}
            </dl>
          </section>
        )}

        {detalle.resena && (
          <section aria-labelledby="resena-titulo" className={styles.bloque}>
            <h2 id="resena-titulo">{esComprador ? 'Tu reseña' : 'Reseña del comprador'}</h2>
            <div className="resena">
              <Estrellas valor={detalle.resena.puntuacion} />
              <p>{detalle.resena.comentario || 'Sin comentario.'}</p>
              <time className="dato" dateTime={detalle.resena.creadaEn}>
                {fechaCorta(detalle.resena.creadaEn)}
              </time>
            </div>
          </section>
        )}

        <section aria-labelledby="chat-titulo" className={styles.bloque}>
          <h2 id="chat-titulo">Chat</h2>
          <Chat
            ordenId={detalle.id}
            usuarioId={sesion.usuario.id}
            otraParte={detalle.otraParte}
            soloLectura={detalle.estado === 'expirada' || detalle.estado === 'cancelada'}
            motivoSoloLectura={
              detalle.estado === 'cancelada'
                ? trabajo
                  ? 'El trabajo se canceló. El chat quedó en solo lectura.'
                  : 'El pedido se canceló. El chat quedó en solo lectura.'
                : undefined
            }
            inicial={mensajes}
          />
        </section>
      </article>
    </OrdenViva>
  );
}
