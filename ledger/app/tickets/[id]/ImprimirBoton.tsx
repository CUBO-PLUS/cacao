"use client";

// Opens the browser print dialog. The print stylesheet hides the navigation and the buttons.
export function ImprimirBoton() {
  return (
    <button type="button" className="boton secundario" onClick={() => window.print()}>
      Imprimir
    </button>
  );
}
