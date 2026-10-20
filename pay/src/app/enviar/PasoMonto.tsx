import Link from 'next/link';
import type { FormEvent, RefObject } from 'react';

import { formatoMonto, MAXIMO_CENTAVOS, MINIMO_CENTAVOS, type Entrega } from '@/lib/cotizacion';
import { LineasDinero } from '@/componentes/LineasDinero';
import type { TarifaMostrada } from '@/componentes/formatoEnvio';

import type { CotizacionEnvio } from './acciones';
import estilos from './estilos.module.css';
import { VigenciaCotizacion } from './VigenciaCotizacion';

// The three ways the recipient gets the money, each in one plain line.
const OPCIONES: { valor: Entrega; titulo: string; detalle: string }[] = [
  { valor: 'lightning', titulo: 'Bitcoin por Lightning:', detalle: 'llega en un minuto, lo recibe en su billetera' },
  { valor: 'efectivo', titulo: 'Efectivo:', detalle: 'lo recoge con su DUI en un punto de pago' },
  { valor: 'cuenta', titulo: 'Cuenta bancaria:', detalle: 'llega a su cuenta en una hora' },
];

/** Step 1: the amount, its currency, the way it is delivered, and the quote from the server. */
export function PasoMonto({
  tituloRef,
  montoTexto,
  onMonto,
  moneda,
  onMoneda,
  entrega,
  onEntrega,
  tarifas,
  precioDisponible,
  error,
  cotizacion,
  usdBtc,
  errorCotizacion,
  enEspera,
  onVencer,
  onSeguir,
}: {
  tituloRef: RefObject<HTMLHeadingElement | null>;
  montoTexto: string;
  onMonto: (valor: string) => void;
  moneda: 'USD' | 'EUR';
  onMoneda: (valor: 'USD' | 'EUR') => void;
  entrega: Entrega;
  onEntrega: (valor: Entrega) => void;
  tarifas: TarifaMostrada[];
  precioDisponible: boolean;
  /** The sentence under the amount field, when it should show. */
  error: string | null;
  cotizacion: CotizacionEnvio | null;
  usdBtc: number | null;
  errorCotizacion: string | null;
  /** A quote for the current inputs is on its way. */
  enEspera: boolean;
  /** The quote ran out: the form asks for a new one. */
  onVencer: () => void;
  onSeguir: (evento: FormEvent<HTMLFormElement>) => void;
}) {
  const tarifa = tarifas.find((t) => t.entrega === entrega) ?? null;
  const rango = `Entre ${formatoMonto(MINIMO_CENTAVOS, moneda)} y ${formatoMonto(MAXIMO_CENTAVOS, moneda)}.`;

  return (
    <form className={estilos.formulario} onSubmit={onSeguir} noValidate>
      <h2 ref={tituloRef} tabIndex={-1} className={estilos.titulo}>
        Monto
      </h2>

      <div className={estilos.grupo}>
        <label htmlFor="envio-monto" className="campo-etiqueta">
          Monto a enviar
        </label>
        <input
          id="envio-monto"
          className="campo dato"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={montoTexto}
          onChange={(e) => onMonto(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'envio-monto-error' : 'envio-monto-ayuda'}
        />
        <p id="envio-monto-ayuda" className={estilos.ayuda}>
          {rango} Podés escribir centavos, como 50.25.
        </p>
        {error && (
          <p id="envio-monto-error" role="alert" className={estilos.error}>
            {error}
          </p>
        )}
      </div>

      <div className={estilos.grupo}>
        <label htmlFor="envio-moneda" className="campo-etiqueta">
          Moneda que enviás
        </label>
        <select
          id="envio-moneda"
          className="campo"
          value={moneda}
          onChange={(e) => onMoneda(e.target.value as 'USD' | 'EUR')}
        >
          <option value="USD">Dólares (USD)</option>
          <option value="EUR">Euros (EUR)</option>
        </select>
      </div>

      <fieldset className={estilos.entregas}>
        <legend className="campo-etiqueta">Cómo recibe el dinero</legend>
        {OPCIONES.map((opcion) => {
          const sinBtc = opcion.valor === 'lightning' && !precioDisponible;
          return (
            <label key={opcion.valor} className={estilos.tarjeta}>
              <input
                type="radio"
                name="entrega"
                value={opcion.valor}
                checked={entrega === opcion.valor}
                disabled={sinBtc}
                onChange={() => onEntrega(opcion.valor)}
                className={estilos.radio}
              />
              <span className={estilos.tarjetaTexto}>
                <strong>{opcion.titulo}</strong> {opcion.detalle}
                {sinBtc && <small className={estilos.ayuda}>El precio del bitcoin no está disponible ahora.</small>}
              </span>
            </label>
          );
        })}
      </fieldset>

      {(cotizacion || errorCotizacion || enEspera) && (
        <section className={estilos.cotizacion} aria-labelledby="envio-cotizacion-titulo">
          <h3 id="envio-cotizacion-titulo" className={estilos.subtitulo}>
            Así queda el envío
          </h3>
          <div aria-live="polite">
            {errorCotizacion ? (
              <p role="alert" className={estilos.error}>
                {errorCotizacion}
              </p>
            ) : cotizacion ? (
              <>
                <LineasDinero datos={cotizacion} tarifa={tarifa} usdBtc={usdBtc} conPlazo />
                <VigenciaCotizacion validaHasta={cotizacion.validaHasta} onVencer={onVencer} />
              </>
            ) : (
              <p role="status" className={estilos.ayuda}>
                Calculamos el envío…
              </p>
            )}
          </div>
        </section>
      )}

      <div className={estilos.acciones}>
        <Link href="/" className={estilos.enlaceVolver}>
          Volver al inicio
        </Link>
        <button type="submit" className="boton">
          Seguir
        </button>
      </div>
    </form>
  );
}
