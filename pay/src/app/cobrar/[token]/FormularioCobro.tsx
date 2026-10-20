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
  enlaceFacturaDePrueba,
}: {
  token: string;
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
      const resultado = await cobrarAccion(token, factura);
      if (!resultado.ok) {
        setError(resultado.mensaje);
        return;
      }
      router.refresh();
    });
  }

  return (
    <form className={estilos.formulario} onSubmit={cobrar}>
      <label htmlFor="factura-cobro" className="campo-etiqueta">
        Factura Lightning
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
        Pegá una factura por el monto exacto que te mandaron. Cuando se pague, el envío queda entregado.
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
        <strong>Bitcoin de prueba (regtest): no tiene valor.</strong>
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
