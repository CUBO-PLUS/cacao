// Cacao Gate, browser side. The reader's device only keeps the token the server signed; the locked
// text itself is fetched with that token and never stored.
export type EstadoGate = 'bloqueado' | 'desbloqueado' | 'expirado';

export const CLAVE = 'cacao-gate:';

interface Guardado {
  token: string;
  expira: number;
}

// Unlocks for this page view. Keeps the story open when the browser blocks localStorage.
const memoria = new Map<string, Guardado>();

function leer(slug: string): Guardado | null {
  const enMemoria = memoria.get(slug);
  if (enMemoria) return enMemoria;
  try {
    const g = JSON.parse(localStorage.getItem(CLAVE + slug) ?? 'null') as Guardado | null;
    return g && typeof g.token === 'string' && typeof g.expira === 'number' ? g : null;
  } catch {
    return null;
  }
}

function guardar(slug: string, g: Guardado): void {
  memoria.set(slug, g);
  try {
    localStorage.setItem(CLAVE + slug, JSON.stringify(g));
  } catch {
    // Storage blocked: the Map above still keeps the story open for this page view.
  }
}

/** What the device believes. The server has the last word when the text is requested. */
export function estadoGate(slug: string, ahora: number = Date.now()): EstadoGate {
  const g = leer(slug);
  if (!g) return 'bloqueado';
  return g.expira > ahora ? 'desbloqueado' : 'expirado';
}

/** Stores the paid token the server signed for a story. Its expiry is read from the payload. */
export function guardarAcceso(slug: string, token: string): boolean {
  try {
    const datos = token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(datos), (c) => c.charCodeAt(0));
    // fatal: bytes that are not valid UTF-8 throw, and the token is refused.
    const pago = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as {
      tipo?: string;
      slugs?: string[];
      exp?: number;
    };
    if (pago.tipo !== 'pago' || !pago.slugs?.includes(slug) || typeof pago.exp !== 'number') return false;
    guardar(slug, { token, expira: pago.exp });
    return true;
  } catch {
    return false;
  }
}

/** The locked HTML, or null when the server says the token is no longer good. */
export async function traerCerrado(slug: string): Promise<string | null> {
  const g = leer(slug);
  if (!g) return null;
  const r = await fetch(`/api/contenido/${slug}/`, { headers: { Authorization: `Bearer ${g.token}` } });
  if (r.status === 401) {
    // Signature or expiry rejected: forget it so the wall comes back.
    memoria.delete(slug);
    try {
      localStorage.removeItem(CLAVE + slug);
    } catch {}
    return null;
  }
  if (!r.ok) throw new Error('No se pudo cargar la historia.');
  return ((await r.json()) as { html: string }).html;
}
