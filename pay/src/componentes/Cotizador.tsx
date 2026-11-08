'use client';

import { useId, useState } from 'react';

import { formatoUsd } from '@/lib/dinero';
import { cotizar, type Cotizacion, type Entrega, formatoMonto, TARIFAS, TASA_EUR_USD } from '@/lib/cotizacion';
import { montoTextoDesdeCentavos, rutaEnviarCon } from '@/lib/repetir';

import { Boton } from './Boton';
import { ProximoPaso } from './ProximoPaso';
import { tipoDeCambio } from './formatoEnvio';
import estilos from './Cotizador.module.css';

// Each way of delivery: the name, and what it means in a few words.
const ENTREGAS: { valor: Entrega; titulo: string; detalle: string }[] = [
  { valor: 'efectivo', titulo: 'Efectivo', detalle: 'Retira en un punto de pago' },
  { valor: 'cuenta', titulo: 'Cuenta bancaria', detalle: 'Llega en una hora' },
  { valor: 'lightning', titulo: 'Bitcoin', detalle: 'a tu billetera de bitcoin, llega en un minuto' },
];

// "50", "50.5" and "50,25" are amounts; anything else is not, and the field says so.
function aCentavos(texto: string): number | null {
  const m = /^(\d{1,7})(?:[.,](\d{1,2}))?$/.exec(texto.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

/**
 * Quote preview for the home page. Works without signing in: the BTC price comes from the server
 * (usdBtc), and every line is computed here by cotizar(). The primary button carries the amount,
 * currency and delivery into /enviar, so the sender does not type them again.
 */
export function Cotizador({
  usdBtc,
  fuenteBtc,
  conSesion = false,
}: {
  usdBtc: number | null;
  fuenteBtc: string;
  /** True when the visitor is signed in; a signed-out visitor is told that signing in comes next. */
  conSesion?: boolean;
}) {
  const id = useId();
  const [montoTexto, setMontoTexto] = useState('50');
  const [moneda, setMoneda] = useState<'USD' | 'EUR'>('USD');
  const [entrega, setEntrega] = useState<Entrega>('efectivo');

  const centavos = aCentavos(montoTexto);
  const resultado =
    centavos === null
      ? null
      : cotizar({
          monedaOrigen: moneda,
          montoOrigenCentavos: centavos,
          entrega,
          tarifas: TARIFAS,
          eurUsd: TASA_EUR_USD,
          usdBtc,
          fuenteBtc,
        });
  const error =
    centavos === null
      ? 'Escribí el monto con números, por ejemplo 50 o 50.25.'
      : resultado && 'error' in resultado
        ? resultado.error
        : null;
  const cotizacion: Cotizacion | null = resultado && !('error' in resultado) ? resultado : null;

  const enviarHref =
    cotizacion && centavos !== null
      ? rutaEnviarCon({ montoTexto: montoTextoDesdeCentavos(centavos), moneda, entrega }, null)
      : null;

  return (
    <div className={estilos.cotizador}>
      <div className={estilos.montos}>
        <div className={estilos.grupo}>
          <label htmlFor={`${id}-monto`} className="campo-etiqueta">
            Vos mandás
          </label>
          <input
            id={`${id}-monto`}
            className={`campo ${estilos.montoCampo}`}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={montoTexto}
            onChange={(e) => setMontoTexto(e.target.value)}
            aria-describedby={error ? `${id}-error` : undefined}
            aria-invalid={error ? true : undefined}
          />
        </div>
        <div className={estilos.grupo}>
          <label htmlFor={`${id}-moneda`} className="campo-etiqueta">
            Moneda
          </label>
          <select
            id={`${id}-moneda`}
            className={`campo ${estilos.moneda}`}
            value={moneda}
            onChange={(e) => setMoneda(e.target.value as 'USD' | 'EUR')}
          >
            <option value="USD">Dólares</option>
            <option value="EUR">Euros</option>
          </select>
        </div>
      </div>

      {error && (
        <p id={`${id}-error`} role="alert" className={estilos.error}>
          {error}
        </p>
      )}

      <Recibe cotizacion={cotizacion} usdBtc={usdBtc} />

      <fieldset className={estilos.entregas}>
        <legend className="campo-etiqueta">Cómo recibe el dinero</legend>
        {ENTREGAS.map((o) => {
          const sinBtc = o.valor === 'lightning' && usdBtc === null;
          return (
            <label key={o.valor} className={`${estilos.opcion} ${sinBtc ? estilos.opcionOff : ''}`}>
              <input
                type="radio"
                name={`${id}-entrega`}
                value={o.valor}
                checked={entrega === o.valor}
                disabled={sinBtc}
                onChange={() => setEntrega(o.valor)}
              />
              <strong>{o.titulo}</strong>
              <small>{o.detalle}</small>
            </label>
          );
        })}
      </fieldset>

      {usdBtc === null && (
        <p className={estilos.aviso}>
          No tenemos el precio de bitcoin ahora, así que la opción de bitcoin no está disponible. Efectivo y cuenta
          bancaria sí.
        </p>
      )}

      {enviarHref ? (
        <Boton href={enviarHref}>Enviar dinero</Boton>
      ) : (
        <Boton disabled>Enviar dinero</Boton>
      )}
      {!conSesion && (
        <p className={estilos.entrar}>Te pedimos entrar para guardar el envío y darte su código de seguimiento.</p>
      )}
      {cotizacion && (
        <ProximoPaso
          opciones={[
            {
              texto: 'Dónde gastar tus sats',
              href: '/donde-gastar',
              detalle: 'Negocios de El Salvador donde se puede pagar con bitcoin.',
            },
            {
              texto: 'Comprá en CacaoMarket',
              href: 'https://cacao-market.vercel.app',
              detalle: 'Productos y servicios locales, pagados en sats.',
            },
          ]}
        />
      )}
    </div>
  );
}

// The amount that arrives, the fee and the rate on one line, and how long it takes.
function Recibe({ cotizacion: c, usdBtc }: { cotizacion: Cotizacion | null; usdBtc: number | null }) {
  if (!c) {
    return (
      <div className={estilos.recibe}>
        <span className={estilos.recibeEtiqueta}>Le llega a tu familiar</span>
        <span className={estilos.recibeMonto}>—</span>
      </div>
    );
  }

  const enSats = c.monedaDestino === 'SATS';
  // A sats amount is shown with its dollar value next to it, as the price is shown everywhere else. Every amount
  // carries its currency code, so a dollar amount can never be read as euros next to a euro amount.
  const aproximadoUsd =
    enSats && usdBtc !== null ? formatoUsd(Math.floor((c.montoDestino * usdBtc) / 1_000_000)) : null;
  const montoPrincipal = enSats
    ? aproximadoUsd
      ? `${aproximadoUsd} USD`
      : formatoMonto(c.montoDestino, c.monedaDestino)
    : `${formatoUsd(c.montoDestino)} USD`;
  const minutos = c.minutosEstimados === 1 ? 'Llega en un minuto.' : `Llega en unos ${c.minutosEstimados} minutos.`;

  let tipo: string | null = null;
  if (enSats || c.monedaOrigen === 'EUR') {
    const { principal } = tipoDeCambio(c);
    tipo = principal;
  }

  return (
    <>
      <div className={estilos.recibe} aria-live="polite">
        <span className={estilos.recibeEtiqueta}>Le llega a tu familiar</span>
        <span className={estilos.recibeMonto}>{montoPrincipal}</span>
        {enSats && (
          <small className={estilos.nota}>En bitcoin: {formatoMonto(c.montoDestino, c.monedaDestino)}</small>
        )}
        <small className={estilos.nota}>{minutos}</small>
      </div>
      <p className={estilos.linea} aria-live="polite">
        Comisión {formatoMonto(c.comisionCentavos, c.monedaOrigen)}
        {tipo ? ` · ${tipo}` : ''}
      </p>
    </>
  );
}
