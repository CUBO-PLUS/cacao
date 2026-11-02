import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  ETIQUETA_COBRO,
  ETIQUETA_MODO,
  ETIQUETA_PROVEEDOR,
  ETIQUETA_RESULTADO,
  etiquetaAccion,
  formatoFecha,
  montoExacto,
  nombreVisible,
} from '@/app/admin/etiquetas';
import { formatoSats, formatoUsd } from '@/lib/dinero';
import { ETIQUETA_ESTADO } from '@/lib/estados';
import { ordenDetalleAdmin } from '@/servidor/admin';
import { exigirAdmin } from '@/servidor/sesion';

import estilos from '../../estilos.module.css';
import { TablaAdmin } from '../../TablaAdmin';

export const metadata: Metadata = {
  title: 'Orden',
};

// Read-only. The delivery code and the payment verify URL are never read on this page.
export default async function PaginaOrden(props: { params: Promise<{ id: string }> }) {
  const sesion = await exigirAdmin();
  const { id } = await props.params;
  const orden = await ordenDetalleAdmin(sesion.usuario.id, id);
  if (!orden) notFound();

  const esTrabajo = orden.tipo === 'servicio';

  // A job is agreed (created as `acordada`), done, paid or cancelled. It has no delivery step.
  const fechas: [string, string | null][] = esTrabajo
    ? [
        ['Acordada', orden.creadaEn],
        ['Hecha', orden.hechaEn],
        ['Pagada', orden.pagadaEn],
        ['Cancelada', orden.canceladaEn],
        ['Disputada', orden.disputadaEn],
        ['Resuelta', orden.resueltaEn],
      ]
    : [
        ['Creada', orden.creadaEn],
        ['Pagada', orden.pagadaEn],
        ['Lista', orden.listaEn],
        ['Entregada', orden.entregadaEn],
        ['Cerrada', orden.cerradaEn],
        ['Expirada', orden.expiradaEn],
        ['Cancelada', orden.canceladaEn],
        ['Disputada', orden.disputadaEn],
        ['Resuelta', orden.resueltaEn],
      ];

  return (
    <article className={estilos.bloque} aria-labelledby="titulo-orden">
      <Link href="/admin/ordenes" className={estilos.enlaceVolver}>
        ← Volver a las órdenes
      </Link>

      <div className={estilos.cabeceraTarjeta}>
        <h2 id="titulo-orden" className={estilos.subtitulo}>
          {esTrabajo ? `Trabajo ${orden.numero}` : `Orden ${orden.numero}`}
        </h2>
        <span className={estilos.estado}>{ETIQUETA_ESTADO[orden.estado]}</span>
      </div>

      <section aria-labelledby="resumen-orden" className={estilos.tarjetaGrande}>
        <h3 id="resumen-orden" className={estilos.subtitulo}>
          Resumen
        </h3>
        <dl className={estilos.datos}>
          <div>
            <dt>Negocio</dt>
            <dd>{orden.negocio || '—'}</dd>
          </div>
          <div>
            <dt>Dueño del negocio</dt>
            <dd>{nombreVisible(orden.vendedor)}</dd>
          </div>
          <div>
            <dt>Comprador</dt>
            <dd>{nombreVisible(orden.comprador)}</dd>
          </div>
          {!esTrabajo && (
            <div>
              <dt>Entrega</dt>
              <dd>{orden.modoEntrega === null ? '—' : (ETIQUETA_MODO[orden.modoEntrega] ?? orden.modoEntrega)}</dd>
            </div>
          )}
          {orden.motivoCancelacion !== null && (
            <div className={estilos.ancho}>
              <dt>Motivo de la cancelación</dt>
              <dd className={estilos.textoLargo}>{orden.motivoCancelacion}</dd>
            </div>
          )}
          <div className={estilos.ancho}>
            <dt>Total</dt>
            <dd className={estilos.dato}>{montoExacto(orden.totalSats, orden.totalUsdCentavos)}</dd>
          </div>
          <div>
            <dt>Cotización usada</dt>
            <dd className={estilos.dato}>{formatoUsd(Math.round(orden.cotizacionUsdBtc * 100))} por bitcoin</dd>
          </div>
          <div>
            <dt>Comisión teórica (no se cobra)</dt>
            <dd className={estilos.dato}>{formatoSats(orden.comisionTeoricaSats)}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="productos-orden" className={estilos.bloque}>
        <h3 id="productos-orden" className={estilos.subtitulo}>
          {esTrabajo ? 'Detalle del trabajo' : 'Productos'}
        </h3>
        {orden.lineas.length === 0 ? (
          <p className={estilos.vacio}>{esTrabajo ? 'Este trabajo no tiene detalle.' : 'Esta orden no tiene productos.'}</p>
        ) : (
          <ul className={estilos.listaLineas}>
            {orden.lineas.map((l, i) => (
              <li key={i} className={estilos.tarjeta}>
                <span className={estilos.tarjetaTitulo}>{l.nombre}</span>
                <span>
                  {esTrabajo
                    ? formatoUsd(l.precioUsdCentavos)
                    : `${l.cantidad} × ${l.unidad} · ${formatoUsd(l.precioUsdCentavos)} por unidad`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="pago-orden" className={estilos.bloque}>
        <h3 id="pago-orden" className={estilos.subtitulo}>
          Pedido de pago
        </h3>
        {orden.cobro === null ? (
          <p className={estilos.vacio}>Todavía no hay pedido de pago.</p>
        ) : (
          <dl className={estilos.datos}>
            <div>
              <dt>Proveedor</dt>
              <dd>{ETIQUETA_PROVEEDOR[orden.cobro.proveedor] ?? orden.cobro.proveedor}</dd>
            </div>
            <div>
              <dt>Estado</dt>
              <dd>{ETIQUETA_COBRO[orden.cobro.estado] ?? orden.cobro.estado}</dd>
            </div>
            <div>
              <dt>Vence</dt>
              <dd>{formatoFecha(orden.cobro.expiraEn)}</dd>
            </div>
            <div>
              <dt>Pagado</dt>
              <dd>{formatoFecha(orden.cobro.pagadoEn)}</dd>
            </div>
          </dl>
        )}
      </section>

      <section aria-labelledby="fechas-orden" className={estilos.bloque}>
        <h3 id="fechas-orden" className={estilos.subtitulo}>
          Fechas
        </h3>
        <dl className={estilos.datos}>
          {fechas
            .filter(([, fecha], i) => i === 0 || fecha !== null)
            .map(([nombre, fecha]) => (
              <div key={nombre}>
                <dt>{nombre}</dt>
                <dd>{formatoFecha(fecha)}</dd>
              </div>
            ))}
        </dl>
      </section>

      <section aria-labelledby="chat-orden" className={estilos.bloque}>
        <h3 id="chat-orden" className={estilos.subtitulo}>
          Chat
        </h3>
        {orden.mensajes.length === 0 ? (
          <p className={estilos.vacio}>No hay mensajes en esta orden.</p>
        ) : (
          <ol className={estilos.mensajes}>
            {orden.mensajes.map((m) => (
              <li key={m.id} className={estilos.mensaje}>
                <p className={estilos.mensajeAutor}>
                  {nombreVisible(m.autor)} · {m.rol} · {formatoFecha(m.creadoEn)}
                </p>
                <p>{m.texto}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="disputa-orden" className={estilos.bloque}>
        <h3 id="disputa-orden" className={estilos.subtitulo}>
          Disputa
        </h3>
        {orden.disputa === null ? (
          <p className={estilos.vacio}>No hay disputa en esta orden.</p>
        ) : (
          <div className={estilos.tarjetaGrande}>
            <dl className={estilos.datos}>
              <div>
                <dt>Estado</dt>
                <dd>{orden.disputa.estado === 'abierta' ? 'Abierta' : 'Resuelta'}</dd>
              </div>
              <div>
                <dt>Abierta</dt>
                <dd>{formatoFecha(orden.disputa.creadaEn)}</dd>
              </div>
              <div className={estilos.ancho}>
                <dt>Motivo</dt>
                <dd className={estilos.textoLargo}>{orden.disputa.motivo}</dd>
              </div>
              <div className={estilos.ancho}>
                <dt>Evidencia</dt>
                <dd className={estilos.textoLargo}>{orden.disputa.evidencia || 'Sin evidencia'}</dd>
              </div>
              {orden.disputa.estado === 'resuelta' && (
                <>
                  <div>
                    <dt>Resultado</dt>
                    <dd>{orden.disputa.resultado ? ETIQUETA_RESULTADO[orden.disputa.resultado] : '—'}</dd>
                  </div>
                  <div>
                    <dt>Resuelta por</dt>
                    <dd>{nombreVisible(orden.disputa.resueltaPor)}</dd>
                  </div>
                  <div className={estilos.ancho}>
                    <dt>Nota de resolución</dt>
                    <dd className={estilos.textoLargo}>{orden.disputa.notaResolucion || '—'}</dd>
                  </div>
                </>
              )}
            </dl>
            <p>
              <Link href="/admin/disputas">Ver en disputas</Link>
            </p>
          </div>
        )}
      </section>

      <section aria-labelledby="auditoria-orden" className={estilos.bloque}>
        <h3 id="auditoria-orden" className={estilos.subtitulo}>
          Auditoría de la orden
        </h3>
        {orden.auditoria.length === 0 ? (
          <p className={estilos.vacio}>Todavía no hay cambios registrados.</p>
        ) : (
          <TablaAdmin
            titulo="Cambios registrados en la orden"
            encabezados={['Cuándo', 'Quién', 'Acción', 'Detalle']}
            filas={orden.auditoria.map((a) => ({
              clave: String(a.id),
              celdas: [
                formatoFecha(a.creadoEn),
                a.quien === null ? 'Sistema' : nombreVisible(a.quien),
                etiquetaAccion(a.accion),
                <ul key="d" className={estilos.detalleClaves}>
                  {a.detalle.map((d) => (
                    <li key={d.clave}>
                      {d.clave}: {d.valor}
                    </li>
                  ))}
                </ul>,
              ],
            }))}
          />
        )}
      </section>
    </article>
  );
}
