// Access codes for Cacao Media. The code a reader saves is the signed pass the server gave after the
// payment: it names one story and expires. Typing it back on any browser opens that story, and nothing else.
// Pure logic, no database: the route in src/pages/api/codigo.ts does the checks against the story list.
import { verificar, type Pase } from './firma.ts';

/** Wrong codes one client may type, per window. Right codes are never counted. */
export const INTENTOS_MAXIMOS = 20;
/** Length of the window the attempts are counted in, in milliseconds. */
export const VENTANA_INTENTOS_MS = 15 * 60 * 1000;

/** The text the reader typed or pasted, without spaces or line breaks. Null when nothing usable is left. */
export function limpiarCodigo(texto: unknown): string | null {
  if (typeof texto !== 'string') return null;
  const codigo = texto.replace(/\s+/g, '');
  return codigo.length > 0 && codigo.length <= 4096 ? codigo : null;
}

/** The pass a code opens for this story, when the code is genuine, unexpired and names exactly this story. */
export function pasePorCodigo(codigo: string, slug: string, ahora: number = Date.now()): Pase | null {
  const pase = verificar(codigo, ahora);
  if (!pase || pase.tipo !== 'pago') return null;
  if (!Array.isArray(pase.slugs) || pase.slugs.length !== 1 || pase.slugs[0] !== slug) return null;
  return pase;
}

/** Counts wrong codes per client in a sliding window. Kept in memory: each server instance counts on its own. */
export class LimiteIntentos {
  private readonly cubos = new Map<string, number[]>();
  private readonly maximo: number;
  private readonly ventana: number;

  constructor(maximo: number = INTENTOS_MAXIMOS, ventana: number = VENTANA_INTENTOS_MS) {
    this.maximo = maximo;
    this.ventana = ventana;
  }

  /** True while the client has used up its wrong codes in the window. */
  bloqueado(clave: string, ahora: number = Date.now()): boolean {
    const recientes = (this.cubos.get(clave) ?? []).filter((t) => ahora - t < this.ventana);
    this.cubos.set(clave, recientes);
    return recientes.length >= this.maximo;
  }

  /** Records one wrong code for `clave`. */
  registrarFallo(clave: string, ahora: number = Date.now()): void {
    const recientes = (this.cubos.get(clave) ?? []).filter((t) => ahora - t < this.ventana);
    recientes.push(ahora);
    this.cubos.set(clave, recientes);
    if (this.cubos.size > 5000) this.limpiar(ahora);
  }

  private limpiar(ahora: number): void {
    for (const [clave, tiempos] of this.cubos) {
      if (tiempos.every((t) => ahora - t >= this.ventana)) this.cubos.delete(clave);
    }
  }
}

/** The shared limiter for the code route. */
export const intentosCodigo = new LimiteIntentos();
