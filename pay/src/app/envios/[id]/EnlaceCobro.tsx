'use client';

import { useState } from 'react';

import estilos from './EnlaceCobro.module.css';

/**
 * The sender's link for the recipient to collect the transfer in Lightning. Copy it, or send it by
 * WhatsApp. The link is only the way in: the claim itself is paid by the server.
 */
export function EnlaceCobro({
  enlace,
  sats,
  dolares,
}: {
  enlace: string;
  sats: string;
  /** The approximate dollar value of the sats, or null when the price is not available. */
  dolares: string | null;
}) {
  const [copiado, setCopiado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Dollars first; the exact bitcoin amount sits under "Ver detalle".
  const cuanto = dolares ? `unos ${dolares}` : sats;
  const mensaje = `Te mandé ${cuanto} por Cacao Pay. Cobralo acá: ${enlace}`;
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
        Quien recibe abre este enlace y cobra {dolares ? `unos ${dolares}` : sats} con su billetera de bitcoin. No
        necesita cuenta en Cacao Pay.
      </p>
      <p className={`dato ${estilos.enlace}`}>{enlace}</p>

      <div className={estilos.botones}>
        <a className="boton" href={whatsapp} target="_blank" rel="noopener">
          Mandar por WhatsApp
        </a>
        <button type="button" className="boton boton--secundario" onClick={copiar}>
          {copiado ? 'Enlace copiado' : 'Copiar enlace'}
        </button>
      </div>

      <details className={estilos.detalle}>
        <summary>Ver detalle</summary>
        <p>
          El monto exacto en bitcoin es <span className="dato">{sats}</span>.
        </p>
      </details>

      {error && (
        <p role="alert" className={estilos.error}>
          {error}
        </p>
      )}
    </section>
  );
}
