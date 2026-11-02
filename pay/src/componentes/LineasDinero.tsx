import { formatoMonto, type Entrega } from '@/lib/cotizacion';
import { usdCotizadoCentavos } from '@/lib/transferencias';

import { comisionExplicada, plazoEnvio, tipoDeCambio, type TarifaMostrada } from './formatoEnvio';
import estilos from './LineasDinero.module.css';

// What a transfer amounts to, in the four lines the person reads: amount sent, fee, rate, received.
// Used for a quote before sending and for a transfer that exists. Presentational only.
export type DatosDinero = {
  monedaOrigen: 'USD' | 'EUR';
  montoOrigenCentavos: number;
  comisionCentavos: number;
  netoCentavos: number;
  tasa: number;
  tasaFuente: string;
  monedaDestino: 'USD' | 'SATS';
  montoDestino: number;
  entrega: Entrega;
  minutosEstimados: number;
};

export function LineasDinero({
  datos,
  tiempo = 'presente',
  tarifa = null,
  usdBtc = null,
  conPlazo = false,
}: {
  datos: DatosDinero;
  /** "Enviás" while the person decides, "Enviaste" once the transfer exists. */
  tiempo?: 'presente' | 'pasado';
  /** Shows the fee formula when given. */
  tarifa?: Pick<TarifaMostrada, 'fijoCentavos' | 'porcentajeBps'> | null;
  /** BTC price in USD, for sats: shows the price and the approximate dollar value. */
  usdBtc?: number | null;
  conPlazo?: boolean;
}) {
  const tipo = tipoDeCambio(datos);
  const enSats = datos.monedaDestino === 'SATS';
  // The dollars fixed when the transfer was quoted: the same figure once the transfer exists.
  const aproximado = enSats ? usdCotizadoCentavos(datos) : null;

  return (
    <dl className={estilos.lineas}>
      <div>
        <dt>{tiempo === 'pasado' ? 'Enviaste' : 'Enviás'}</dt>{' '}
        <dd className="dato">{formatoMonto(datos.montoOrigenCentavos, datos.monedaOrigen)}</dd>
      </div>
      <div>
        <dt>Comisión</dt>{' '}
        <dd>
          <span className="dato">{formatoMonto(datos.comisionCentavos, datos.monedaOrigen)}</span>
          {tarifa && <small className={estilos.nota}>{comisionExplicada(tarifa, datos.monedaOrigen)}</small>}
        </dd>
      </div>
      <div>
        <dt>Tipo de cambio</dt>{' '}
        <dd>
          <span className="dato">{tipo.principal}</span>
          {tipo.nota && <small className={estilos.nota}>{tipo.nota}</small>}
          {enSats && usdBtc && (
            <small className={estilos.nota}>
              Precio del bitcoin: {formatoMonto(Math.round(usdBtc * 100), 'USD')}
            </small>
          )}
        </dd>
      </div>
      <div className={estilos.recibe}>
        <dt>Recibe</dt>{' '}
        <dd>
          <span className={`dato ${estilos.grande}`}>{formatoMonto(datos.montoDestino, datos.monedaDestino)}</span>
          {aproximado !== null && <small className={estilos.nota}>aprox. {formatoMonto(aproximado, 'USD')}</small>}
          {conPlazo && <small className={estilos.nota}>{plazoEnvio(datos.minutosEstimados)}</small>}
        </dd>
      </div>
    </dl>
  );
}
