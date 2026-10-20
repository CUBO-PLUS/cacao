'use client';

import { useState } from 'react';

import estilos from './EnlaceCobro.module.css';

/**
 * The sender's link for the recipient to collect the transfer in Lightning. Copy it, or send it by
 * WhatsApp. The link is only the way in: the claim itself is paid by the server.
 */
export function EnlaceCobro({ enlace, sats }: { enlace: string; sats: string }) {
  const [copiado, setCopiado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mensaje = `Te mandé ${sats} por Cacao Pay. Cobralos acá: ${enlace}`;
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(mensaje)}`;

  async function copiar() {
    setError(null);
    try {
      await navigator.clipboard.writeText(enlace);
      setCopiado(true);
    } catch {
      setError('No pudimos copiar el enlace. Seleccionalo a mano.');
    }
  }

  return (
    <section className={estilos.caja} aria-labelledby="titulo-enlace-cobro">
      <h2 id="titulo-enlace-cobro">Enlace para cobrar</h2>
      <p className={estilos.texto}>
        Quien recibe abre este enlace, pega una factura Lightning por {sats} y lo cobra. No necesita cuenta en Cacao Pay.
      </p>
      <p className={`dato ${estilos.enlace}`}>{enlace}</p>

      <div className={estilos.botones}>
        <button type="button" className="boton boton--secundario" onClick={copiar}>
          {copiado ? 'Enlace copiado' : 'Copiar enlace'}
        </button>
        <a className="boton" href={whatsapp} target="_blank" rel="noopener">
          Compartir por WhatsApp
        </a>
      </div>

      {error && (
        <p role="alert" className={estilos.error}>
          {error}
        </p>
      )}
    </section>
  );
}
