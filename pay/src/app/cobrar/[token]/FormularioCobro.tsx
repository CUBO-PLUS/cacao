'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';

import { cobrarAccion } from './acciones';
import estilos from './estilos.module.css';

/**
 * The recipient pastes the payment code their bitcoin wallet makes for the exact amount and presses Cobrar.
 * The server pays it and records the outcome; the page then reads the state again.
 */
export function FormularioCobro({
  token,
  monto,
  enlaceFacturaDePrueba,
}: {
  token: string;
  /** The exact amount in bitcoin, in words: "1,250 sats". Shown in the steps, where the invoice is asked for. */
  monto: string;
  /** Test wallet link for whoever has no bitcoin wallet, or null when BTCPay is not set up. */
  enlaceFacturaDePrueba: string | null;
}) {
  const router = useRouter();
  const [factura, setFactura] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pendiente, empezar] = useTransition();

  function cobrar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    empezar(async () => {
      try {
        const resultado = await cobrarAccion(token, factura);
        if (!resultado.ok) {
          setError(resultado.mensaje);
          return;
        }
        router.refresh();
      } catch {
        setError('No pudimos conectarnos. Revisá tu conexión y probá de nuevo.');
      }
    });
  }

  return (
    <form className={estilos.formulario} onSubmit={cobrar}>
      <section className={estilos.pasos} aria-labelledby="titulo-pasos-cobro">
        <h2 id="titulo-pasos-cobro" className={estilos.subtitulo}>
          Cómo cobrarlo, paso a paso
        </h2>
        <ol className={estilos.pasosLista}>
          <li>Abrí tu billetera de bitcoin. Si no tenés una, mirá la opción de abajo.</li>
          <li>
            Pedí un pago por exactamente <span className="dato">{monto}</span>. Ese es el monto exacto que tiene que
            tener el código.
          </li>
          <li>Copiá el código de pago. Es un texto largo que empieza con &quot;lnbc&quot;.</li>
          <li>Pegalo aquí abajo y tocá Cobrar.</li>
        </ol>
      </section>

      <label htmlFor="factura-cobro" className="campo-etiqueta">
        Pegá el código de pago
      </label>
      <textarea
        id="factura-cobro"
        className={estilos.textoFactura}
        value={factura}
        onChange={(e) => setFactura(e.target.value)}
        rows={4}
        required
        spellCheck={false}
        autoComplete="off"
        aria-describedby="ayuda-factura"
        placeholder="Pegá aquí el código de pago"
      />
      <p id="ayuda-factura" className={estilos.ayuda}>
        Cuando se cobre, el envío queda entregado.
      </p>

      {enlaceFacturaDePrueba && (
        <section className={estilos.pruebaCaja} aria-labelledby="titulo-prueba">
          <h3 id="titulo-prueba" className={estilos.subtitulo}>
            ¿No tenés billetera de bitcoin?
          </h3>
          <p className={estilos.ayuda}>
            Usá la billetera de prueba de esta demo. Te guía para crear el código por el mismo monto, sin costo.
          </p>
          <ol className={estilos.pasosLista}>
            <li>
              <a href={enlaceFacturaDePrueba} target="_blank" rel="noopener">
                Abrir la billetera de prueba
              </a>{' '}
              (se abre en otra pestaña).
            </li>
            <li>Copiá el código que te muestra.</li>
            <li>Volvé aquí, pegalo arriba y tocá Cobrar.</li>
          </ol>
        </section>
      )}

      <p className={estilos.regtest}>
        <strong>Es bitcoin de prueba: no tiene valor real.</strong>
      </p>

      {error && (
        <p role="alert" className={estilos.error}>
          {error}
        </p>
      )}

      <button type="submit" className="boton" disabled={pendiente}>
        {pendiente ? 'Cobrando…' : 'Cobrar'}
      </button>
    </form>
  );
}
