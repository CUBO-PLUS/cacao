import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';

import { formatoSats, formatoUsd, usdCentavosASats } from '@/lib/dinero';
import { URL_LEDGER } from '@/lib/grupo';
import { detalleDeOrden, referenciaDeCobro } from '@/servidor/pedidos';
import { exigirSesion } from '@/servidor/sesion';

import { fechaCorta } from '../../fechas';

import { ImprimirBoton } from './ImprimirBoton';
import styles from './recibo.module.css';

export const metadata: Metadata = {
  title: 'Comprobante de pago',
  robots: { index: false, follow: false },
};

// Only the two parties see a receipt. Anyone else gets the same answer as for a missing order.
export default function PaginaRecibo({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p role="status">Cargando el comprobante…</p>}>
      <Recibo params={params} />
    </Suspense>
  );
}

// A payment reference can be long; the receipt shows its start, enough to match it with the wallet.
function acortar(referencia: string): string {
  return referencia.length > 16 ? `${referencia.slice(0, 12)}…` : referencia;
}

async function Recibo({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sesion = await exigirSesion(`/ordenes/${id}/recibo`);
  const detalle = await detalleDeOrden(id, sesion);
  if (!detalle) notFound();
  // An unpaid order has no receipt yet: the order shows what is still to do.
  if (detalle.pagadaEn === null) redirect(`/ordenes/${id}`);

  const referencia = await referenciaDeCobro(id);
  const trabajo = detalle.tipo === 'servicio';
  const comprador =
    detalle.rol === 'comprador' ? sesion.usuario.nombre.trim() || 'Comprador' : detalle.otraParte;
  const vendedor =
    detalle.rol === 'comprador' ? detalle.otraParte : (sesion.negocio?.nombre ?? detalle.otraParte);
  const cotizacion = Math.round(detalle.cotizacionUsdBtc * 100);
  const formaDePago =
    detalle.pago?.proveedor === 'falso'
      ? 'Bitcoin por Lightning, pago simulado'
      : detalle.pago?.proveedor === 'btcpay'
        ? 'Bitcoin por Lightning (BTCPay)'
        : 'Bitcoin por Lightning';

  return (
    <>
      <div className={styles.sinImprimir}>
        <p>
          <Link href={`/ordenes/${id}`} className={styles.volver}>
            ← Volver a {trabajo ? 'el trabajo' : 'la orden'}
          </Link>
        </p>
        <ImprimirBoton />
      </div>

      <article className={styles.comprobante} aria-labelledby="comprobante-titulo">
        <header className={styles.cabecera}>
          <h1 id="comprobante-titulo">Comprobante de pago</h1>
          <p className={styles.numero}>{trabajo ? `Trabajo ${detalle.numero}` : `Orden ${detalle.numero}`}</p>
        </header>

        <dl className={styles.datos}>
          <div>
            <dt>Fecha y hora de pago</dt>
            <dd>
              <time dateTime={detalle.pagadaEn}>{fechaCorta(detalle.pagadaEn)}</time>
            </dd>
          </div>
          <div>
            <dt>{trabajo ? 'Quien trabaja' : 'Vendedor'}</dt>
            <dd>{vendedor}</dd>
          </div>
          <div>
            <dt>Comprador</dt>
            <dd>{comprador}</dd>
          </div>
          <div>
            <dt>Forma de pago</dt>
            <dd>{formaDePago}</dd>
          </div>
          {referencia && (
            <div>
              <dt>Referencia del pago</dt>
              <dd className="dato">{acortar(referencia)}</dd>
            </div>
          )}
          <div>
            <dt>Cotización usada</dt>
            <dd className="dato">1 BTC = {formatoUsd(cotizacion)}</dd>
          </div>
        </dl>

        <section aria-labelledby="lineas-titulo" className={styles.bloque}>
          <h2 id="lineas-titulo">Detalle</h2>
          <ul className={styles.lineas}>
            {detalle.lineas.map((linea) => {
              const subtotal = linea.precioUsdCentavos * linea.cantidad;
              const sats = usdCentavosASats(subtotal, detalle.cotizacionUsdBtc);
              const unidad = linea.unidad === 'trabajo' ? '' : ` por ${linea.unidad}`;
              return (
                <li key={linea.id} className={styles.linea}>
                  <span className={styles.lineaNombre}>{linea.nombre}</span>
                  <span className={`dato ${styles.lineaDetalle}`}>
                    {linea.cantidad} × {formatoUsd(linea.precioUsdCentavos)}
                    {unidad}
                  </span>
                  <span className={`dato ${styles.lineaTotal}`}>
                    {formatoUsd(subtotal)} · {formatoSats(sats)}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <p className={styles.total}>
          <span>Total</span>
          <span className={`dato ${styles.totalCifra}`}>
            {formatoUsd(detalle.totalUsdCentavos)} · {formatoSats(detalle.totalSats)}
          </span>
        </p>

        <p className={styles.aviso}>
          Este comprobante no es un documento tributario. La factura electrónica (DTE) la emite el vendedor; puede hacerlo con{' '}
          <a href={URL_LEDGER}>CacaoLedger</a>.
        </p>
      </article>
    </>
  );
}
