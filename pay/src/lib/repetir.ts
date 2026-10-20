// Helpers for "Repetir envío": the link from a past transfer to a new one with the same data.
// Pure, so the page and the form share them.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The transfer id from ?repetir=, or null when the value is not an id. Ownership is checked on the server. */
export function idDeRepetir(valor: string | string[] | undefined): string | null {
  const texto = Array.isArray(valor) ? valor[0] : valor;
  return texto && UUID.test(texto) ? texto : null;
}

/** An amount in cents as the form shows it: 10000 becomes "100", 10050 becomes "100.50". */
export function montoTextoDesdeCentavos(centavos: number): string {
  const entero = Math.floor(centavos / 100);
  const resto = centavos % 100;
  if (resto === 0) return String(entero);
  return `${entero}.${String(resto).padStart(2, '0')}`;
}
