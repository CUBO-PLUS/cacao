'use client';

/** Opens the browser's print dialog, where the page prints only the receipt. */
export function BotonImprimir() {
  return (
    <button type="button" className="boton boton--secundario" onClick={() => window.print()}>
      Imprimir
    </button>
  );
}
