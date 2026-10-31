'use client';

import estilos from '../estilos.module.css';

// Opens the browser's print dialog. The buttons are hidden in print, so the sheet shows only the code.
export function BotonImprimir() {
  return (
    <button type="button" className={`boton boton--secundario ${estilos.noImprimir}`} onClick={() => window.print()}>
      Imprimir el código
    </button>
  );
}
