'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';

import { cobrarAccion } from './acciones';
import estilos from './estilos.module.css';

/**
 * The recipient pastes a Lightning invoice for the exact sats and presses Cobrar. The server pays it and
 * records the outcome; the page then reads the state again.
 */
export function FormularioCobro({
  token,
  monto,
  enlaceFacturaDePrueba,
}: {
  token: string;
  /** The amount to put on the invoice, in words: "1,250 sats". */
  monto: string;
  /** Test wallet link for whoever has no Lightning wallet, or null when BTCPay is not set up. */
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
          Cómo conseguir la factura
        </h2>
        <ol className={estilos.pasosLista}>
          <li>Abrí la app de tu billetera de bitcoin, la que sirve para Lightning.</li>
          <li>Elegí la opción para recibir y escribí exactamente {monto}.</li>
          <li>Copiá la factura. Es un texto largo que empieza con &quot;lnbc&quot;.</li>
          <li>Pegala aquí abajo y tocá Cobrar.</li>
        </ol>
      </section>

      <label htmlFor="factura-cobro" className="campo-etiqueta">
        Pegá tu factura
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
        placeholder="lnbc…"
      />
      <p id="ayuda-factura" className={estilos.ayuda}>
        La factura tiene que ser por {monto}. Cuando se pague, el envío queda entregado.
      </p>

      {enlaceFacturaDePrueba && (
        <p className={estilos.ayuda}>
          ¿No tenés billetera Lightning?{' '}
          <a href={enlaceFacturaDePrueba} target="_blank" rel="noopener">
            Creá una factura de prueba
          </a>
          .
        </p>
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
