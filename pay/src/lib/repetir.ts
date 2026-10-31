import { MAXIMO_CENTAVOS, MINIMO_CENTAVOS, type Entrega } from './cotizacion';

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

/** The amount, currency and delivery the home quote carries into /enviar. Each value is checked. */
export type InicioEnvio = { montoTexto: string; moneda: 'USD' | 'EUR'; entrega: Entrega };

const ENTREGAS_VALIDAS: readonly Entrega[] = ['lightning', 'efectivo', 'cuenta'];

function primero(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

/**
 * Reads ?monto=, ?moneda= and ?entrega=. Returns null when there is no usable amount; a missing or
 * unknown currency or delivery falls back to the form's defaults. The amount is written back in the
 * form's own format, so "50,5" arrives as "50.50".
 */
export function inicioDesdeQuery(params: Record<string, string | string[] | undefined>): InicioEnvio | null {
  const monto = primero(params.monto);
  if (!monto) return null;
  const m = /^(\d{1,7})(?:[.,](\d{1,2}))?$/.exec(monto.trim());
  if (!m) return null;
  const centavos = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  if (centavos < MINIMO_CENTAVOS || centavos > MAXIMO_CENTAVOS) return null;
  const moneda = primero(params.moneda) === 'EUR' ? 'EUR' : 'USD';
  const entregaTexto = primero(params.entrega) as Entrega | undefined;
  const entrega = entregaTexto && ENTREGAS_VALIDAS.includes(entregaTexto) ? entregaTexto : 'efectivo';
  return { montoTexto: montoTextoDesdeCentavos(centavos), moneda, entrega };
}

/** The /enviar address that keeps the prefill, used as the return path after sign-in. */
export function rutaEnviarCon(inicio: InicioEnvio | null, repetir: string | null): string {
  const busqueda = new URLSearchParams();
  if (repetir) busqueda.set('repetir', repetir);
  if (inicio) {
    busqueda.set('monto', inicio.montoTexto);
    busqueda.set('moneda', inicio.moneda);
    busqueda.set('entrega', inicio.entrega);
  }
  const texto = busqueda.toString();
  return texto ? `/enviar?${texto}` : '/enviar';
}
