'use client';

import estilos from './AvisoPagoFallido.module.css';

/**
 * What a visitor sees when a payment or invoice request fails: the reason, one button that repeats the same
 * request (the page passes its own request function, so no new endpoint), and a line with the contact address.
 */
export function AvisoPagoFallido({
  mensaje,
  onReintentar,
  deshabilitado = false,
}: {
  mensaje: string;
  onReintentar: () => void;
  deshabilitado?: boolean;
}) {
  return (
    <div className={estilos.caja}>
      <p role="alert" className={estilos.mensaje}>
        {mensaje}
      </p>
      <button
        type="button"
        className="boton boton--secundario"
        onClick={onReintentar}
        disabled={deshabilitado}
        aria-disabled={deshabilitado}
      >
        Intentar de nuevo
      </button>
      <p className={estilos.ayuda}>
        ¿Algo no funciona? Escribinos a <a href="mailto:hola@cacaomedia.sv">hola@cacaomedia.sv</a>
      </p>
    </div>
  );
}
